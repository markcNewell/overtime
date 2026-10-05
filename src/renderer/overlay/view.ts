/**
 * Keeps the scene SVG in step with the game state: worker pose and
 * position, monitor, signs, leftovers and effects.
 *
 * The scene is built once; each state broadcast only recomputes two class
 * strings and touches the elements whose values actually changed. The
 * character is redrawn only when their look, pose or expression changes.
 */

import type { Effect } from '../../shared/ipc';
import type {
  ChatTone,
  EndingKind,
  GameState,
  Leftover,
  Worker,
} from '../../shared/types';
import {
  personGroup,
  personHead,
  type Expression,
  type PersonOptions,
} from '../shared/person';
import type { Pt } from '../shared/svg';
import {
  liveSegment,
  planFor,
  planLength,
  xAt,
  type Live,
  type Plan,
  type Segment,
} from './director';
import { confetti, levelUp, scuttle, smoke, zapBolts } from './effects';
import { FLOOR_Y, PROGRESS_W, SCREEN_X, SCREEN_Y, sceneSvg } from './scene';

/** How long a reaction to a chat reply shows on their face. */
const REACT_MS = 4000;
const GLITCH_MS = 1800;
/** How long "Email received" shows next to the envelope. */
const EMAIL_LABEL_MS = 4000;

export interface Face {
  expression: Expression;
  crazed: boolean;
}

/** Where the worker's head is right now, in scene pixels. */
export interface HeadAnchor {
  x: number;
  /** Top of the hair. */
  top: number;
  /** Centre of the head. */
  y: number;
  facing: 1 | -1;
  visible: boolean;
}

/** True while they are stuck on a bug the boss planted. */
export function isMysteryStuck(state: GameState | undefined): boolean {
  const p = state?.project;
  if (!p || p.stuckOn === undefined) return false;
  return !!p.hardParts[p.stuckOn]?.mystery;
}

/** The face for a reaction to the boss's tone. */
function reactionFace(tone: ChatTone, w: Worker): Expression {
  if (tone === 'kind') return 'happy';
  if (tone === 'neutral') return 'neutral';
  return w.stats.mood < 35 || w.attitude === 'bitter' ? 'angry' : 'sad';
}

/** Pick a face from the stats; activity-specific faces win. */
export function faceFor(w: Worker): Face {
  const { energy, mood, sanity } = w.stats;
  const crazed = sanity < 30;
  if (w.activity === 'asleep') return { expression: 'asleep', crazed };
  if (sanity < 10) return { expression: 'crazy', crazed: true };
  let e: Expression =
    mood >= 62 ? 'happy' : mood >= 38 ? 'neutral' : mood >= 18 ? 'sad' : 'angry';
  if (w.attitude === 'bitter' && mood < 45) e = 'angry';
  if (w.activity === 'stuck') e = mood < 25 ? 'angry' : 'scared';
  if (energy < 20 && e !== 'angry') e = 'tired';
  if (w.activity === 'coffee' && mood >= 30 && energy >= 20) e = 'happy';
  return { expression: e, crazed };
}

const LEFTOVER_CLASS: Record<Leftover['kind'], string> = {
  mug: 'left-mug',
  'sticky-note': 'left-note',
  'half-finished-project': 'left-folder',
};

function leftoverTip(l: Leftover): string {
  switch (l.kind) {
    case 'mug':
      return `${l.fromWorker}'s old mug: "${l.text}"`;
    case 'sticky-note':
      return `A note from ${l.fromWorker}: "${l.text}"`;
    case 'half-finished-project':
      return `${l.fromWorker}'s unfinished project: ${l.text}`;
  }
}

function q<T extends Element>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`overlay: missing ${sel}`);
  return el;
}

export class SceneView {
  readonly svg: SVGSVGElement;
  /** Called whenever the live segment changes (the UI shows shouts). */
  onSegment: () => void = () => undefined;

  private readonly workerG: SVGGElement;
  private readonly pos: SVGGElement;
  private readonly flip: SVGGElement;
  private readonly body: SVGGElement;
  private readonly xray: SVGGElement;
  private readonly hit: SVGRectElement;
  private readonly fxSweat: SVGGElement;
  private readonly fxZzz: SVGGElement;
  private readonly fxThinking: SVGGElement;
  private readonly fxHeart: SVGGElement;
  private readonly fxStorm: SVGGElement;
  private readonly effects: SVGGElement;
  private readonly effectsBack: SVGGElement;
  private readonly progress: SVGRectElement;
  private readonly envCount: SVGTextElement;

