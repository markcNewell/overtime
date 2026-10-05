/**
 * The office panel: hiring, picking projects, the staff file, the chat log
 * and settings, squeezed into a small pop-up next to the worker. Re-renders
 * from the full GameState pushed by the main process, skipping the DOM work
 * when a tab's HTML hasn't changed.
 */

import { capacity, xpFor } from '../../game/levels';
import type { ClaudeCheck, OfficeTab } from '../../shared/ipc';
import type {
  Attitude,
  Candidate,
  ChatLine,
  Complaint,
  ComplaintOutcome,
  Difficulty,
  GameState,
  Leftover,
  Level,
  Pitch,
  Project,
  Release,
  Traits,
  Worker,
} from '../../shared/types';
import { personSvg, type Expression } from '../shared/person';
import { installMockApi } from './mock';

if (!window.overtime) installMockApi();
const api = window.overtime;

let state: GameState | undefined;
let tab: OfficeTab = 'hire';
let lastHtml = '';
let claudeCheck: ClaudeCheck | undefined;
let checkingClaude = false;
/** Which candidate the hiring pager shows, and for which shortlist. */
let candidateIndex = 0;
let shortlistKey = '';
/** Which pitch rows are expanded, so re-renders don't snap them shut. */
const openPitches = new Set<string>();
/** Half-written replies to complaints, kept across re-renders. */
const drafts = new Map<string, string>();
/** Complaints already reported as read, so we only tell main once. */
const markedRead = new Set<string>();

const content = byId('content');

// ---------------------------------------------------------------- helpers

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

/** Everything shown here can come from Claude, so escape it all. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function pct(fraction: number): number {
  return Math.round(Math.max(0, Math.min(1, fraction)) * 100);
}

function bar(kind: string, value: number): string {
  return `<div class="bar ${kind}"><span style="width:${pct(value / 100)}%"></span></div>`;
}

const STAR_PATH =
  'M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.2l7.1-.6z';

/** Drawn rather than ★ so it renders even without a symbol font. */
function stars(d: Difficulty): string {
  const star = (on: boolean): string =>
    `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">` +
    `<path d="${STAR_PATH}" class="${on ? 'on' : 'off'}"/></svg>`;
  const icons = [1, 2, 3, 4, 5].map((n) => star(n <= d)).join('');
  return `<span class="stars" role="img" aria-label="${d} of 5">${icons}</span>`;
}

const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  1: 'Trivial',
  2: 'Easy',
  3: 'Tricky',
  4: 'Hard',
  5: 'Nightmare',
};

const ATTITUDE_WORDS: Record<Attitude, string> = {
  neutral: 'Neutral. You are just a boss.',
  loyal: 'Loyal. Would take a bullet for you (a small one).',
  scared: 'Scared of you. Flinches when you walk past.',
  bitter: 'Bitter. Quietly updating their CV.',
  'sucking-up': 'Sucking up. Laughs at all your jokes.',
};

function when(at: number): string {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return today ? time : `${d.toLocaleDateString()} ${time}`;
}

/** Trait multipliers (0.7-1.3) as one to five pips. */
function pips(value: number): string {
  const n = Math.max(1, Math.min(5, Math.round(((value - 0.7) / 0.6) * 4) + 1));
  return '●'.repeat(n) + '○'.repeat(5 - n);
}

function traitsHtml(t: Traits): string {
  return `<div class="traits">
    <span>Stamina <span class="pips">${pips(t.stamina)}</span></span>
    <span>Resilience <span class="pips">${pips(t.resilience)}</span></span>
    <span>Talent <span class="pips">${pips(t.talent)}</span></span>
  </div>`;
}

function expressionFor(worker: Worker): Expression {
  const { energy, mood, sanity } = worker.stats;
  if (worker.activity === 'asleep') return 'asleep';
  if (sanity < 30) return 'crazy';
  if (worker.attitude === 'scared') return 'scared';
  if (energy < 20) return 'tired';
  if (mood < 25) return worker.attitude === 'bitter' ? 'angry' : 'sad';
  if (mood > 65) return 'happy';
  return 'neutral';
}

function levelBadge(level: Level): string {
  return `<span class="badge ${level}">${level}</span>`;
}

