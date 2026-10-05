/**
 * The office window: hiring, picking projects, the staff file, the chat log
 * and settings. Re-renders from the full GameState pushed by the main
 * process, skipping the DOM work when a tab's HTML hasn't changed.
 */

import { capacity, xpFor } from '../../game/levels';
import type { ClaudeCheck, OfficeTab } from '../../shared/ipc';
import type {
  Attitude,
  Candidate,
  ChatLine,
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

const content = byId('content');
const chatEntry = byId('chat-entry');
const chatInput = byId<HTMLInputElement>('chat-input');

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

function stars(d: Difficulty): string {
  return '★'.repeat(d) + '☆'.repeat(5 - d);
}

const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  1: 'Trivial',
  2: 'Easy',
  3: 'Tricky',
  4: 'Hard',
  5: 'Nightmare',
};

const ATTITUDE_WORDS: Record<Attitude, string> = {
  neutral: 'Neutral. Thinks you are just a boss.',
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
    <span>Stamina</span><span class="pips">${pips(t.stamina)}</span>
    <span>Resilience</span><span class="pips">${pips(t.resilience)}</span>
    <span>Talent</span><span class="pips">${pips(t.talent)}</span>
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
          ? `A sticky note from ${esc(l.fromWorker)}: “${esc(l.text)}”`
          : `${esc(l.fromWorker)}'s unfinished project: ${esc(l.text)}`;
    return `<div>${what}</div>`;
  });
  return `<div class="banner"><b>Left on the desk</b>${items.join('')}</div>`;
}

// ------------------------------------------------------------------ tabs

function hireTab(s: GameState): string {
  const worker = s.worker;
  if (worker && worker.activity !== 'leaving') {
    return `<div class="empty">
      <h2>${esc(worker.name)} is at the desk</h2>
      <p>To hire someone else you'll have to get rid of them first<br>
      (clipboard on their desk → Fire).</p></div>`;
  }
  const cards = s.candidates.map(candidateCard).join('');
  const loading = `<div class="empty">The recruiter is digging up some candidates...</div>`;
  return `<div class="section">
      <h2>We're hiring</h2>
      <p class="note">Pick someone to sit at the desk. Juniors are cheap, fragile and
      easily broken by hard projects.</p>
      ${leftoversHtml(s.deskLeftovers)}
      ${cards ? `<div class="grid">${cards}</div>` : loading}
    </div>
    <div class="row-end">
      <button data-action="reroll" ${s.brainStatus === 'thinking' ? 'disabled' : ''}>
        Show 3 more</button>
    </div>`;
}

function candidateCard(c: Candidate): string {
  const portrait = personSvg(c.look, { pose: 'stand', expression: 'happy', size: 120 });
  return `<article class="card">
    <div class="portrait">${portrait}</div>
    <div class="who"><h3>${esc(c.name)}</h3>${levelBadge(c.level)}</div>
    <div class="muted">${esc(c.age)} · ${esc(c.pronouns)}</div>
    <div class="field"><b>Specialty</b> ${esc(c.specialty)}</div>
    <div class="field"><b>Personality</b> ${esc(c.personality)}</div>
    <div class="field"><b>Quirk</b> ${esc(c.quirk)}</div>
    <div class="field red-flag"><b>Red flag</b> ${esc(c.redFlag)}</div>
    <div class="backstory">${esc(c.backstory)}</div>
    ${traitsHtml(c.traits)}
    <div class="actions">
      <button class="primary" data-action="hire" data-id="${esc(c.id)}">Hire</button>
    </div>
  </article>`;
}

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

function currentProjectHtml(p: Project, worker: Worker): string {
  const status: Record<string, string> = {
    working: 'Working on it',
    stuck: 'Stuck',
    coffee: 'On a coffee break',
    asleep: 'Asleep at the keyboard',
    arriving: 'Just arriving',
    idle: 'Idle',
    leaving: 'Leaving the company',
  };
  const parts = p.hardParts
    .map((h, i) => {
      const cls = p.stuckOn === i ? 'now' : p.hardPartsHit.includes(i) ? 'done' : '';
      return `<li class="${cls}"><span class="at">${pct(h.at)}%</span>
        ${esc(h.title)} <span class="muted">· ${esc(h.detail)}</span></li>`;
    })
    .join('');
  const brief = p.filePath
    ? `<button class="link" data-action="open" data-path="${esc(p.filePath)}">Open brief</button>`
    : '';
  return `<div class="section card">
    <div class="who"><h3>Now: ${esc(p.title)}</h3>
      <span class="stars" title="${DIFFICULTY_NAMES[p.difficulty]}">${stars(p.difficulty)}</span></div>
    <div class="muted">${esc(p.tagline)}</div>
    ${bar('progress', p.progress * 100)}
    <div class="muted">${pct(p.progress)}% · ${status[worker.activity] ?? ''} ${brief}</div>
    <ul class="hard-parts">${parts}</ul>
  </div>`;
}