  private state?: GameState;
  /** The worker being drawn; outlives `state.worker` until an ending ends. */
  private worker?: Worker;
  private plan?: Plan;
  private live?: Live;
  private segTimer = 0;
  private bodyKey = '';
  private xrayKey = '';
  private override?: { expression: Expression; until: number };
  private reaction?: { tone: ChatTone; until: number };
  private readonly transient = new Set<string>();
  private readonly sceneTransient = new Set<string>();
  private awaiting = false;
  private lastLocalGlitch = 0;
  private sceneCls = '';
  private workerCls = '';
  private tips = new Map<string, string>();
  private pointerOver = false;
  private lastLocalZap = 0;

  constructor(host: HTMLElement) {
    host.insertAdjacentHTML('afterbegin', sceneSvg());
    this.svg = q<SVGSVGElement>(host, '#scene');
    this.workerG = q(this.svg, '#worker');
    this.pos = q(this.svg, '.worker-pos');
    this.flip = q(this.svg, '.worker-flip');
    this.body = q(this.svg, '.worker-body');
    this.xray = q(this.svg, '.worker-xray');
    this.hit = q(this.svg, '.worker-hit');
    this.fxSweat = q(this.svg, '.fx-sweat');
    this.fxZzz = q(this.svg, '.fx-zzz');
    this.fxThinking = q(this.svg, '.fx-thinking');
    this.fxHeart = q(this.svg, '.fx-heart');
    this.fxStorm = q(this.svg, '.fx-storm');
    this.effects = q(this.svg, '#effects');
    this.effectsBack = q(this.svg, '#effects-back');
    this.progress = q(this.svg, '#progress-fill');
    this.envCount = q(this.svg, '#env-count');
    // Time-based bits (boost running out, an ending finishing after the
    // worker left the state) are checked once a second, cheaply.
    window.setInterval(() => this.tick(), 1000);
  }

  /** Apply a new game state. */
  render(state: GameState): void {
    this.state = state;
    const now = Date.now();
    const next = this.resolveWorker(state, now);
    this.setWorker(next, now);
    this.updateMonitor(state);
    this.updateLeftovers(state);
    this.updateEmail(state);
    this.updateClasses(now);
    this.drawBody(now);
  }

  /** The worker currently on screen, if any (may have left the state). */
  get shownWorker(): Worker | undefined {
    return this.worker;
  }

  /** The live segment's shout, e.g. "AAAA!" while running off. */
  get shout(): string | undefined {
    return this.live && !this.live.seg.hidden ? this.live.seg.shout : undefined;
  }

  /** True while the worker can be clicked (not gone, not leaving). */
  get clickable(): boolean {
    return !!this.worker && this.worker.activity !== 'leaving' && !this.live?.seg.hidden;
  }

  /** There is code on the screen to break. */
  get canSabotage(): boolean {
    return this.clickable && !!this.state?.project && !!this.state.worker;
  }

  /**
   * Extra room above the head while a storm cloud hangs there, so the reply
   * bubble sits above the cloud instead of on it.
   */
  get bubbleLift(): number {
    const r = this.reaction;
    return r && r.tone === 'cruel' && r.until > Date.now() ? 28 : 0;
  }

  /** Show thinking dots while a chat reply is on its way. */
  setAwaiting(on: boolean): void {
    if (on === this.awaiting) return;
    this.awaiting = on;
    this.updateClasses(Date.now());
  }

  /** Tooltip text for a `data-hit` key, set from the state. */
  tipFor(hit: string): string | undefined {
    return this.tips.get(hit);
  }

  /** Head position right now, following walks without touching layout. */
  head(now = Date.now()): HeadAnchor {
    if (!this.plan || !this.worker) {
      return { x: 0, y: 0, top: 0, facing: 1, visible: false };
    }
    const live = liveSegment(this.plan, now);
    const h = personHead(live.seg.pose);
    const x = xAt(live) + live.seg.facing * h.x;
    const y = FLOOR_Y + h.y;
    const extra = this.hairExtra(live.seg);
    return { x, y, top: y - h.r - extra, facing: live.seg.facing, visible: !live.seg.hidden };
  }

  /** How far the hair sticks up above the head, for placing things. */
  private hairExtra(seg: Segment): number {
    if (seg.hairOnEnd) return 20;
    const style = this.worker?.look.hairStyle;
    if (style === 'mohawk') return 13;
    return style === 'bun' || style === 'curly' ? 9 : 4;
  }