function leftoversHtml(leftovers: Leftover[]): string {
  if (leftovers.length === 0) return '';
  const items = leftovers.map((l) => {
    const what =
      l.kind === 'mug'
        ? `${esc(l.fromWorker)}'s mug: “${esc(l.text)}”`
        : l.kind === 'sticky-note'
          ? `A note from ${esc(l.fromWorker)}: “${esc(l.text)}”`
          : `${esc(l.fromWorker)}'s unfinished project: ${esc(l.text)}`;
    return `<div>${what}</div>`;
  });
  return `<div class="banner"><b>Left on the desk</b>${items.join('')}</div>`;
}

// ------------------------------------------------------------------ hire

function hireTab(s: GameState): string {
  const worker = s.worker;
  if (worker && worker.activity !== 'leaving') {
    return `<div class="empty"><h2>${esc(worker.name)} is at the desk</h2>
      <p>To hire someone else, get rid of them first<br>(clipboard on the desk → Fire).</p></div>`;
  }
  const busy = s.brainStatus === 'thinking' ? 'disabled' : '';
  const reroll = `<button data-action="reroll" ${busy}>3 more</button>`;
  if (s.candidates.length === 0) {
    return `${leftoversHtml(s.deskLeftovers)}
      <div class="empty">The recruiter is digging up some candidates...</div>`;
  }
  syncShortlist(s.candidates);
  const c = s.candidates[candidateIndex] ?? s.candidates[0]!;
  const pager = `<div class="pager">
      <button data-action="prev" aria-label="Previous">‹</button>
      ${candidateIndex + 1} / ${s.candidates.length}
      <button data-action="next" aria-label="Next">›</button></div>`;
  return `${leftoversHtml(s.deskLeftovers)}
    ${candidateCard(c)}
    <div class="row" style="margin-top:8px">${pager}<span class="spacer"></span>${reroll}
      <button class="primary" data-action="hire" data-id="${esc(c.id)}">Hire</button></div>`;
}

/** A new shortlist starts the pager from the first candidate again. */
function syncShortlist(candidates: Candidate[]): void {
  const key = candidates.map((c) => c.id).join(',');
  if (key === shortlistKey) return;
  shortlistKey = key;
  candidateIndex = 0;
}

function candidateCard(c: Candidate): string {
  const portrait = personSvg(c.look, { pose: 'stand', expression: 'happy', size: 84, crop: 'bust' });
  return `<article class="card">
    <div class="cand-top">
      <div class="portrait">${portrait}</div>
      <div>
        <h3>${esc(c.name)}</h3>
        <div class="muted">${esc(c.age)} · ${esc(c.pronouns)} ${levelBadge(c.level)}</div>
        <div class="field">${esc(c.specialty)}</div>
      </div>
    </div>
    <div class="field"><b>Personality</b> ${esc(c.personality)}</div>
    <div class="field"><b>Quirk</b> ${esc(c.quirk)}</div>
    <div class="field red-flag"><b>Red flag</b> ${esc(c.redFlag)}</div>
    <div class="backstory">${esc(c.backstory)}</div>
    ${traitsHtml(c.traits)}
  </article>`;
}

// -------------------------------------------------------------- projects

function projectsTab(s: GameState): string {
  const worker = s.worker;
  if (!worker) return `<div class="empty">Hire someone first. Projects need a victim.</div>`;
  const current = s.project ? currentProjectHtml(s.project, worker) : '';
  const offers = s.pitches.length
    ? pitchesHtml(s.pitches, worker)
    : s.project
      ? ''
      : `<div class="empty">The product team is dreaming up new ideas...</div>`;
  return current + offers + releasesHtml(s.releases);
}

const STATUS: Record<string, string> = {
  working: 'Working on it',
  stuck: 'Stuck',
  coffee: 'On a coffee break',
  asleep: 'Asleep at the keyboard',
  arriving: 'Just arriving',
  idle: 'Idle',
  leaving: 'Leaving the company',
};