function pitchesHtml(pitches: Pitch[], worker: Worker): string {
  const cards = [...pitches]
    .sort((a, b) => a.difficulty - b.difficulty)
    .map((p) => pitchCard(p, worker))
    .join('');
  return `<div class="section">
    <h2>Pick ${esc(worker.name)}'s next project</h2>
    <p class="note">Each idea has a brief in your files folder. Edit its “Where the
    developer will struggle” list before assigning it to change where they get stuck.</p>
    <div class="grid">${cards}</div>
  </div>`;
}

function pitchCard(p: Pitch, worker: Worker): string {
  const over = p.difficulty > capacity(worker.level);
  const parts = p.hardParts
    .map((h) => `<li><span class="at">${pct(h.at)}%</span>${esc(h.title)}</li>`)
    .join('');
  const brief = p.filePath
    ? `<button data-action="open" data-path="${esc(p.filePath)}">Read / edit brief</button>`
    : '';
  return `<article class="card">
    <div class="who"><span class="stars">${stars(p.difficulty)}</span>
      <span class="difficulty">${DIFFICULTY_NAMES[p.difficulty]}</span></div>
    <h3>${esc(p.title)}</h3>
    <div class="muted">${esc(p.tagline)}</div>
    <div class="field">${esc(p.description)}</div>
    ${over ? `<div class="over-level">Above a ${worker.level}'s level. Expect suffering.</div>` : ''}
    <div class="field"><b>Where they'll struggle</b></div>
    <ul class="hard-parts">${parts}</ul>
    <div class="actions">${brief}
      <button class="primary" data-action="assign" data-id="${esc(p.id)}">Assign</button>
    </div>
  </article>`;
}

function releasesHtml(releases: Release[]): string {
  if (releases.length === 0) return '';
  const rows = [...releases]
    .reverse()
    .map((r) => {
      const notes = r.filePath
        ? `<button class="link" data-action="open" data-path="${esc(r.filePath)}">notes</button>`
        : '';
      return `<tr><td>${esc(r.title)}</td><td>${esc(r.workerName)}</td>
        <td>${esc(r.grade)}</td><td>${when(r.finishedAt)}</td><td>${notes}</td></tr>`;
    })
    .join('');
  return `<div class="section"><h2>Shipped</h2><table>
    <tr><th>App</th><th>Built by</th><th>Verdict</th><th>When</th><th></th></tr>
    ${rows}</table></div>`;
}

function staffTab(s: GameState): string {
  const worker = s.worker;
  if (!worker) {
    return `<div class="empty"><h2>Nobody works here right now</h2>
      <p><button class="primary" data-action="tab" data-tab="hire">Hire someone</button></p>
      </div>${leftoversHtml(s.deskLeftovers)}`;
  }
  const portrait = personSvg(worker.look, {
    pose: 'stand',
    expression: expressionFor(worker),
    size: 180,
  });
  return `<div class="staff">
    <div>
      <div class="portrait">${portrait}</div>
      ${traitsHtml(worker.traits)}
    </div>
    <div>
      <div class="who"><h2>${esc(worker.name)}</h2>${levelBadge(worker.level)}</div>
      <p class="muted">${esc(worker.age)} · ${esc(worker.pronouns)} · ${esc(worker.specialty)}<br>
        Hired ${when(worker.hiredAt)} · ${worker.projectsDone} shipped</p>
      <p><b>Attitude to you:</b> ${ATTITUDE_WORDS[worker.attitude]}</p>
      ${statsHtml(worker)}
      <div class="section"><h2>How you've treated them</h2>${ledgerHtml(worker)}</div>
      <div class="section"><h2>What they remember</h2>${memoriesHtml(worker)}</div>
      ${leftoversHtml(s.deskLeftovers)}
    </div>
  </div>`;
}

function statsHtml(worker: Worker): string {
  const { energy, mood, sanity } = worker.stats;
  const next = nextLevel(worker.level);
  const xpRow = next
    ? (() => {
        const from = xpFor(worker.level);
        const to = xpFor(next);
        const progress = ((worker.xp - from) / (to - from)) * 100;
        return `<span>XP</span>${bar('xp', progress)}<span class="num">${Math.floor(worker.xp)}</span>`;
      })()
    : `<span>XP</span>${bar('xp', 100)}<span class="num">max</span>`;
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
    .map(
      (m) => `<li><span class="when">${MEMORY_ICONS[m.kind]} ${when(m.at)}</span>${esc(m.text)}</li>`,
    )
    .join('');
  return `<ul class="memories">${items}</ul>`;
}

function chatTab(s: GameState): string {
  if (s.chat.length === 0) {
    return `<div class="empty">No conversations yet. Say hello, or don't.</div>`;
  }
  const name = s.worker?.name ?? 'Worker';
  const lines = s.chat.map((line) => chatLine(line, name)).join('');
  return `<div class="chat-log">${lines}</div>`;
}