  /** The pointer moved onto or off the worker. */
  setPointerOver(on: boolean): void {
    this.pointerOver = on;
    this.updateClasses(Date.now());
  }

  /** Play a one-off effect, from a click or from the main process. */
  effect(e: Effect, local = false): void {
    const now = Date.now();
    switch (e.type) {
      case 'zap':
        // A local click already played it; the echo from main is skipped.
        if (!local && now - this.lastLocalZap < 900) return;
        if (local) this.lastLocalZap = now;
        this.zap(now);
        return;
      case 'smoke':
        if (this.worker) smoke(this.effects, this.headTop(now));
        return;
      case 'level-up':
        if (this.worker) levelUp(this.effects, this.headTop(now));
        return;
      case 'confetti':
        confetti(this.effects);
        return;
      case 'glitch':
        if (!local && now - this.lastLocalGlitch < 1500) return;
        if (local) this.lastLocalGlitch = now;
        this.glitch();
        return;
      case 'react':
        this.react(e.tone, now);
        return;
      case 'email':
        // `email-new` also shows the envelope in case the state with the
        // complaint is a beat behind the effect.
        this.sceneTransient.delete('email-new');
        this.sceneTransient.delete('email-pop');
        this.updateClasses(now);
        this.flash('email-new', EMAIL_LABEL_MS, this.sceneTransient);
        this.flash('email-pop', 800, this.sceneTransient);
        return;
      case 'ending':
        this.startEnding(e.kind, now);
        return;
    }
  }

  // ------------------------------------------------------------- worker

  private resolveWorker(state: GameState, now: number): Worker | undefined {
    if (state.worker) return state.worker;
    // Let a running ending finish even if the game already dropped them.
    if (this.worker && this.plan && this.worker.activity === 'leaving') {
      if (now < this.plan.start + planLength(this.plan)) return this.worker;
    }
    return undefined;
  }

  private setWorker(next: Worker | undefined, now: number): void {
    if (!next) {
      if (this.worker) this.clearWorker();
      return;
    }
    const sameWorker = this.worker?.id === next.id;
    this.worker = next;
    const fromX = sameWorker && this.plan ? xAt(liveSegment(this.plan, now)) : undefined;
    const plan = planFor(next, fromX, now, isMysteryStuck(this.state));
    if (plan.key === this.plan?.key) return;
    // An ending started by an 'ending' effect keeps its own clock.
    if (this.plan && next.activity === 'leaving' && this.plan.key.startsWith(`${next.id}|leaving|${next.ending}|`)) return;
    this.plan = plan;
    this.applySegment(now);
  }

  private startEnding(kind: EndingKind, now: number): void {
    const w = this.worker;
    if (!w || w.activity === 'leaving') return;
    const ghost: Worker = { ...w, activity: 'leaving', ending: kind, activitySince: now };
    this.worker = ghost;
    const fromX = this.plan ? xAt(liveSegment(this.plan, now)) : undefined;
    this.plan = planFor(ghost, fromX, now);
    this.applySegment(now);
  }

  private clearWorker(): void {
    window.clearTimeout(this.segTimer);
    this.worker = undefined;
    this.plan = undefined;
    this.live = undefined;
    this.body.innerHTML = '';
    this.xray.innerHTML = '';
    this.bodyKey = '';
    this.xrayKey = '';
    this.onSegment();
  }

  private applySegment(now: number): void {
    window.clearTimeout(this.segTimer);
    if (!this.plan) return;
    const live = liveSegment(this.plan, now);
    this.live = live;
    const seg = live.seg;
    this.svg.style.setProperty('--seg-delay', `${-Math.round(live.elapsed)}ms`);
    this.place(live);
    this.flip.setAttribute('transform', seg.facing < 0 ? 'scale(-1 1)' : 'scale(1 1)');
    this.anchorFx(live);
    this.updateClasses(now);
    this.drawBody(now);
    if ((seg.cls ?? '').includes('seg-xray')) this.boltsFor(live.remaining);
    this.onSegment();
    if (Number.isFinite(live.remaining)) {
      this.segTimer = window.setTimeout(() => this.applySegment(Date.now()), Math.max(16, live.remaining + 4));
    }
  }

