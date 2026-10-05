/**
 * The HTML layer over the scene: speech bubble, hover card, boss menu, chat
 * field and tooltips, plus pointer tracking for click-through.
 *
 * The window ignores the mouse except over elements marked `data-hit`; this
 * module watches which one the pointer is over and tells the main process
 * only when that changes.
 */

import type { DirectAction, OfficeTab, OvertimeApi } from '../../shared/ipc';
import type { Attitude, GameState, Level, Worker } from '../../shared/types';
import { personSvg } from '../shared/person';
import { esc } from '../shared/svg';
import { SCENE_W } from './scene';
import type { SceneView } from './view';

type MenuAction = 'chat' | 'coffee' | 'praise' | 'shout' | 'bonus' | 'fire' | 'office';

const LEVEL_NAME: Record<Level, string> = {
  junior: 'Junior',
  mid: 'Mid-level',
  senior: 'Senior',
  lead: 'Lead',
};

const ATTITUDE_NAME: Record<Attitude, string> = {
  neutral: 'Neutral',
  loyal: 'Loyal',
  scared: 'Scared of you',
  bitter: 'Bitter',
  'sucking-up': 'Sucking up',
};

const ICON_PATHS: Record<MenuAction, string> = {
  chat: '<path d="M4 5h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 4v-4H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" fill="#fff"/><circle cx="8" cy="11" r="1.4" fill="#2a2238" stroke="none"/><circle cx="12" cy="11" r="1.4" fill="#2a2238" stroke="none"/><circle cx="16" cy="11" r="1.4" fill="#2a2238" stroke="none"/>',
  coffee: '<path d="M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" fill="#fff"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16" fill="none"/><path d="M8 3c-1 1.5 1 2.5 0 4M12 3c-1 1.5 1 2.5 0 4" fill="none"/>',
  praise: '<path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z" fill="#fff"/>',
  shout: '<path d="M3 10v4h3l7 5V5L6 10z" fill="#fff"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none"/>',
  bonus: '<rect x="2.5" y="6" width="19" height="12" rx="2" fill="#fff"/><circle cx="12" cy="12" r="3" fill="none"/><path d="M5.5 9v0M18.5 15v0" fill="none"/>',
  fire: '<path d="M5 3h9v18H5z" fill="#fff"/><circle cx="11.5" cy="12" r="0.9" fill="#2a2238" stroke="none"/><path d="M15.5 12h6M19 9l3 3-3 3" fill="none"/>',
  office: '<path d="M4 21V5l8-2v18M12 8h8v13" fill="#fff"/><path d="M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2M2 21h20" fill="none"/>',
};

const MENU: Array<{ action: MenuAction; label: string; colour: string }> = [
  { action: 'chat', label: 'Chat', colour: '#8fc1ff' },
  { action: 'coffee', label: 'Coffee', colour: '#e3b98d' },
  { action: 'praise', label: 'Praise', colour: '#ffe27a' },
  { action: 'shout', label: 'Shout', colour: '#ffb067' },
  { action: 'bonus', label: 'Bonus', colour: '#9be8a6' },
  { action: 'fire', label: 'Fire', colour: '#ff9a9a' },
  { action: 'office', label: 'Office', colour: '#cdbdf5' },
];

function icon(action: MenuAction): string {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#2a2238" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[action]}</svg>`;
}