function chatLine(line: ChatLine, workerName: string): string {
  const who = line.from === 'boss' ? 'You' : line.from === 'worker' ? workerName : '';
  const label = who ? `${esc(who)} · ` : '';
  return `<div class="line ${line.from}"><span class="when">${label}${when(line.at)}</span>
    ${esc(line.text)}</div>`;
}

function settingsTab(s: GameState): string {
  const st = s.settings;
  const mac = navigator.userAgent.includes('Mac');
  const shortcut = mac ? '⌘ ⌥ ⇧ O' : 'Ctrl Alt Shift O';
  const check = checkingClaude
    ? '<span class="muted">Checking...</span>'
    : claudeCheck
      ? `<span class="check-result ${claudeCheck.ok ? 'ok' : 'bad'}">${esc(claudeCheck.message)}</span>`
      : '';
  return `<div class="section">
    <div class="setting"><label>Always on top</label>
      <div><input type="checkbox" data-setting="alwaysOnTop" ${st.alwaysOnTop ? 'checked' : ''}>
      <span class="note">Turn off to let them sink behind your other windows.</span></div></div>
    <div class="setting"><label>Hide from screen share</label>
      <div><input type="checkbox" data-setting="hideFromScreenShare" ${st.hideFromScreenShare ? 'checked' : ''}>
      <span class="note">You still see them; Teams and Zoom shouldn't. Some macOS
      sharing tools ignore this, so use <kbd>${shortcut}</kbd> to hide them completely.</span></div></div>
    <div class="setting"><label>Claude CLI</label>
      <div>
        <div class="row"><input type="text" id="claude-path" value="${esc(st.claudePath)}"
          placeholder="Auto-detect"><button data-action="save-claude">Save</button>
          <button data-action="test-claude">Test</button></div>
        <p class="note">Your worker thinks with the Claude Code CLI you're logged in to,
        on your subscription. Leave blank to find it automatically. ${check}</p>
      </div></div>
    <div class="setting"><label>Model</label>
      <div class="row"><input type="text" id="model" value="${esc(st.model)}">
        <button data-action="save-model">Save</button></div></div>
    <div class="setting"><label>Files folder</label>
      <div><div class="row"><input type="text" id="files-dir" value="${esc(st.filesDir)}">
        <button data-action="save-files">Save</button>
        <button data-action="open" data-path="${esc(st.filesDir)}">Open</button></div>
        <p class="note">Project briefs and release notes are written here.</p></div></div>
    <div class="setting"><label>Show / hide the worker</label>
      <div><kbd>${shortcut}</kbd></div></div>
  </div>`;
}

// ----------------------------------------------------------- rendering

const TABS: Record<OfficeTab, (s: GameState) => string> = {
  hire: hireTab,
  projects: projectsTab,
  staff: staffTab,
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
  lastHtml = html;
  content.innerHTML = html;
  if (tab === 'chat' && atBottom) content.scrollTop = content.scrollHeight;
}

function renderChrome(s: GameState): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#tabs button')) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  }
  const worker = s.worker;
  byId('summary').textContent = worker
    ? `${worker.name}, ${worker.level} developer${s.project ? ` · on “${s.project.title}”` : ''}`
    : 'Desk vacant';
  const brain = byId('brain');
  const labels = { ok: '● Claude connected', thinking: '● thinking...', offline: '● Claude offline' };
  brain.textContent = labels[s.brainStatus];
  brain.classList.toggle('offline', s.brainStatus === 'offline');
  chatEntry.hidden = tab !== 'chat';
  chatInput.disabled = !worker || worker.activity === 'leaving';
}

function showTab(next: OfficeTab): void {
  tab = next;
  lastHtml = '';
  render(true);
  if (next === 'chat') {
    content.scrollTop = content.scrollHeight;
    chatInput.focus();
  }
}

// --------------------------------------------------------------- events

document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tab], [data-action]');
  if (!target) return;
  if (target.dataset.tab && !target.dataset.action) return showTab(target.dataset.tab as OfficeTab);
  void handleAction(target);
});

async function handleAction(el: HTMLElement): Promise<void> {
  const { action, id, path } = el.dataset;
  switch (action) {
    case 'tab':
      return showTab((el.dataset.tab ?? 'staff') as OfficeTab);
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
  }
}

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

byId('chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  void api.chat(text);
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