function currentProjectHtml(p: Project, worker: Worker): string {
  const parts = p.hardParts
    .map((h, i) => {
      const cls = [
        p.stuckOn === i ? 'now' : p.hardPartsHit.includes(i) ? 'done' : '',
        h.mystery ? 'mystery' : '',
      ].join(' ');
      const title = h.mystery ? `${esc(h.title)} (out of nowhere)` : esc(h.title);
      return `<li class="${cls}"><span class="at">${pct(h.at)}%</span>${title}</li>`;
    })
    .join('');
  const brief = p.filePath
    ? ` · <button class="link" data-action="open" data-path="${esc(p.filePath)}">brief</button>`
    : '';
  return `<div class="section card">
    <div class="who"><h3>${esc(p.title)}</h3>${stars(p.difficulty)}</div>
    <div class="muted">${esc(p.tagline)}</div>
    ${bar('progress', p.progress * 100)}
    <div class="muted">${pct(p.progress)}% · ${STATUS[worker.activity] ?? ''}${brief}</div>
    <ul class="hard-parts">${parts}</ul>
  </div>`;
}

function pitchesHtml(pitches: Pitch[], worker: Worker): string {
  const rows = [...pitches]
    .sort((a, b) => a.difficulty - b.difficulty)
    .map((p) => pitchRow(p, worker))
    .join('');
  return `<div class="section">
    <h2>Pick ${esc(worker.name)}'s next project</h2>
    <p class="note">Tap one for details. Edit a brief's struggle list before
    assigning it to change where they get stuck.</p>
    ${rows}
  </div>`;
}