  private place(live: Live): void {
    const st = this.pos.style;
    st.transition = 'none';
    st.transform = `translate(${xAt(live).toFixed(1)}px, ${FLOOR_Y}px)`;
    const { seg } = live;
    if (seg.x1 === undefined || !Number.isFinite(live.remaining) || live.remaining <= 0) return;
    // Flush so the transition starts from the interpolated spot.
    void getComputedStyle(this.pos).transform;
    st.transition = `transform ${Math.round(live.remaining)}ms linear`;
    st.transform = `translate(${seg.x1}px, ${FLOOR_Y}px)`;
  }

  /** Move sweat, Zzz, thinking dots and the hit box to suit the pose. */
  private anchorFx(live: Live): void {
    const { seg } = live;
    const h = personHead(seg.pose);
    const f = seg.facing;
    const hx = f * h.x;
    this.fxSweat.setAttribute('transform', `translate(${hx.toFixed(1)} ${h.y.toFixed(1)})`);
    this.fxZzz.setAttribute('transform', `translate(${(hx + 12 * f).toFixed(1)} ${(h.y - 16).toFixed(1)})`);
    const top = h.y - h.r - this.hairExtra(seg);
    const tx = f > 0 ? hx + 13 : hx - 35;
    this.fxThinking.setAttribute('transform', `translate(${tx.toFixed(1)} ${(h.y - h.r - 12).toFixed(1)})`);
    // The heart floats by the face; the storm cloud hangs over the head.
    this.fxHeart.setAttribute('transform', `translate(${(hx + 25 * f).toFixed(1)} ${(h.y - 8).toFixed(1)})`);
    this.fxStorm.setAttribute('transform', `translate(${(hx - 2 * f).toFixed(1)} ${(top - 16).toFixed(1)})`);
    const seated = seg.pose.startsWith('sit');
    const [x, y, w, hh] = seated ? [-22, -88, 60, 90] : [-21, -98, 42, 100];
    this.hit.setAttribute('x', String(f > 0 ? x : -(x + w)));
    this.hit.setAttribute('y', String(y));
    this.hit.setAttribute('width', String(w));
    this.hit.setAttribute('height', String(hh));
  }

  private drawBody(now: number): void {
    const w = this.worker;
    const live = this.live;
    if (!w || !live) return;
    const seg = live.seg;
    const face = faceFor(w);
    const zapped = this.override && this.override.until > now ? this.override.expression : undefined;
    const r = this.reaction && this.reaction.until > now ? this.reaction : undefined;
    const reacted = r && w.activity !== 'asleep' ? reactionFace(r.tone, w) : undefined;
    const opts: PersonOptions = {
      pose: seg.pose,
      expression: seg.expression ?? zapped ?? reacted ?? face.expression,
      crazed: !seg.expression && face.crazed,
      hairOnEnd: !!seg.hairOnEnd,
    };
    if (reacted && r?.tone === 'kind' && !zapped && !seg.expression) opts.blush = true;
    if (seg.arms) opts.arms = seg.arms;
    const key = JSON.stringify([w.look, opts]);
    if (key !== this.bodyKey) {
      this.body.innerHTML = personGroup(w.look, opts);
      this.bodyKey = key;
    }
    const wantXray = (seg.cls ?? '').includes('seg-xray') || this.transient.has('zapping');
    if (wantXray && key !== this.xrayKey) {
      this.xray.innerHTML = personGroup(w.look, { ...opts, skeleton: true });
      this.xrayKey = key;
    }
  }

  private zap(now: number): void {
    if (!this.clickable || !this.live) return;
    this.override = { expression: 'shocked', until: now + 1500 };
    this.flash('zapping', 650);
    this.drawBody(now);
    const h = this.head(now);
    zapBolts(this.effects, this.effectsBack, { x: h.x, y: h.y + 22 });
    window.setTimeout(() => this.drawBody(Date.now()), 1550);
  }

  /** Keep the lightning going through an x-ray segment (the fried ending). */
  private boltsFor(ms: number): void {
    for (let t = 0; t < ms - 200; t += 550) {
      window.setTimeout(() => {
        const h = this.head();
        if (h.visible) zapBolts(this.effects, this.effectsBack, { x: h.x, y: h.y + 22 });
      }, t);
    }
  }

  /** Code goes red and jumbled and a bug runs across the screen. */
  private glitch(): void {
    if (!this.worker) return;
    this.flash('glitching', GLITCH_MS, this.sceneTransient);
    scuttle(
      this.effects,
      { x: SCREEN_X + 30, y: SCREEN_Y - 1 },
      { x: SCREEN_X - 40, y: SCREEN_Y + 5 },
    );
  }

