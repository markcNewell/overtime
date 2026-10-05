/**
 * The HTML layer over the scene: speech bubble, hover card, the boss menu
 * fanned out around the clipboard, the desk chat box and tooltips, plus
 * pointer tracking for click-through.
 *
 * The window ignores the mouse except over elements marked `data-hit`; this
 * module watches which one the pointer is over and tells the main process
 * only when that changes.
 */

import type { DirectAction, OfficeTab, OvertimeApi } from '../../shared/ipc';
import type { GameState, Level } from '../../shared/types';
import { esc } from '../shared/svg';
import { SCENE_W } from './scene';
import type { SceneView } from './view';

type MenuAction =
  | 'chat'
  | 'coffee'
  | 'praise'
  | 'bonus'
  | 'shout'
  | 'sabotage'
  | 'fire'
  | 'office';

const LEVEL_NAME: Record<Level, string> = {
  junior: 'Junior',
  mid: 'Mid-level',
  senior: 'Senior',
  lead: 'Lead',
};

const ICON_PATHS: Record<MenuAction, string> = {
  chat: '<path d="M4 5h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 4v-4H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" fill="#fff"/><circle cx="8" cy="11" r="1.4" fill="#2a2238" stroke="none"/><circle cx="12" cy="11" r="1.4" fill="#2a2238" stroke="none"/><circle cx="16" cy="11" r="1.4" fill="#2a2238" stroke="none"/>',
  coffee: '<path d="M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" fill="#fff"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16" fill="none"/><path d="M8 3c-1 1.5 1 2.5 0 4M12 3c-1 1.5 1 2.5 0 4" fill="none"/>',
  praise: '<path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z" fill="#fff"/>',
  bonus: '<rect x="2.5" y="6" width="19" height="12" rx="2" fill="#fff"/><circle cx="12" cy="12" r="3" fill="none"/>',
  shout: '<path d="M3 10v4h3l7 5V5L6 10z" fill="#fff"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none"/>',
  sabotage: '<path d="M8 9.5 4.5 7.5M16 9.5l3.5-2M7 13H3.5M17 13h3.5M7.5 17 4.5 19M16.5 17l3 2" fill="none"/><ellipse cx="12" cy="14.5" rx="5" ry="6" fill="#fff"/><circle cx="12" cy="7.2" r="2.6" fill="#fff"/><path d="M12 9v11.5" fill="none"/>',
  fire: '<path d="M5 3h9v18H5z" fill="#fff"/><circle cx="11.5" cy="12" r="0.9" fill="#2a2238" stroke="none"/><path d="M15.5 12h6M19 9l3 3-3 3" fill="none"/>',
  office: '<path d="M4 21V5l8-2v18M12 8h8v13" fill="#fff"/><path d="M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2M2 21h20" fill="none"/>',
};

interface FanItem {
  action: MenuAction;
  label: string;
  colour: string;
  /** Ring radius and angle (degrees, 0 = right, 90 = up) around the clipboard. */
  r: number;
  deg: number;
}

/** Where the fan opens from: the middle of the clipboard. */
const FAN_ORIGIN = { x: 349, y: 246 };
const BUTTON = 30;

// Two short arcs: the inner ring holds the everyday actions, the outer one
// the drastic ones, so Fire is never the button nearest the pointer.
const FAN: FanItem[] = [
  { action: 'chat', label: 'Chat', colour: '#8fc1ff', r: 66, deg: 176 },
  { action: 'coffee', label: 'Send for coffee', colour: '#e8c39b', r: 66, deg: 146 },
  { action: 'praise', label: 'Praise', colour: '#ffe27a', r: 66, deg: 116 },
  { action: 'bonus', label: 'Give a bonus', colour: '#9be8a6', r: 66, deg: 86 },
  { action: 'shout', label: 'Shout at them', colour: '#ffb067', r: 104, deg: 170 },
  { action: 'sabotage', label: 'Mess up their code', colour: '#d6f27a', r: 104, deg: 143 },
  { action: 'fire', label: 'Fire', colour: '#ff8f8f', r: 104, deg: 116 },
  { action: 'office', label: 'Staff file', colour: '#cdbdf5', r: 104, deg: 89 },
];

/** The two curved rails behind the rings, so the fan reads as one menu. */
const RAILS = [
  { r: 66, from: 86, to: 176 },
  { r: 104, from: 89, to: 170 },
];