function pitchRow(p: Pitch, worker: Worker): string {
  const over = p.difficulty > capacity(worker.level);
  const parts = p.hardParts
    .map((h) => `<li><span class="at">${pct(h.at)}%</span>${esc(h.title)}</li>`)
    .join('');
  const brief = p.filePath
    ? `<button data-action="open" data-path="${esc(p.filePath)}">Brief</button>`
    : '';
  return `<details class="pitch" data-pitch="${esc(p.id)}" ${openPitches.has(p.id) ? 'open' : ''}>
    <summary>${stars(p.difficulty)}<b>${esc(p.title)}</b>
      <span class="difficulty">${DIFFICULTY_NAMES[p.difficulty]}</span></summary>
    <div class="pitch-body">
      <div class="muted">${esc(p.tagline)}</div>
      <div>${esc(p.description)}</div>
      ${over ? `<div class="over-level">Above a ${worker.level}'s level. Expect suffering.</div>` : ''}
      <ul class="hard-parts">${parts}</ul>
      <div class="row-end">${brief}
        <button class="primary" data-action="assign" data-id="${esc(p.id)}">Assign</button></div>
    </div>
  </details>`;
}

function releasesHtml(releases: Release[]): string {
  if (releases.length === 0) return '';
  const rows = [...releases]
    .reverse()
    .slice(0, 12)
    .map((r) => {
      const title = r.filePath
        ? `<button class="link" data-action="open" data-path="${esc(r.filePath)}">${esc(r.title)}</button>`
        : esc(r.title);
      return `<li><span class="title">${title}</span>
        <span class="muted">${esc(r.grade)}</span></li>`;
    })
    .join('');
  return `<div class="section"><h2>Shipped</h2><ul class="shipped">${rows}</ul></div>`;
}

// ----------------------------------------------------------------- staff

function staffTab(s: GameState): string {
  const worker = s.worker;
  if (!worker) {
    return `${leftoversHtml(s.deskLeftovers)}<div class="empty"><h2>Nobody works here</h2>
      <p><button class="primary" data-action="tab" data-tab="hire">Hire someone</button></p></div>`;
  }
  const portrait = personSvg(worker.look, {
    pose: 'stand',
    expression: expressionFor(worker),
    size: 76,
    crop: 'bust',
  });
  return `<div class="section cand-top">
      <div class="portrait">${portrait}</div>
      <div>
        <h3>${esc(worker.name)} ${levelBadge(worker.level)}</h3>
        <div class="muted">${esc(worker.age)} · ${esc(worker.pronouns)} · ${worker.projectsDone} shipped</div>
        <div>${ATTITUDE_WORDS[worker.attitude]}</div>
      </div>
    </div>
    ${statsHtml(worker)}
    <div class="section">${traitsHtml(worker.traits)}</div>
    <div class="section"><h2>How you've treated them</h2>${ledgerHtml(worker)}</div>
    <div class="section"><h2>What they remember</h2>${memoriesHtml(worker)}</div>
    ${leftoversHtml(s.deskLeftovers)}`;
}

function statsHtml(worker: Worker): string {
  const { energy, mood, sanity } = worker.stats;
  const next = nextLevel(worker.level);
  let xpRow = `<span>XP</span>${bar('xp', 100)}<span class="num">max</span>`;
  if (next) {
    const from = xpFor(worker.level);
    const progress = ((worker.xp - from) / (xpFor(next) - from)) * 100;
    xpRow = `<span>XP</span>${bar('xp', progress)}<span class="num">${Math.floor(worker.xp)}</span>`;
  }
  return `<div class="section stats">
    <span>Energy</span>${bar('energy', energy)}<span class="num">${Math.round(energy)}</span>
    <span>Mood</span>${bar('mood', mood)}<span class="num">${Math.round(mood)}</span>
    <span>Sanity</span>${bar('sanity', sanity)}<span class="num">${Math.round(sanity)}</span>
    ${xpRow}
  </div>`;
}

function nextLevel(level: Level): Level | undefined {
  const order: Level[] = ['junior', 'mid', 'senior', 'lead'];
  return order[order.indexOf(level) + 1];
}

function ledgerHtml(worker: Worker): string {
  const l = worker.ledger;
  const items: [string, number][] = [
    ['Shocked', l.shocks],
    ['Shouted at', l.shouts],
    ['Code broken', l.sabotages ?? 0],
    ['Praised', l.praises],
    ['Bonuses', l.bonuses],
    ['Coffees', l.coffees],
    ['Kind chats', l.kindChats],
    ['Cruel chats', l.cruelChats],
  ];
  return `<div class="ledger">${items
    .map(([label, n]) => `<span>${label} ${n}×</span>`)
    .join('')}</div>`;
}

const MEMORY_ICONS = { boss: '👔', work: '💻', desk: '☕', self: '💭' } as const;

function memoriesHtml(worker: Worker): string {
  if (worker.memories.length === 0) return `<p class="muted">Nothing yet.</p>`;
  const items = [...worker.memories]
    .reverse()
    .slice(0, 12)
    .map((m) => `<li><span class="when">${MEMORY_ICONS[m.kind]} ${when(m.at)}</span>${esc(m.text)}</li>`)
    .join('');
  return `<ul class="memories">${items}</ul>`;
}

// ----------------------------------------------------------------- inbox

const OUTCOME_LABELS: Record<ComplaintOutcome, string> = {
  apology: 'Apology accepted',
  gaslit: 'They now think they imagined it',
  unconvinced: "They didn't buy it",
  backfired: 'That backfired',
};

function inboxTab(s: GameState): string {
  if (s.complaints.length === 0) {
    return `<div class="empty">No emails. Yet.</div>`;
  }
  const emails = [...s.complaints]
    .reverse()
    .map((c) => emailHtml(c, s))
    .join('');
  return `<p class="note">Answer however you like. Apologise, or convince them it never happened.</p>
    ${emails}`;
}

function emailHtml(c: Complaint, s: GameState): string {
  const here = s.worker?.id === c.workerId && s.worker.activity !== 'leaving';
  return `<article class="card email ${c.reply ? '' : 'open'}">
    <div class="email-head"><b>${esc(c.workerName)}</b><span class="muted">${when(c.filedAt)}</span></div>
    <div class="email-subject">${esc(c.subject)}</div>
    <div class="email-body">${esc(c.body)}</div>
    ${emailFooter(c, here)}
  </article>`;
}

function emailFooter(c: Complaint, here: boolean): string {
  if (!c.reply) {
    if (!here) return `<div class="note">They no longer work here.</div>`;
    return `<textarea data-reply="${esc(c.id)}" rows="3" maxlength="1000"
        placeholder="Reply... apologise, or tell them it never happened"></textarea>
      <div class="row-end"><button class="primary" data-action="reply" data-id="${esc(c.id)}">
        Send reply</button></div>`;
  }
  const yours = `<div class="email-reply"><b>You:</b> ${esc(c.reply)}</div>`;
  if (!c.outcome) return `${yours}<div class="note">Waiting for them to read it...</div>`;
  return `${yours}
    <div class="email-reply"><b>${esc(c.workerName.split(' ')[0])}:</b> ${esc(c.response)}</div>
    <span class="outcome ${c.outcome}">${OUTCOME_LABELS[c.outcome]}</span>`;
}

/** Opening the inbox counts as reading everything in it. */
function markInboxRead(s: GameState): void {
  for (const c of s.complaints) {
    if (c.readAt || markedRead.has(c.id)) continue;
    markedRead.add(c.id);
    api.readComplaint(c.id);
  }
}

// ------------------------------------------------------------------ chat

function chatTab(s: GameState): string {
  const hint = `<p class="note">Talk to them with the Chat button on the clipboard by
    their desk. This is the record of everything said.</p>`;
  if (s.chat.length === 0) return `${hint}<div class="empty">Nothing said yet.</div>`;
  const name = s.worker?.name ?? 'Worker';
  return `${hint}<div class="chat-log">${s.chat.map((l) => chatLine(l, name)).join('')}</div>`;
}

function chatLine(line: ChatLine, workerName: string): string {
  const who = line.from === 'boss' ? 'You' : line.from === 'worker' ? workerName : '';
  const label = who ? `${esc(who)} · ` : '';
  return `<div class="line ${line.from}"><span class="when">${label}${when(line.at)}</span>
    ${esc(line.text)}</div>`;
}

// -------------------------------------------------------------- settings

function settingsTab(s: GameState): string {
  const st = s.settings;
  const mac = navigator.userAgent.includes('Mac');
  const shortcut = mac ? '⌘ ⌥ ⇧ O' : 'Ctrl Alt Shift O';
  const check = checkingClaude
    ? '<span class="muted">Checking...</span>'
    : claudeCheck
      ? `<span class="check-result ${claudeCheck.ok ? 'ok' : 'bad'}">${esc(claudeCheck.message)}</span>`
      : '';
  const checked = (on: boolean): string => (on ? 'checked' : '');
  return `
    <div class="setting"><label class="check">
      <input type="checkbox" data-setting="alwaysOnTop" ${checked(st.alwaysOnTop)}>
      <span>Always on top<br><span class="note">Off lets them sink behind your windows.</span></span>
    </label></div>
    <div class="setting"><label class="check">
      <input type="checkbox" data-setting="hideFromScreenShare" ${checked(st.hideFromScreenShare)}>
      <span>Hide from screen share<br><span class="note">You still see them; Teams and
      Zoom shouldn't. Some Mac tools ignore this, so <kbd>${shortcut}</kbd> hides them fully.</span></span>
    </label></div>
    <div class="setting"><span class="label">Claude CLI</span>
      <div class="row"><input type="text" id="claude-path" value="${esc(st.claudePath)}"
        placeholder="Auto-detect"><button data-action="save-claude">Save</button>
        <button data-action="test-claude">Test</button></div>
      <p class="note">Runs on your Claude subscription. ${check}</p></div>
    <div class="setting"><span class="label">Model</span>
      <div class="row"><input type="text" id="model" value="${esc(st.model)}">
        <button data-action="save-model">Save</button></div></div>
    <div class="setting"><span class="label">Files folder</span>
      <div class="row"><input type="text" id="files-dir" value="${esc(st.filesDir)}">
        <button data-action="save-files">Save</button>
        <button data-action="open" data-path="${esc(st.filesDir)}">Open</button></div></div>
    <div class="setting"><span class="label">Show / hide the worker</span><kbd>${shortcut}</kbd></div>`;
}

// ------------------------------------------------------------- rendering

const TABS: Record<OfficeTab, (s: GameState) => string> = {
  hire: hireTab,
  projects: projectsTab,
  staff: staffTab,
  inbox: inboxTab,
  chat: chatTab,
  settings: settingsTab,
};

function render(force = false): void {
  if (!state) return;
  renderChrome(state);
  // Settings inputs would lose what you're typing if re-rendered every tick.
  if (tab === 'settings' && !force && lastHtml) return;
  const html = TABS[tab](state);
  if (!force && html === lastHtml) return;
  const atBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 20;
  const scroll = content.scrollTop;
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.reply;
  lastHtml = html;
  content.innerHTML = html;
  content.scrollTop = tab === 'chat' && atBottom ? content.scrollHeight : scroll;
  if (tab === 'inbox') restoreDrafts(focused);
}

/** Put half-written replies back after the DOM was rebuilt. */
function restoreDrafts(focused: string | undefined): void {
  for (const box of content.querySelectorAll<HTMLTextAreaElement>('textarea[data-reply]')) {
    const id = box.dataset.reply ?? '';
    box.value = drafts.get(id) ?? '';
    if (id === focused) box.focus();
  }
}

function renderChrome(s: GameState): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#tabs button')) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  }
  const worker = s.worker;
  byId('summary').textContent = worker
    ? `${worker.name}, ${worker.level}${s.project ? ` · “${s.project.title}”` : ''}`
    : 'Desk vacant';
  const brain = byId('brain');
  const labels = { ok: 'Claude connected', thinking: 'Thinking...', offline: 'Claude offline' };
  brain.title = labels[s.brainStatus];
  brain.className = `brain ${s.brainStatus}`;
  const unread = s.complaints.filter((c) => !c.readAt).length;
  const count = byId('inbox-count');
  count.hidden = unread === 0;
  count.textContent = String(unread);
  if (tab === 'inbox') markInboxRead(s);
}

function showTab(next: OfficeTab): void {
  tab = next;
  lastHtml = '';
  content.scrollTop = 0;
  render(true);
  if (next === 'chat') content.scrollTop = content.scrollHeight;
}

// ---------------------------------------------------------------- events

document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tab], [data-action]');
  if (!target) return;
  if (target.dataset.tab && !target.dataset.action) return showTab(target.dataset.tab as OfficeTab);
  void handleAction(target);
});

async function handleAction(el: HTMLElement): Promise<void> {
  const { action, id, path } = el.dataset;
  const count = state?.candidates.length ?? 0;
  switch (action) {
    case 'tab':
      return showTab((el.dataset.tab ?? 'staff') as OfficeTab);
    case 'prev':
      candidateIndex = (candidateIndex - 1 + count) % Math.max(1, count);
      return render(true);
    case 'next':
      candidateIndex = (candidateIndex + 1) % Math.max(1, count);
      return render(true);
    case 'hire':
      if (id) await api.hire(id);
      return showTab('projects');
    case 'reroll':
      return api.rerollCandidates();
    case 'assign':
      if (id) await api.assign(id);
      return;
    case 'open':
      if (path) api.openPath(path);
      return;
    case 'save-claude':
      await api.updateSettings({ claudePath: inputValue('claude-path') });
      claudeCheck = undefined;
      return render(true);
    case 'save-model':
      await api.updateSettings({ model: inputValue('model') });
      return render(true);
    case 'save-files':
      await api.updateSettings({ filesDir: inputValue('files-dir') });
      return render(true);
    case 'test-claude':
      return testClaude();
    case 'reply':
      return sendReply(id);
  }
}

async function sendReply(id: string | undefined): Promise<void> {
  if (!id) return;
  const text = (drafts.get(id) ?? '').trim();
  if (!text) return;
  drafts.delete(id);
  await api.replyToComplaint(id, text);
}

content.addEventListener('input', (event) => {
  const box = event.target as HTMLTextAreaElement;
  if (box.dataset.reply) drafts.set(box.dataset.reply, box.value);
});

// Remember which pitch rows are open across the five-second re-renders.
content.addEventListener(
  'toggle',
  (event) => {
    const el = event.target as HTMLDetailsElement;
    const id = el.dataset.pitch;
    if (!id) return;
    if (el.open) openPitches.add(id);
    else openPitches.delete(id);
    lastHtml = '';
  },
  true,
);

async function testClaude(): Promise<void> {
  checkingClaude = true;
  render(true);
  try {
    claudeCheck = await api.testClaude();
  } finally {
    checkingClaude = false;
    render(true);
  }
}

function inputValue(id: string): string {
  return byId<HTMLInputElement>(id).value.trim();
}

document.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  const key = input.dataset.setting;
  if (key === 'alwaysOnTop' || key === 'hideFromScreenShare') {
    void api.updateSettings({ [key]: input.checked });
  }
});

byId('close').addEventListener('click', () => window.close());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.close();
});

api.onState((next) => {
  state = next;
  render();
});
api.onOfficeTab((next) => showTab(next));
void api.getState().then((initial) => {
  state = initial;
  const query = new URLSearchParams(location.search).get('tab') as OfficeTab | null;
  showTab(query ?? (initial.worker ? 'staff' : 'hire'));
});