function today(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function statusLine(w: Worker, state: GameState): string {
  const p = state.project;
  switch (w.activity) {
    case 'arriving':
      return 'Just arriving';
    case 'idle':
      return p ? 'Slacking off' : 'Waiting for a project';
    case 'working':
      return p ? `Building ${p.title}` : 'Working';
    case 'stuck': {
      const hp = p && p.stuckOn !== undefined ? p.hardParts[p.stuckOn] : undefined;
      return hp ? `Stuck: ${hp.title}` : 'Stuck';
    }
    case 'coffee':
      return 'On a coffee break';
    case 'asleep':
      return 'Asleep at the desk';
    case 'leaving':
      return 'Leaving. For good.';
  }
}

function el<T extends HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

export class OverlayUi {
  private readonly bubble: HTMLDivElement;
  private readonly bubbleText: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly menu: HTMLDivElement;
  private readonly chat: HTMLFormElement;
  private readonly chatInput: HTMLInputElement;
  private readonly tip: HTMLDivElement;

  private state?: GameState;
  private hitEl: Element | null = null;
  private interactive = false;
  private menuOpen = false;
  private confirming = false;
  private chatOpen = false;
  private chatFocused = false;
  private cardOpen = false;
  private cardTimer = 0;
  private bubbleShown = '';
  private bubbleTimer = 0;
  private followFrame = 0;
  private portraitKey = '';
  private lastHead = { x: NaN, top: NaN };
  private bubbleSize = { w: 0, h: 0 };

  constructor(
    private readonly api: OvertimeApi,
    private readonly view: SceneView,
    private readonly stage: HTMLElement,
  ) {
    this.bubble = el(`<div class="bubble say" aria-live="polite"><div class="bubble-text"></div></div>`);
    this.bubbleText = this.bubble.querySelector('.bubble-text') as HTMLDivElement;
    this.card = el(`<div class="card" hidden></div>`);
    this.menu = el(this.menuMarkup());
    this.chat = el(
      `<form class="chat" data-hit="chat" hidden autocomplete="off">` +
        `<input class="chat-input" type="text" maxlength="400" spellcheck="true" aria-label="Message">` +
        `<button class="chat-send" type="submit" aria-label="Send"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 11.5L21 3l-6.5 18-3-7.5z" fill="#fff" stroke="#2a2238" stroke-width="1.8" stroke-linejoin="round"/></svg></button>` +
        `<div class="chat-hint">Enter to send · Esc to close</div>` +
        `</form>`,
    );
    this.chatInput = this.chat.querySelector('input') as HTMLInputElement;
    this.tip = el(`<div class="tip" hidden></div>`);
    stage.append(this.bubble, this.card, this.menu, this.chat, this.tip);
    this.bind();
    view.onSegment = () => this.updateBubble();
  }

  /** Apply a new game state to the HTML layer. */
  update(state: GameState): void {
    this.state = state;
    this.updateBubble();
    if (this.cardOpen) this.fillCard();
    if (this.menuOpen) this.refreshMenu();
    if (!this.view.shownWorker && this.chatOpen) this.closeChat();
  }

  // ---------------------------------------------------------- pointer

  private bind(): void {
    document.addEventListener('mousemove', (e) => this.onMove(e.clientX, e.clientY));
    document.documentElement.addEventListener('mouseleave', () => this.setHit(null));
    document.addEventListener('click', (e) => this.onClick(e));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.chatOpen) this.closeChat();
      else if (this.menuOpen) this.closeMenu();
    });
    this.chat.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.chatInput.value.trim();
      if (text) void this.api.chat(text);
      this.closeChat();
    });
    this.chatInput.addEventListener('focus', () => {
      this.chatFocused = true;
      this.syncInteractive();
    });
    this.chatInput.addEventListener('blur', () => {
      this.chatFocused = false;
      this.syncInteractive();
    });
  }

  private onMove(x: number, y: number): void {
    const target = document.elementFromPoint(x, y);
    this.setHit(target?.closest('[data-hit]') ?? null);
  }

  private setHit(next: Element | null): void {
    if (next === this.hitEl) return;
    this.hitEl?.classList.remove('hover');
    this.hitEl = next;
    next?.classList.add('hover');
    const key = next?.getAttribute('data-hit') ?? '';
    this.view.setPointerOver(key === 'worker');
    this.onHoverWorker(key === 'worker');
    this.showTip(next, key);
    this.syncInteractive();
  }

  private syncInteractive(): void {
    const on = this.hitEl !== null || this.menuOpen || this.chatFocused;
    if (on === this.interactive) return;
    this.interactive = on;
    this.api.setInteractive(on);
  }

  private onClick(e: MouseEvent): void {
    // Hit-test the point ourselves: while a hovered SVG part is mid-transition
    // Chromium can report the click on the <svg> root instead of the part.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const target = under ?? (e.target instanceof Element ? e.target : null);
    const inMenu = target?.closest('.menu');
    if (inMenu) {
      this.onMenuClick(target);
      return;
    }
    if (target?.closest('.chat')) return;
    const hit = target?.closest('[data-hit]')?.getAttribute('data-hit');
    if (this.menuOpen && hit !== 'clipboard') this.closeMenu();
    switch (hit) {
      case 'worker':
        this.shock();
        return;
      case 'clipboard':
        if (this.menuOpen) this.closeMenu();
        else this.openMenu();
        return;
      case 'hiring':
        this.office('hire');
        return;
      case 'needs-project':
        this.office('projects');
        return;
      case 'offline':
        this.office('settings');
        return;
      case 'monitor':
        if (this.state?.project) this.office('projects');
        return;
    }
  }

  private office(tab: OfficeTab): void {
    this.api.openOffice(tab);
  }

  private shock(): void {
    if (!this.view.clickable) return;
    this.view.effect({ type: 'zap' }, true);
    // Mid-shock is no time for a stats card; it comes back on the next hover.
    window.clearTimeout(this.cardTimer);
    this.hideCard();
    void this.api.act({ type: 'shock' });
  }

  // ------------------------------------------------------------- tips

  private showTip(target: Element | null, key: string): void {
    const text = key ? (this.view.tipFor(key) ?? target?.getAttribute('data-tip') ?? '') : '';
    if (!text || this.menuOpen || key === 'worker') {
      this.tip.hidden = true;
      return;
    }
    this.tip.textContent = text;
    this.tip.hidden = false;
    const box = target?.getBoundingClientRect();
    const stageBox = this.stage.getBoundingClientRect();
    if (!box) return;
    const w = this.tip.offsetWidth;
    const h = this.tip.offsetHeight;
    const cx = box.left + box.width / 2 - stageBox.left;
    const left = Math.max(4, Math.min(SCENE_W - w - 4, cx - w / 2));
    const top = Math.max(4, box.top - stageBox.top - h - 6);
    this.tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  /** Show a tooltip for a `data-hit` key without the pointer (previews). */
  previewTip(key: string): void {
    const target = this.stage.querySelector(`[data-hit="${key}"]`);
    if (target) this.showTip(target, key);
  }

  // ------------------------------------------------------------- card

  private onHoverWorker(on: boolean): void {
    window.clearTimeout(this.cardTimer);
    if (on && this.view.clickable && !this.menuOpen) {
      this.cardTimer = window.setTimeout(() => this.showCard(), 280);
    } else {
      this.cardTimer = window.setTimeout(() => this.hideCard(), 120);
    }
  }

  /** Open the hover card next to the worker. */
  showCard(): void {
    if (!this.view.shownWorker) return;
    this.cardOpen = true;
    this.fillCard();
    this.card.hidden = false;
    const h = this.view.head();
    const w = this.card.offsetWidth;
    const ht = this.card.offsetHeight;
    const left = h.x > SCENE_W / 2 ? h.x - w - 26 : h.x + 26;
    const top = Math.max(4, Math.min(300 - ht, h.y - ht / 2 - 10));
    this.card.style.transform = `translate(${Math.round(Math.max(4, left))}px, ${Math.round(top)}px)`;
  }

  private hideCard(): void {
    this.cardOpen = false;
    this.card.hidden = true;
  }

  private fillCard(): void {
    const w = this.view.shownWorker;
    const s = this.state;
    if (!w || !s) return;
    const bar = (label: string, value: number, cls: string): string =>
      `<div class="bar ${cls}${value < 25 ? ' low' : ''}"><span class="bar-label">${label}</span>` +
      `<span class="bar-track"><span class="bar-fill" style="width:${Math.round(Math.max(0, Math.min(100, value)))}%"></span></span>` +
      `<span class="bar-val">${Math.round(value)}</span></div>`;
    const p = s.project;
    const project = p
      ? `<div class="card-project"><span class="card-project-title">${esc(p.title)}</span><span class="card-project-pct">${Math.floor(p.progress * 100)}%</span></div>` +
        `<div class="card-progress"><span style="width:${Math.round(p.progress * 100)}%"></span></div>`
      : '';
    const portraitKey = JSON.stringify(w.look);
    const head =
      `<div class="card-head"><div class="card-portrait"></div><div class="card-id">` +
      `<div class="card-name">${esc(w.name)}</div>` +
      `<div class="card-meta">${LEVEL_NAME[w.level]} · ${ATTITUDE_NAME[w.attitude]}</div></div></div>`;
    // The portrait is the only costly part; keep it across refreshes.
    const portrait = this.card.querySelector('.card-portrait')?.innerHTML;
    this.card.innerHTML =
      head +
      `<div class="card-status">${esc(statusLine(w, s))}</div>` +
      bar('Energy', w.stats.energy, 'energy') +
      bar('Mood', w.stats.mood, 'mood') +
      bar('Sanity', w.stats.sanity, 'sanity') +
      project;
    const slot = this.card.querySelector('.card-portrait');
    if (!slot) return;
    if (portrait && portraitKey === this.portraitKey) slot.innerHTML = portrait;
    else {
      slot.innerHTML = personSvg(w.look, { pose: 'stand', expression: 'neutral', crop: 'bust', size: 34 });
      this.portraitKey = portraitKey;
    }
  }

  // ------------------------------------------------------------- menu

  private menuMarkup(): string {
    const items = MENU.map(
      (m) =>
        `<button class="item" type="button" data-act="${m.action}" style="--c:${m.colour}">${icon(m.action)}<span class="item-label">${m.label}</span><span class="item-note"></span></button>`,
    ).join('');
    return (
      `<div class="menu" data-hit="menu" hidden role="menu">` +
      `<div class="menu-head"><span class="menu-title">Boss menu</span><span class="menu-who"></span>` +
      `<button class="menu-x" type="button" data-act="close" aria-label="Close">✕</button></div>` +
      `<div class="menu-grid">${items}</div>` +
      `<div class="menu-confirm" hidden><div class="confirm-q"></div>` +
      `<div class="confirm-row"><button class="confirm-yes" type="button" data-act="fire-yes">Yes, fire</button>` +
      `<button class="confirm-no" type="button" data-act="fire-no">No</button></div></div>` +
      `</div>`
    );
  }

  /** Open the boss menu above the clipboard. */
  openMenu(): void {
    this.menuOpen = true;
    this.confirming = false;
    this.hideCard();
    this.tip.hidden = true;
    this.refreshMenu();
    this.menu.hidden = false;
    this.syncInteractive();
  }

  private closeMenu(): void {
    this.menuOpen = false;
    this.confirming = false;
    this.menu.hidden = true;
    this.syncInteractive();
  }

  private refreshMenu(): void {
    const w = this.view.shownWorker;
    const s = this.state;
    const present = !!w && w.activity !== 'leaving' && w.activity !== 'arriving';
    const who = this.menu.querySelector('.menu-who');
    if (who) who.textContent = w ? w.name : 'nobody hired';
    const bonusUsed = w?.lastBonusDay === today();
    for (const b of this.menu.querySelectorAll<HTMLButtonElement>('button.item')) {
      const action = b.dataset.act as MenuAction;
      let ok = action === 'office' || present;
      let note = '';
      if (action === 'coffee' && w?.activity === 'coffee') {
        ok = false;
        note = 'on it';
      }
      if (action === 'bonus' && bonusUsed) {
        ok = false;
        note = 'tomorrow';
      }
      if (action === 'chat' && s?.brainStatus === 'offline' && present) note = 'offline';
      b.disabled = !ok;
      const n = b.querySelector('.item-note');
      if (n) n.textContent = note;
    }
    const grid = this.menu.querySelector<HTMLElement>('.menu-grid');
    const confirm = this.menu.querySelector<HTMLElement>('.menu-confirm');
    if (grid) grid.hidden = this.confirming;
    if (confirm) confirm.hidden = !this.confirming;
    const q2 = this.menu.querySelector('.confirm-q');
    if (q2) q2.textContent = `Really fire ${w?.name ?? 'them'}?`;
  }

  /** Show the "Really fire?" question (also used by previews). */
  askFire(): void {
    this.confirming = true;
    this.refreshMenu();
  }

  private onMenuClick(target: Element | null): void {
    const act = target?.closest('button')?.getAttribute('data-act');
    if (!act) return;
    if (target?.closest('button')?.hasAttribute('disabled')) return;
    switch (act) {
      case 'close':
      case 'fire-no':
        if (act === 'fire-no' && this.confirming) {
          this.confirming = false;
          this.refreshMenu();
        } else this.closeMenu();
        return;
      case 'fire':
        this.askFire();
        return;
      case 'fire-yes':
        this.send({ type: 'fire' });
        return;
      case 'chat':
        this.closeMenu();
        this.openChat();
        return;
      case 'office':
        this.closeMenu();
        this.office('staff');
        return;
      case 'coffee':
      case 'praise':
      case 'shout':
      case 'bonus':
        this.send({ type: act });
        return;
    }
  }

  private send(action: DirectAction): void {
    void this.api.act(action);
    this.closeMenu();
  }

  // ------------------------------------------------------------- chat

  /** Open the chat field above the scene and focus it. */
  openChat(draft = ''): void {
    const w = this.view.shownWorker;
    if (!w) return;
    this.chatOpen = true;
    this.chatInput.placeholder = `Say something to ${w.name.split(' ')[0] ?? w.name}…`;
    this.chatInput.value = draft;
    this.chat.hidden = false;
    // The overlay is a non-activating corner window; ask for focus so the
    // field can take keystrokes.
    window.focus();
    this.chatInput.focus();
    this.syncInteractive();
  }

  private closeChat(): void {
    this.chatOpen = false;
    this.chat.hidden = true;
    this.chatInput.blur();
    this.chatFocused = false;
    this.syncInteractive();
  }

  // ----------------------------------------------------------- bubble

  private updateBubble(): void {
    const shout = this.view.shout;
    const b = this.state?.bubble;
    const now = Date.now();
    let kind = '';
    let text = '';
    if (shout) {
      kind = 'shout';
      text = shout;
    } else if (b && b.until > now && this.view.shownWorker && this.view.head().visible) {
      kind = b.kind;
      text = b.text;
    }
    const key = `${kind}|${text}|${b?.until ?? ''}`;
    if (key === this.bubbleShown) return;
    this.bubbleShown = key;
    window.clearTimeout(this.bubbleTimer);
    if (!kind) {
      this.bubble.classList.remove('show');
      this.stopFollow();
      return;
    }
    this.bubble.className = `bubble ${kind}`;
    this.bubbleText.textContent = text;
    this.positionBubble(true);
    // Next frame, so the fade-in transition runs from opacity 0.
    requestAnimationFrame(() => this.bubble.classList.add('show'));
    this.startFollow();
    if (kind !== 'shout' && b) {
      const left = b.until - now;
      this.bubbleTimer = window.setTimeout(() => {
        this.bubble.classList.remove('show');
        window.setTimeout(() => {
          this.bubbleShown = '';
          this.updateBubble();
        }, 400);
      }, Math.max(0, left - 400));
    }
  }

  private positionBubble(force = false): void {
    const h = this.view.head();
    // Only walks move the head; skip frames where nothing changed.
    if (!force && Math.abs(h.x - this.lastHead.x) < 0.3 && Math.abs(h.top - this.lastHead.top) < 0.3) return;
    this.lastHead = { x: h.x, top: h.top };
    if (force) this.bubbleSize = { w: this.bubble.offsetWidth, h: this.bubble.offsetHeight };
    const w = this.bubbleSize.w;
    const ht = this.bubbleSize.h;
    const shout = this.bubble.classList.contains('shout');
    const gap = this.bubble.classList.contains('think') ? 22 : 13;
    const ideal = h.x - w / 2;
    // Shouts follow the worker off-screen; normal bubbles stay readable.
    const left = shout ? ideal : Math.max(6, Math.min(SCENE_W - w - 6, ideal));
    const top = Math.max(4, h.top - gap - ht);
    const tail = Math.max(16, Math.min(w - 16, h.x - left));
    this.bubble.style.setProperty('--tail-x', `${tail.toFixed(0)}px`);
    this.bubble.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
  }

  private startFollow(): void {
    if (this.followFrame) return;
    const step = (): void => {
      this.positionBubble();
      this.followFrame = requestAnimationFrame(step);
    };
    this.followFrame = requestAnimationFrame(step);
  }

  private stopFollow(): void {
    cancelAnimationFrame(this.followFrame);
    this.followFrame = 0;
  }
}