/** Close the desk chat after this long without typing or a reply. */
const CHAT_IDLE_MS = 60_000;
/** Give up waiting for a reply after this long. */
const REPLY_TIMEOUT_MS = 45_000;

function fanPoint(item: FanItem): { x: number; y: number } {
  const a = (item.deg * Math.PI) / 180;
  return { x: FAN_ORIGIN.x + item.r * Math.cos(a), y: FAN_ORIGIN.y - item.r * Math.sin(a) };
}

function railPaths(): string {
  const p = (r: number, deg: number): string => {
    const a = (deg * Math.PI) / 180;
    return `${(FAN_ORIGIN.x + r * Math.cos(a)).toFixed(1)},${(FAN_ORIGIN.y - r * Math.sin(a)).toFixed(1)}`;
  };
  return RAILS.map(({ r, from, to }) => {
    const d = `M${p(r, from)} A${r},${r} 0 0 0 ${p(r, to)}`;
    return `<path class="rail-edge" d="${d}"/><path class="rail" d="${d}"/>`;
  }).join('');
}

function icon(action: MenuAction): string {
  return `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#2a2238" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[action]}</svg>`;
}

function today(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function el<T extends HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

function bubbleKey(state: GameState | undefined): string {
  const b = state?.bubble;
  return b ? `${b.kind}|${b.text}|${b.until}` : '';
}

export class OverlayUi {
  private readonly bubble: HTMLDivElement;
  private readonly bubbleText: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly menu: HTMLDivElement;
  private readonly confirm: HTMLDivElement;
  private readonly chat: HTMLFormElement;
  private readonly chatInput: HTMLInputElement;
  private readonly tip: HTMLDivElement;
  private readonly ask: HTMLDivElement;

  private state?: GameState;
  /** The coffee request already answered, so its buttons stay hidden. */
  private answeredAsk = '';
  private hitEl: Element | null = null;
  private tipEl: Element | null = null;
  private interactive = false;
  private menuOpen = false;
  private confirming = false;
  private chatOpen = false;
  private chatIdleTimer = 0;
  private awaitingSince = 0;
  private bubbleAtSend = '';
  private cardOpen = false;
  private cardTimer = 0;
  private bubbleShown = '';
  private bubbleTimer = 0;
  private followFrame = 0;
  private lastHead = { x: NaN, top: NaN, lift: 0 };
  private bubbleSize = { w: 0, h: 0 };
  private chatSide = '';

  constructor(
    private readonly api: OvertimeApi,
    private readonly view: SceneView,
    private readonly stage: HTMLElement,
  ) {
    this.bubble = el(`<div class="bubble say" aria-live="polite"><div class="bubble-text"></div></div>`);
    this.bubbleText = this.bubble.querySelector('.bubble-text') as HTMLDivElement;
    this.card = el(`<div class="card" hidden></div>`);
    this.menu = el(this.menuMarkup());
    this.confirm = this.menu.querySelector('.fan-confirm') as HTMLDivElement;
    this.chat = el(
      `<form class="desk-chat" data-hit="chat" hidden autocomplete="off">` +
        `<input class="chat-input" type="text" maxlength="400" spellcheck="true" aria-label="Say something">` +
        `<button class="chat-x" type="button" data-tip="Close (Esc)" aria-label="Close chat">` +
        `<svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="#2a2238" stroke-width="2" stroke-linecap="round"/></svg>` +
        `</button></form>`,
    );
    this.chatInput = this.chat.querySelector('input') as HTMLInputElement;
    this.tip = el(`<div class="tip" hidden></div>`);
    this.ask = el(
      `<div class="ask" data-hit="ask" hidden>` +
        `<button class="ask-yes" type="button" data-ask="yes">Go on then</button>` +
        `<button class="ask-no" type="button" data-ask="no">No</button>` +
        `</div>`,
    );
    stage.append(this.bubble, this.card, this.chat, this.ask, this.menu, this.tip);
    this.bind();
    view.onSegment = () => {
      this.updateBubble();
      if (this.chatOpen) this.positionChat();
      this.updateAsk();
    };
  }

  /** Apply a new game state to the HTML layer. */
  update(state: GameState): void {
    const previous = this.state;
    this.state = state;
    if (this.awaitingSince && bubbleKey(state) !== this.bubbleAtSend && state.bubble) {
      // The reply is in: stop the dots and give them another minute to talk.
      this.stopAwaiting();
      this.touchChat();
    }
    if (previous?.brainStatus === 'thinking' && state.brainStatus !== 'thinking' && this.awaitingSince) {
      if (!state.bubble) this.stopAwaiting();
    }
    this.updateBubble();
    this.updateAsk();
    if (this.cardOpen) this.fillCard();
    if (this.menuOpen) this.refreshMenu();
    if (this.chatOpen && !this.view.clickable) this.closeChat();
  }

  // ---------------------------------------------------------- pointer

  private bind(): void {
    document.addEventListener('mousemove', (e) => this.onMove(e.clientX, e.clientY));
    document.documentElement.addEventListener('mouseleave', () => {
      this.setHit(null);
      this.setTip(null);
    });
    document.addEventListener('click', (e) => this.onClick(e));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.confirming) this.cancelFire();
      else if (this.menuOpen) this.closeMenu();
      else if (this.chatOpen) this.closeChat();
    });
    this.chat.addEventListener('submit', (e) => {
      e.preventDefault();
      this.sendChat();
    });
    // A click on the box must really take the keyboard: the overlay is shown
    // without activating, so ask for focus explicitly on every press.
    this.chat.addEventListener('mousedown', (e) => {
      this.api.focusWindow();
      if (!(e.target instanceof Element && e.target.closest('.chat-x'))) {
        window.setTimeout(() => this.chatInput.focus(), 0);
      }
    });
    this.chatInput.addEventListener('input', () => this.touchChat());
    this.chatInput.addEventListener('focus', () => this.touchChat());
  }

  private onMove(x: number, y: number): void {
    const target = document.elementFromPoint(x, y);
    this.setHit(target?.closest('[data-hit]') ?? null);
    this.setTip(target?.closest('[data-tip], [data-hit]') ?? null);
  }

  private setHit(next: Element | null): void {
    if (next === this.hitEl) return;
    this.hitEl?.classList.remove('hover');
    this.hitEl = next;
    next?.classList.add('hover');
    const key = next?.getAttribute('data-hit') ?? '';
    this.view.setPointerOver(key === 'worker');
    this.onHoverWorker(key === 'worker');
    this.syncInteractive();
  }

  private syncInteractive(): void {
    const on = this.hitEl !== null || this.menuOpen || this.chatOpen;
    if (on === this.interactive) return;
    this.interactive = on;
    this.api.setInteractive(on);
  }

  private onClick(e: MouseEvent): void {
    // Hit-test the point ourselves: while a hovered SVG part is mid-transition
    // Chromium can report the click on the <svg> root instead of the part.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const target = under ?? (e.target instanceof Element ? e.target : null);
    // Whatever was clicked, its tooltip has done its job; it returns when the
    // pointer moves onto something else.
    if (!target?.closest('.fan')) this.tip.hidden = true;
    if (target?.closest('.fan')) {
      this.onMenuClick(target);
      return;
    }
    if (target?.closest('.desk-chat')) {
      if (target.closest('.chat-x')) this.closeChat();
      return;
    }
    const answer = target?.closest('[data-ask]')?.getAttribute('data-ask');
    if (answer) {
      this.answerAsk(answer === 'yes');
      return;
    }
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
        this.sabotage();
        return;
      case 'email':
        this.office('inbox');
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

  private sabotage(): void {
    if (!this.view.canSabotage) return;
    this.view.effect({ type: 'glitch' }, true);
    void this.api.act({ type: 'sabotage' });
  }

  // ------------------------------------------------------- coffee ask

  private askKey(): string {
    const w = this.state?.worker;
    return w?.wantsCoffeeSince ? `${w.id}|${w.wantsCoffeeSince}|${w.coffeeAsks ?? 1}` : '';
  }

  /**
   * A worker scared of the boss asks before taking a coffee. Two buttons sit
   * beside their face until the boss answers, even after the bubble fades.
   */
  private updateAsk(): void {
    const key = this.askKey();
    const show = !!key && key !== this.answeredAsk && this.view.clickable && this.view.head().visible;
    if (!show) {
      if (!this.ask.hidden) {
        this.ask.hidden = true;
        if (this.hitEl?.closest('.ask')) this.setHit(null);
      }
      return;
    }
    const nervous = (this.state?.worker?.coffeeAsks ?? 1) >= 3;
    this.ask.classList.toggle('nervous', nervous);
    this.ask.hidden = false;
    const h = this.view.head();
    const w = this.ask.offsetWidth;
    // On the face side, level with the eyes: they're looking at you.
    const ideal = h.facing > 0 ? h.x + 21 : h.x - 21 - w;
    const x = Math.max(4, Math.min(SCENE_W - w - 4, ideal));
    this.ask.style.transform = `translate(${Math.round(x)}px, ${Math.round(h.y - 14)}px)`;
  }

  private answerAsk(yes: boolean): void {
    this.answeredAsk = this.askKey();
    this.updateAsk();
    void this.api.act({ type: yes ? 'coffee' : 'deny-coffee' });
  }

  // ------------------------------------------------------------- tips

  private tipText(target: Element | null): string {
    if (!target) return '';
    const own = target.closest('[data-tip]')?.getAttribute('data-tip');
    if (own) return own;
    const key = target.closest('[data-hit]')?.getAttribute('data-hit') ?? '';
    return key ? (this.view.tipFor(key) ?? '') : '';
  }

  private setTip(target: Element | null, force = false): void {
    const anchor = target?.closest('[data-tip]') ?? target;
    if (!force && anchor === this.tipEl) return;
    this.tipEl = anchor;
    const text = this.tipText(anchor);
    const key = anchor?.getAttribute('data-hit');
    if (!anchor || !text || key === 'worker' || (this.menuOpen && !anchor.closest('.fan'))) {
      this.tip.hidden = true;
      return;
    }
    this.tip.textContent = text;
    this.tip.hidden = false;
    const box = anchor.getBoundingClientRect();
    const stageBox = this.stage.getBoundingClientRect();
    const w = this.tip.offsetWidth;
    const h = this.tip.offsetHeight;
    let left: number;
    let top: number;
    if (anchor.classList.contains('fan-btn')) {
      // Menu labels hang off the clipboard, below the fan, where they can't
      // cover a neighbouring button.
      left = SCENE_W - 6 - w;
      top = 268;
    } else {
      const cx = box.left + box.width / 2 - stageBox.left;
      left = cx - w / 2;
      top = box.top - stageBox.top - h - 6;
      if (top < 4) top = box.bottom - stageBox.top + 6;
    }
    left = Math.max(4, Math.min(SCENE_W - w - 4, left));
    this.tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  /**
   * Show a tooltip without the pointer (previews): a `data-hit` key, or
   * `act:<action>` for a menu button.
   */
  previewTip(key: string): void {
    const sel = key.startsWith('act:') ? `.fan [data-act="${key.slice(4)}"]` : `[data-hit="${key}"]`;
    const target = this.stage.querySelector(sel);
    if (target) this.setTip(target, true);
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

  /** Open the small stats card beside the worker. */
  showCard(): void {
    if (!this.view.shownWorker) return;
    this.cardOpen = true;
    this.fillCard();
    this.card.hidden = false;
    const h = this.view.head();
    const w = this.card.offsetWidth;
    const ht = this.card.offsetHeight;
    // Keep clear of the chat box, which sits on the roomier side.
    // The roomier side of the head.
    let right = h.x < SCENE_W / 2;
    if (this.chatOpen) right = this.chatSide === 'left';
    // The coffee question sits on the face side; keep the card off it.
    if (!this.ask.hidden) right = h.facing < 0;
    const left = right ? h.x + 24 : h.x - w - 24;
    const top = Math.max(4, Math.min(296 - ht, h.y - ht + 6));
    const x = Math.max(4, Math.min(SCENE_W - w - 4, left));
    this.card.style.transform = `translate(${Math.round(x)}px, ${Math.round(top)}px)`;
  }

  private hideCard(): void {
    this.cardOpen = false;
    this.card.hidden = true;
  }

  private fillCard(): void {
    const w = this.view.shownWorker;
    const s = this.state;
    if (!w || !s) return;
    const bar = (label: string, value: number, cls: string): string => {
      const v = Math.round(Math.max(0, Math.min(100, value)));
      return (
        `<div class="bar ${cls}${v < 25 ? ' low' : ''}"><span class="bar-label">${label}</span>` +
        `<span class="bar-track"><span class="bar-fill" style="width:${v}%"></span></span></div>`
      );
    };
    const p = s.project;
    this.card.innerHTML =
      `<div class="card-name">${esc(w.name)}</div>` +
      `<div class="card-meta">${LEVEL_NAME[w.level]}${p ? ` · <b>${Math.floor(p.progress * 100)}%</b> done` : ''}</div>` +
      bar('Energy', w.stats.energy, 'energy') +
      bar('Mood', w.stats.mood, 'mood') +
      bar('Sanity', w.stats.sanity, 'sanity');
  }

  // ------------------------------------------------------------- menu

  private menuMarkup(): string {
    const items = FAN.map((m, i) => {
      const { x, y } = fanPoint(m);
      const style = [
        `left:${(x - BUTTON / 2).toFixed(1)}px`,
        `top:${(y - BUTTON / 2).toFixed(1)}px`,
        `--c:${m.colour}`,
        `--fx:${(FAN_ORIGIN.x - x).toFixed(1)}px`,
        `--fy:${(FAN_ORIGIN.y - y).toFixed(1)}px`,
        `animation-delay:${i * 22}ms`,
      ].join(';');
      return `<button class="fan-btn" type="button" data-act="${m.action}" data-tip="${esc(m.label)}" aria-label="${esc(m.label)}" style="${style}">${icon(m.action)}</button>`;
    }).join('');
    return (
      `<div class="fan" data-hit="menu" hidden role="menu">` +
      `<svg class="fan-tray" width="${SCENE_W}" height="320" aria-hidden="true">${railPaths()}</svg>` +
      items +
      `<div class="fan-confirm" hidden><span class="confirm-q"></span>` +
      `<button class="confirm-yes" type="button" data-act="fire-yes">Fire</button>` +
      `<button class="confirm-no" type="button" data-act="fire-no">Keep</button></div>` +
      `</div>`
    );
  }

  /** Fan the boss actions out around the clipboard. */
  openMenu(): void {
    this.menuOpen = true;
    this.confirming = false;
    this.hideCard();
    this.tip.hidden = true;
    this.refreshMenu();
    this.menu.hidden = false;
    this.bubble.classList.add('muted');
    this.syncInteractive();
  }

  private closeMenu(): void {
    this.menuOpen = false;
    this.confirming = false;
    this.menu.hidden = true;
    this.tip.hidden = true;
    this.tipEl = null;
    this.bubble.classList.remove('muted');
    this.syncInteractive();
  }

  private refreshMenu(): void {
    const w = this.view.shownWorker;
    const s = this.state;
    const present = !!w && w.activity !== 'leaving' && w.activity !== 'arriving';
    const name = w?.name.split(' ')[0] ?? 'them';
    for (const b of this.menu.querySelectorAll<HTMLButtonElement>('.fan-btn')) {
      const action = b.dataset.act as MenuAction;
      const item = FAN.find((f) => f.action === action);
      let ok = action === 'office' || present;
      let tip = item?.label ?? action;
      if (action === 'coffee' && w?.activity === 'coffee') {
        ok = false;
        tip = 'Already on a break';
      }
      if (action === 'bonus' && w?.lastBonusDay === today()) {
        ok = false;
        tip = 'Bonus (one a day, back tomorrow)';
      }
      if (action === 'sabotage' && !s?.project) {
        ok = false;
        tip = 'No code to mess up';
      }
      if (action === 'chat' && present && s?.brainStatus === 'offline') tip = 'Chat (Claude is offline: canned replies)';
      if (action === 'fire' && present) tip = `Fire ${name}`;
      if (!present && action !== 'office') tip = 'Nobody to boss around';
      b.disabled = !ok;
      b.dataset.tip = tip;
      b.classList.toggle('dim', this.confirming && action !== 'fire');
    }
    this.confirm.hidden = !this.confirming;
    const q = this.confirm.querySelector('.confirm-q');
    if (q) q.textContent = `Fire ${name}?`;
  }

  /** Ask "Fire them?" next to the Fire button (also used by previews). */
  askFire(): void {
    this.confirming = true;
    this.tip.hidden = true;
    this.refreshMenu();
  }

  private cancelFire(): void {
    this.confirming = false;
    this.refreshMenu();
  }

  private onMenuClick(target: Element | null): void {
    const button = target?.closest('button');
    const act = button?.getAttribute('data-act');
    if (!act) {
      // A click on the fan's empty space closes it.
      this.closeMenu();
      return;
    }
    if (button?.hasAttribute('disabled')) return;
    switch (act) {
      case 'fire':
        if (this.confirming) this.cancelFire();
        else this.askFire();
        return;
      case 'fire-no':
        this.cancelFire();
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
      case 'sabotage':
        this.closeMenu();
        this.sabotage();
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

  /** Open the one-line chat box beside the worker's head and focus it. */
  openChat(draft = ''): void {
    const w = this.view.shownWorker;
    if (!w || !this.view.clickable) return;
    this.chatOpen = true;
    this.chatInput.placeholder = `Say something to ${w.name.split(' ')[0] ?? w.name}…`;
    this.chatInput.value = draft;
    this.chat.hidden = false;
    this.positionChat();
    this.api.focusWindow();
    this.chatInput.focus();
    this.touchChat();
    this.syncInteractive();
  }

  private sendChat(): void {
    const text = this.chatInput.value.trim();
    if (!text) return;
    this.chatInput.value = '';
    this.chatInput.placeholder = 'Say something else…';
    this.bubbleAtSend = bubbleKey(this.state);
    this.awaitingSince = Date.now();
    this.view.setAwaiting(true);
    window.setTimeout(() => {
      if (this.awaitingSince && Date.now() - this.awaitingSince >= REPLY_TIMEOUT_MS) this.stopAwaiting();
    }, REPLY_TIMEOUT_MS + 50);
    this.touchChat();
    void this.api.chat(text);
  }

  private stopAwaiting(): void {
    this.awaitingSince = 0;
    this.view.setAwaiting(false);
  }

  /** Something happened in the conversation; restart the idle clock. */
  private touchChat(): void {
    window.clearTimeout(this.chatIdleTimer);
    if (!this.chatOpen) return;
    this.chatIdleTimer = window.setTimeout(() => {
      if (this.awaitingSince) this.touchChat();
      else this.closeChat();
    }, CHAT_IDLE_MS);
  }

  private closeChat(): void {
    this.chatOpen = false;
    this.chat.hidden = true;
    this.chatInput.blur();
    window.clearTimeout(this.chatIdleTimer);
    this.syncInteractive();
  }

  /**
   * Beside the head at head height: the reply bubble goes above the head,
   * so the two never meet. It takes the side away from the face when that
   * has room (the face side is where reactions appear).
   */
  private positionChat(): void {
    const h = this.view.head();
    if (!h.visible) return;
    const gap = 22;
    const leftRoom = h.x - gap - 6;
    const rightRoom = SCENE_W - 6 - (h.x + gap);
    const away = h.facing > 0 ? 'left' : 'right';
    const room = away === 'left' ? leftRoom : rightRoom;
    const side = room >= 150 ? away : leftRoom > rightRoom ? 'left' : 'right';
    const width = Math.min(220, side === 'left' ? leftRoom : rightRoom);
    const x = side === 'left' ? h.x - gap - width : h.x + gap;
    // On the face side, drop below where a heart would float.
    const y = side === away ? h.y - 13 : h.y + 10;
    this.chatSide = side;
    this.chat.style.width = `${Math.round(width)}px`;
    this.chat.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    this.chat.classList.toggle('on-right', side === 'right');
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
    this.bubble.className = `bubble ${kind}${this.menuOpen ? ' muted' : ''}`;
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
    const lift = this.view.bubbleLift;
    // Only walks and storm clouds move it; skip frames where nothing changed.
    const still =
      Math.abs(h.x - this.lastHead.x) < 0.3 &&
      Math.abs(h.top - this.lastHead.top) < 0.3 &&
      lift === this.lastHead.lift;
    if (!force && still) return;
    this.lastHead = { x: h.x, top: h.top, lift };
    if (force) this.bubbleSize = { w: this.bubble.offsetWidth, h: this.bubble.offsetHeight };
    const w = this.bubbleSize.w;
    const ht = this.bubbleSize.h;
    const shout = this.bubble.classList.contains('shout');
    const gap = (this.bubble.classList.contains('think') ? 22 : 13) + lift;
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