  /** A few seconds of face (and a heart, a nod or a storm cloud). */
  private react(tone: ChatTone, now: number): void {
    const w = this.worker;
    if (!w || w.activity === 'leaving' || w.activity === 'asleep') return;
    this.reaction = { tone, until: now + REACT_MS };
    for (const t of ['kind', 'neutral', 'cruel']) this.transient.delete(`react-${t}`);
    this.flash(`react-${tone}`, REACT_MS);
    this.drawBody(now);
    window.setTimeout(() => this.drawBody(Date.now()), REACT_MS + 30);
  }

  private flash(cls: string, ms: number, set = this.transient): void {
    set.add(cls);
    this.updateClasses(Date.now());
    window.setTimeout(() => {
      set.delete(cls);
      this.updateClasses(Date.now());
    }, ms);
  }

  private headTop(now: number): Pt {
    const h = this.head(now);
    return { x: h.x, y: h.top };
  }

  // -------------------------------------------------------------- scene

  private updateClasses(now: number): void {
    const s = this.state;
    const w = this.worker;
    const seg = this.live?.seg;
    const c: string[] = [];
    if (w) c.push('has-worker', `act-${w.activity}`);
    else c.push('no-worker');
    if (w?.boost && w.boost.until > now) c.push('boost');
    if (w && s?.project) c.push('has-project');
    if (w && !s?.project && (w.activity === 'idle' || w.activity === 'working')) c.push('needs-project');
    if (s?.brainStatus === 'thinking' || (this.awaiting && w)) c.push('brain-thinking');
    if (w && isMysteryStuck(s)) c.push('mystery');
    const complaints = s?.complaints ?? [];
    if (complaints.some((m) => !m.reply) || this.sceneTransient.has('email-new')) c.push('has-email');
    if (complaints.some((m) => !m.readAt)) c.push('email-unread');
    c.push(...this.sceneTransient);
    if (s?.brainStatus === 'offline') c.push('brain-offline');
    for (const l of s?.deskLeftovers ?? []) c.push(LEFTOVER_CLASS[l.kind]);
    if (seg?.sceneCls) c.push(seg.sceneCls);
    if (seg?.hidden) c.push('worker-gone');
    const sceneCls = c.join(' ');
    if (sceneCls !== this.sceneCls) {
      this.svg.setAttribute('class', sceneCls);
      this.sceneCls = sceneCls;
    }
    const wc = ['worker'];
    if (seg?.cls) wc.push(seg.cls);
    if (seg?.hidden || !w) wc.push('is-hidden');
    if (this.pointerOver && w?.attitude === 'scared' && w.activity !== 'leaving') wc.push('trembling');
    wc.push(...this.transient);
    const workerCls = wc.join(' ');
    if (workerCls !== this.workerCls) {
      this.workerG.setAttribute('class', workerCls);
      this.workerCls = workerCls;
    }
  }

  private updateMonitor(state: GameState): void {
    const p = state.project;
    const width = p ? (PROGRESS_W * Math.max(0, Math.min(1, p.progress))).toFixed(1) : '0';
    if (this.progress.getAttribute('width') !== width) this.progress.setAttribute('width', width);
    if (!p || !state.worker) {
      this.tips.delete('monitor');
      return;
    }
    const pct = Math.floor(p.progress * 100);
    const stuck = p.stuckOn !== undefined ? p.hardParts[p.stuckOn] : undefined;
    const detail = stuck?.mystery
      ? "Stuck on a bug they can't explain"
      : stuck
        ? `Stuck on "${stuck.title}"`
        : `${p.title} · ${pct}%`;
    this.tips.set('monitor', `Mess up their code\n${detail}`);
  }

  private updateEmail(state: GameState): void {
    const unread = state.complaints.filter((m) => !m.readAt).length;
    const label = unread > 9 ? '9+' : String(unread);
    if (this.envCount.textContent !== label) this.envCount.textContent = label;
    const tip = unread === 0 ? 'Email received' : unread === 1 ? '1 unread email' : `${unread} unread emails`;
    this.tips.set('email', tip);
  }

  private updateLeftovers(state: GameState): void {
    for (const key of ['leftover-mug', 'leftover-note', 'leftover-folder']) this.tips.delete(key);
    for (const l of state.deskLeftovers) {
      const key = `leftover-${LEFTOVER_CLASS[l.kind].slice(5)}`;
      this.tips.set(key, leftoverTip(l));
    }
  }

  private tick(): void {
    if (!this.state) return;
    const now = Date.now();
    if (this.worker && !this.state.worker) this.render(this.state);
    this.updateClasses(now);
  }
}
