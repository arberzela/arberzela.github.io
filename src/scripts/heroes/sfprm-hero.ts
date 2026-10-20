// Canvas renderer and controls for the SFPRM hero: tokens running the spherical fixed-point loop on
// a slowly rotating, draggable sphere. States glide along smooth paths through their iterates, the
// inject/block guides are recomputed every frame from the moving point, each state carries its
// 8.1° halting cap, and a small chart in the control card tracks the halting residual.
// Mounted per page (Astro ClientRouter) and torn down before the page is swapped out.
import {
  angle, slerp, expMap, scale, add, tangentBasis, inject, block, runLoop, fixedPoint,
  makeTokens, mulberry32, pathTiming, pathAt, samplePathTimed,
  type Vec, type Token, type LoopRun, type PathTiming,
} from './sphere-sim';
import {
  SFPRM_SCENES, REF_LAMBDA, CUSTOM_MAX_ITER, heroCaps, loopParams, describeCustom, parseEta, etaValue,
  type EtaSetting,
} from './sfprm-scenes';

const DEG = 180 / Math.PI;
const COL = {
  input: '251, 146, 60', // orange: INJECT
  prop: '56, 189, 248', // sky: BLOCK proposal
  state: '167, 139, 250', // violet: DAMP / state
  halt: '52, 211, 153', // emerald: HALT
  wire: '148, 163, 184',
  cap: '148, 163, 184',
};
const ITER_MS = 380; // one loop iteration at 1× speed
const LEAD_MS = 520; // tokens appear at their inputs before the loop starts
const HOLD_HALT_MS = 2800;
const HOLD_STUCK_MS = 1500;
const XFADE_MS = 800;
const SUB = 16; // path samples per iteration
const TRAIL = 9; // iterations of trail behind each state
const SPEEDS = [1, 2, 0.5];
const SPIN = 0.00011; // auto-rotation, rad per ms
const MONO = '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

type Layer = 'back' | 'front';
type Pt = { x: number; y: number; d: number };

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoothstep = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const easeIn = (t: number) => 2 * t * t - t * t * t; // f(0)=0, f(1)=1, f'(0)=0, f'(1)=1
const easeOut = (t: number) => 1 - easeIn(1 - t); // f'(0)=1, f'(1)=0

function mixRgb(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const pa = a.split(',').map(Number);
  const pb = b.split(',').map(Number);
  return pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(', ');
}

const argmax = (a: number[]) => a.reduce((best, v, i) => (v > a[best] ? i : best), 0);

// Wireframe: 5 latitudes and 6 meridians, sampled once.
const WIRE: { pts: Vec[]; strong: boolean }[] = (() => {
  const rings: { pts: Vec[]; strong: boolean }[] = [];
  const N = 96;
  for (const latDeg of [-60, -30, 0, 30, 60]) {
    const lat = latDeg / DEG;
    const pts: Vec[] = [];
    for (let i = 0; i <= N; i++) {
      const lon = (i / N) * Math.PI * 2;
      pts.push([Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)]);
    }
    rings.push({ pts, strong: latDeg === 0 });
  }
  for (let m = 0; m < 6; m++) {
    const lon = (m / 6) * Math.PI;
    const pts: Vec[] = [];
    for (let i = 0; i <= N; i++) {
      const lat = (i / N) * Math.PI * 2;
      pts.push([Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)]);
    }
    rings.push({ pts, strong: false });
  }
  return rings;
})();

interface RunView {
  tokens: Token[];
  run: LoopRun;
  pts: Vec[][]; // per token: iterates z_0..z_n
  timing: PathTiming[]; // per token: time map with continuous velocity through the iterates
  paths: Vec[][]; // per token: samples of the smooth path at loop times j / SUB
  lambda: number;
  tau: number;
  answers: Vec[] | null;
  born: number; // clock time at which the run started
  fadeFrom: number | null; // clock time at which it started fading out
}

interface Live {
  u: number; // loop time in iterations (iterate i is reached at u = i)
  i: number; // current iteration index
  done: boolean;
  haltedNow: boolean;
  sinceEnd: number;
  alpha: number;
  P: Vec[];
  inj: Vec[];
  prop: Vec[];
  res: number[];
  settle: number[];
}

const answerCache = new WeakMap<Token[], Vec[]>();

class SphereHero {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private chart: HTMLCanvasElement | null;
  private cctx: CanvasRenderingContext2D | null;
  private overlay: HTMLElement | null;
  private legend: HTMLElement | null;
  private tip: { el: HTMLElement; title: HTMLElement; value: HTMLElement; state: HTMLElement } | null;
  private ui: Record<string, HTMLElement | null>;
  private selLambda: HTMLSelectElement | null;
  private selEta: HTMLSelectElement | null;
  private reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Layout
  private w = 0;
  private h = 0;
  private cx = 0;
  private cy = 0;
  private R = 100;
  private cw = 0;
  private ch = 0;

  // Camera
  private yaw = 0.7;
  private pitch = 0.42;
  private vYaw = SPIN;
  private vPitch = 0;
  private dragging = false;
  private dragX = 0;
  private dragY = 0;
  private dragT = 0;

  // Scene
  private sceneIdx = 0; // -1: custom settings
  private lambda = REF_LAMBDA;
  private eta: EtaSetting = 'adaptive';
  private maxIter = 50;
  private seed = 1;
  private tokens: Token[] = [];
  private runs: RunView[] = [];
  private clock = 0;
  private speedIdx = 0;
  private playing = true;

  // Per frame
  private heads: { x: number; y: number; front: boolean }[] = [];
  private hover: number | null = null;
  // The highlighted ("focus") token: the worst one, kept for a while so the highlight doesn't
  // hop every step, and blended in and out per token.
  private focus: number | null = null;
  private focusSince = 0;
  private focusW: number[] = [];
  private lastDraw = 0;
  private lastStatus = '';
  private lastTip = '';

  // Loop
  private raf = 0;
  private lastFrame = 0;
  private visible = true;
  private io: IntersectionObserver | null = null;
  private ro: ResizeObserver | null = null;
  private cleanups: (() => void)[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    this.canvas = root.querySelector('[data-hero-canvas]') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.chart = root.querySelector('[data-hero-chart]');
    this.cctx = this.chart ? this.chart.getContext('2d') : null;
    this.overlay = root.querySelector('.hero-overlay');
    this.legend = root.querySelector('.hero-legend');
    const tipEl = root.querySelector<HTMLElement>('[data-hero-tooltip]');
    this.tip = tipEl
      ? {
          el: tipEl,
          title: tipEl.querySelector('[data-tip-title]') as HTMLElement,
          value: tipEl.querySelector('[data-tip-value]') as HTMLElement,
          state: tipEl.querySelector('[data-tip-state]') as HTMLElement,
        }
      : null;
    this.ui = {
      title: root.querySelector('[data-hero-title]'),
      desc: root.querySelector('[data-hero-desc]'),
      status: root.querySelector('[data-hero-status]'),
      counter: root.querySelector('[data-hero-counter]'),
      play: root.querySelector('[data-hero-play]'),
      speed: root.querySelector('[data-hero-speed]'),
      answer: root.querySelector('[data-legend-answer]'),
    };
    this.selLambda = root.querySelector('[data-hero-lambda]');
    this.selEta = root.querySelector('[data-hero-eta]');
    this.bind();
    this.resize();
    this.newTokens();
    this.setScene(0);
    this.start();
  }

  // --- Setup ------------------------------------------------------------------------------------
  private on(el: EventTarget | null, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions) {
    if (!el) return;
    el.addEventListener(type, fn, opts);
    this.cleanups.push(() => el.removeEventListener(type, fn, opts));
  }

  private bind() {
    const q = (sel: string) => this.root.querySelector(sel);
    const n = SFPRM_SCENES.length;
    this.on(q('[data-hero-prev]'), 'click', () => this.setScene(this.sceneIdx < 0 ? n - 1 : this.sceneIdx - 1));
    this.on(q('[data-hero-next]'), 'click', () => this.setScene(this.sceneIdx < 0 ? 0 : this.sceneIdx + 1));
    this.on(q('[data-hero-rerun]'), 'click', () => {
      this.newTokens();
      this.startRun();
    });
    this.on(this.ui.play, 'click', () => {
      this.playing = !this.playing;
      if (this.ui.play) this.ui.play.textContent = this.playing ? 'Pause' : 'Resume';
    });
    this.on(this.ui.speed, 'click', () => {
      this.speedIdx = (this.speedIdx + 1) % SPEEDS.length;
      if (this.ui.speed) this.ui.speed.textContent = `Speed ${SPEEDS[this.speedIdx]}×`;
    });
    this.on(this.selLambda, 'change', () => this.applySettings());
    this.on(this.selEta, 'change', () => this.applySettings());

    // Drag to rotate, with inertia (vertical swipes still scroll the page on touch screens).
    this.on(this.canvas, 'pointerdown', (e: PointerEvent) => {
      this.dragging = true;
      this.dragX = e.clientX;
      this.dragY = e.clientY;
      this.dragT = performance.now();
      this.vYaw = 0;
      this.vPitch = 0;
      this.canvas.setPointerCapture?.(e.pointerId);
      this.canvas.classList.add('is-dragging');
      this.setHover(null);
    });
    this.on(this.canvas, 'pointermove', (e: PointerEvent) => {
      if (!this.dragging) {
        if (e.pointerType === 'mouse') this.pickHover(e.clientX, e.clientY);
        return;
      }
      const now = performance.now();
      const dt = Math.max(1, now - this.dragT);
      const dyaw = (e.clientX - this.dragX) * 0.0075;
      const dpitch = (e.clientY - this.dragY) * 0.0075;
      this.yaw += dyaw;
      this.pitch = Math.max(-1.25, Math.min(1.25, this.pitch + dpitch));
      this.vYaw = 0.6 * this.vYaw + 0.4 * (dyaw / dt);
      this.vPitch = 0.6 * this.vPitch + 0.4 * (dpitch / dt);
      this.dragX = e.clientX;
      this.dragY = e.clientY;
      this.dragT = now;
      if (!this.raf) this.draw();
    });
    const endDrag = () => {
      if (!this.dragging) return;
      this.dragging = false;
      // Keep the fling only if the pointer was still moving when released.
      if (performance.now() - this.dragT > 80) {
        this.vYaw = 0;
        this.vPitch = 0;
      }
      const cap = 0.012;
      this.vYaw = Math.max(-cap, Math.min(cap, this.vYaw));
      this.vPitch = Math.max(-cap, Math.min(cap, this.vPitch));
      this.canvas.classList.remove('is-dragging');
    };
    this.on(this.canvas, 'pointerup', endDrag);
    this.on(this.canvas, 'pointercancel', endDrag);
    this.on(this.canvas, 'pointerleave', () => this.setHover(null));

    this.ro = new ResizeObserver(() => {
      this.resize();
      if (!this.raf) this.draw();
    });
    this.ro.observe(this.root);
    if (this.overlay) this.ro.observe(this.overlay);

    this.io = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.start();
      else this.stop();
    });
    this.io.observe(this.root);
    this.on(document, 'visibilitychange', () => (document.hidden ? this.stop() : this.visible && this.start()));
  }

  private resize() {
    const rect = this.root.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Fit the sphere between the legend (on phones) and the control card.
    const ov = this.overlay?.getBoundingClientRect();
    const lg = this.legend?.getBoundingClientRect();
    const bottom = ov ? ov.top - rect.top - 14 : this.h - 20;
    const top = this.w < 640 && lg ? lg.bottom - rect.top + 12 : 26;
    const avail = Math.max(120, bottom - top);
    this.cx = this.w / 2;
    this.cy = top + avail / 2;
    this.R = Math.max(56, Math.min(this.w * 0.4, avail * 0.46));

    if (this.chart && this.cctx) {
      const cr = this.chart.getBoundingClientRect();
      this.cw = cr.width;
      this.ch = cr.height;
      this.chart.width = Math.round(this.cw * dpr);
      this.chart.height = Math.round(this.ch * dpr);
      this.cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  // --- Scenes and runs ---------------------------------------------------------------------------
  private get current(): RunView | undefined {
    return this.runs[this.runs.length - 1];
  }

  private newTokens() {
    this.seed += 1;
    const n = this.w < 560 ? 5 : 7;
    this.tokens = makeTokens(n, mulberry32(this.seed * 7919));
  }

  private setText(title: string, desc: string) {
    if (this.ui.title) this.ui.title.textContent = heroCaps(title);
    if (this.ui.desc) this.ui.desc.textContent = desc;
  }

  private syncSelects() {
    if (this.selLambda) this.selLambda.value = String(this.lambda);
    if (this.selEta) this.selEta.value = etaValue(this.eta);
  }

  private setScene(i: number) {
    const n = SFPRM_SCENES.length;
    this.sceneIdx = ((i % n) + n) % n;
    const s = SFPRM_SCENES[this.sceneIdx];
    this.lambda = s.lambda;
    this.eta = s.eta;
    this.maxIter = s.maxIter;
    this.setText(s.title, s.desc);
    if (this.ui.counter) this.ui.counter.textContent = `${this.sceneIdx + 1} / ${n}`;
    this.syncSelects();
    this.startRun();
  }

  private applySettings() {
    const lambda = Number(this.selLambda?.value ?? this.lambda);
    const eta = parseEta(this.selEta?.value ?? etaValue(this.eta));
    // Settings that match a scene switch to that scene.
    const match = SFPRM_SCENES.findIndex((s) => s.lambda === lambda && s.eta === eta);
    if (match >= 0) {
      this.setScene(match);
      return;
    }
    this.sceneIdx = -1;
    this.lambda = lambda;
    this.eta = eta;
    this.maxIter = CUSTOM_MAX_ITER;
    if (this.ui.counter) this.ui.counter.textContent = 'custom';
    this.startRun();
  }

  private answersFor(tokens: Token[]): Vec[] {
    let a = answerCache.get(tokens);
    if (!a) {
      a = tokens.map((t) => fixedPoint(t, REF_LAMBDA, 0.2, 600));
      answerCache.set(tokens, a);
    }
    return a;
  }

  private startRun() {
    const params = loopParams(this.lambda, this.eta, this.maxIter);
    const run = runLoop(this.tokens, params);
    const pts = this.tokens.map((_, k) => run.states.map((st) => st[k]));
    const timing = pts.map((p) => pathTiming(p));
    const paths = pts.map((p, k) => samplePathTimed(p, timing[k], SUB));
    const answers = Math.abs(this.lambda - REF_LAMBDA) > 1e-9 ? this.answersFor(this.tokens) : null;
    for (const r of this.runs) if (r.fadeFrom === null) r.fadeFrom = this.clock;
    if (this.reduceMotion) this.runs = [];
    const rv: RunView = { tokens: this.tokens, run, pts, timing, paths, lambda: this.lambda, tau: params.tau, answers, born: this.clock, fadeFrom: null };
    this.runs.push(rv);
    this.focus = null;
    this.focusW = [];
    if (this.ui.answer) this.ui.answer.hidden = answers === null;
    if (this.sceneIdx < 0) {
      const gap = answers ? Math.min(...rv.tokens.map((_, k) => angle(pts[k][run.n], answers[k]))) * DEG : null;
      const { title, desc } = describeCustom(this.lambda, this.eta, run, gap);
      this.setText(title, desc);
    }
    this.lastStatus = '';
    if (!this.raf) this.draw();
  }

  private endTime(rv: RunView) {
    return LEAD_MS + rv.run.n * ITER_MS;
  }

  private holdTime(rv: RunView) {
    return rv.run.halted ? HOLD_HALT_MS : HOLD_STUCK_MS;
  }

  // --- Loop --------------------------------------------------------------------------------------
  private start() {
    if (this.raf || !this.visible || document.hidden) return;
    if (this.reduceMotion) {
      // No continuous animation: show the finished run; redraw only on interaction.
      this.draw();
      return;
    }
    this.lastFrame = performance.now();
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      // rAF timestamps can precede the start time by a fraction of a millisecond: clamp at 0.
      const dt = Math.max(0, Math.min(64, now - this.lastFrame));
      this.lastFrame = now;
      if (!this.dragging) {
        // A fling decays smoothly back into the slow auto-rotation.
        const spin = this.hover !== null ? 0 : SPIN; // hold still while a state is inspected
        this.vYaw += (spin - this.vYaw) * (1 - Math.exp(-dt / 900));
        this.vPitch *= Math.exp(-dt / 350);
        this.yaw += this.vYaw * dt;
        this.pitch = Math.max(-1.25, Math.min(1.25, this.pitch + this.vPitch * dt));
      }
      if (this.playing) {
        this.clock += dt * SPEEDS[this.speedIdx];
        const cur = this.current;
        if (cur && this.clock - cur.born > this.endTime(cur) + this.holdTime(cur)) {
          this.newTokens();
          this.startRun();
        }
      }
      this.runs = this.runs.filter((r) => r.fadeFrom === null || this.clock - r.fadeFrom < XFADE_MS);
      this.draw();
    };
    this.raf = requestAnimationFrame(frame);
  }

  private stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  destroy() {
    this.stop();
    this.io?.disconnect();
    this.ro?.disconnect();
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
  }

  // --- State at the current time ---------------------------------------------------------------
  private live(rv: RunView): Live {
    const n = rv.run.n;
    const t = this.reduceMotion ? Number.POSITIVE_INFINITY : this.clock - rv.born;
    const u = this.reduceMotion ? n : Math.max(0, Math.min(n, (t - LEAD_MS) / ITER_MS));
    const end = this.endTime(rv);
    const done = t >= end;
    const haltedNow = rv.run.halted && done;
    const sinceEnd = this.reduceMotion ? 1e9 : t - end;
    const fadeIn = this.reduceMotion ? 1 : clamp01(t / 380);
    const fadeOut = rv.fadeFrom === null ? 1 : 1 - clamp01((this.clock - rv.fadeFrom) / XFADE_MS);
    const P = rv.pts.map((p, k) => pathAt(p, rv.timing[k], u));
    const inj = P.map((p, k) => inject(rv.tokens[k], p, rv.lambda));
    const prop = inj.map((q, k) => block(rv.tokens[k], q));
    const res = P.map((p, k) => angle(p, prop[k]));
    const settle = res.map((r) => smoothstep((rv.tau * 1.06 - r) / (rv.tau * 0.12)));
    return { u, i: Math.min(n, Math.floor(u + 1e-9)), done, haltedNow, sinceEnd, alpha: fadeIn * fadeOut, P, inj, prop, res, settle };
  }

  // --- Projection and primitives ---------------------------------------------------------------
  private project(v: Vec): Pt {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const x1 = v[0] * cy + v[2] * sy;
    const z1 = -v[0] * sy + v[2] * cy;
    const y2 = v[1] * cp - z1 * sp;
    const z2 = v[1] * sp + z1 * cp;
    return { x: this.cx + this.R * x1, y: this.cy - this.R * y2, d: z2 };
  }

  /** Stroke a polyline of sphere points, keeping only the segments on the given hemisphere. */
  private strokePath(pts: Vec[], layer: Layer, rgb: string, alpha: number, width: number, dash?: number[]) {
    if (pts.length < 2 || alpha <= 0.004) return;
    const ctx = this.ctx;
    ctx.strokeStyle = `rgba(${rgb}, ${(layer === 'back' ? alpha * 0.3 : alpha).toFixed(3)})`;
    ctx.lineWidth = width;
    ctx.setLineDash(dash ?? []);
    ctx.beginPath();
    let prev = this.project(pts[0]);
    let open = false;
    for (let i = 1; i < pts.length; i++) {
      const cur = this.project(pts[i]);
      const inLayer = (prev.d + cur.d) / 2 >= 0 ? layer === 'front' : layer === 'back';
      if (inLayer) {
        if (!open) ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(cur.x, cur.y);
        open = true;
      } else open = false;
      prev = cur;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private arc(a: Vec, b: Vec): Vec[] {
    const om = angle(a, b);
    const n = Math.max(2, Math.ceil(om / 0.035));
    const pts: Vec[] = [];
    for (let j = 0; j <= n; j++) pts.push(slerp(a, b, j / n));
    return pts;
  }

  /** Small circle of angular radius r around p (halting caps, answer markers). */
  private smallCircle(p: Vec, r: number): Vec[] {
    const [u, v] = tangentBasis(p);
    const pts: Vec[] = [];
    for (let i = 0; i <= 36; i++) {
      const t = (i / 36) * Math.PI * 2;
      pts.push(expMap(p, scale(add(scale(u, Math.cos(t)), scale(v, Math.sin(t))), r)));
    }
    return pts;
  }

  private dot(p: Vec, layer: Layer, rgb: string, r: number, alpha: number) {
    const s = this.project(p);
    if ((s.d >= 0) !== (layer === 'front') || alpha <= 0.004) return;
    const ctx = this.ctx;
    const a = layer === 'back' ? alpha * 0.3 : alpha;
    const rr = r * (0.82 + 0.18 * Math.max(0, s.d));
    ctx.fillStyle = `rgba(${rgb}, ${(a * 0.2).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, rr * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(${rgb}, ${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
    ctx.fill();
  }

  private ring(p: Vec, layer: Layer, rgb: string, r: number, alpha: number) {
    const s = this.project(p);
    if ((s.d >= 0) !== (layer === 'front') || alpha <= 0.004) return;
    const ctx = this.ctx;
    const a = layer === 'back' ? alpha * 0.3 : alpha;
    ctx.strokeStyle = `rgba(${rgb}, ${a.toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * (0.85 + 0.15 * Math.max(0, s.d)), 0, Math.PI * 2);
    ctx.stroke();
  }

  /** Glowing head of a state: soft additive halo, solid core and a small highlight. */
  private head(p: Vec, layer: Layer, rgb: string, alpha: number, emphasis: number) {
    const s = this.project(p);
    if ((s.d >= 0) !== (layer === 'front') || alpha <= 0.004) return;
    const ctx = this.ctx;
    const a = layer === 'back' ? alpha * 0.35 : alpha;
    const r = (4.2 + 0.8 * emphasis) * (0.8 + 0.2 * Math.max(0, s.d));
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 3.6);
    g.addColorStop(0, `rgba(${rgb}, ${(0.5 * a).toFixed(3)})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(${rgb}, ${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 255, 255, ${(0.65 * a).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(s.x - r * 0.28, s.y - r * 0.28, r * 0.36, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Drawing -----------------------------------------------------------------------------------
  private draw() {
    const ctx = this.ctx;
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Grid and axes through the sphere centre.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.055)';
    ctx.beginPath();
    const step = 48;
    for (let x = (this.cx % step) - step; x < w; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, h);
    }
    for (let y = (this.cy % step) - step; y < h; y += step) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.13)';
    ctx.beginPath();
    ctx.moveTo(Math.round(this.cx) + 0.5, 0);
    ctx.lineTo(Math.round(this.cx) + 0.5, h);
    ctx.moveTo(0, Math.round(this.cy) + 0.5);
    ctx.lineTo(w, Math.round(this.cy) + 0.5);
    ctx.stroke();

    // Glow behind the sphere.
    const glow = ctx.createRadialGradient(this.cx, this.cy, this.R * 0.2, this.cx, this.cy, this.R * 1.6);
    glow.addColorStop(0, 'rgba(56, 189, 248, 0.075)');
    glow.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const lives = this.runs.map((rv) => this.live(rv));
    const cur = this.current;
    const L = lives[lives.length - 1];
    const now = performance.now();
    const dtDraw = this.lastDraw ? Math.min(120, now - this.lastDraw) : 120;
    this.lastDraw = now;
    if (L) this.updateFocus(L, now, dtDraw);

    for (const ring of WIRE) this.strokePath(ring.pts, 'back', COL.wire, ring.strong ? 0.2 : 0.11, 1);
    this.runs.forEach((rv, j) => this.drawRun(rv, lives[j], 'back'));
    this.drawBody(cur && L ? L : null);
    for (const ring of WIRE) this.strokePath(ring.pts, 'front', COL.wire, ring.strong ? 0.2 : 0.11, 1);
    this.runs.forEach((rv, j) => this.drawRun(rv, lives[j], 'front'));

    if (cur && L) {
      this.heads = L.P.map((p) => {
        const q = this.project(p);
        return { x: q.x, y: q.y, front: q.d >= 0 };
      });
      if (this.hover !== null && (this.hover >= this.heads.length || !this.heads[this.hover].front)) this.setHover(null);
      this.drawFocusLabel(cur, L);
      this.drawChart(cur, L);
      this.updateStatus(cur, L);
      this.updateTooltip(cur, L);
    }
  }

  private drawBody(L: Live | null) {
    const ctx = this.ctx;
    const { cx, cy, R } = this;
    const halo = ctx.createRadialGradient(cx, cy, R * 0.94, cx, cy, R * 1.2);
    halo.addColorStop(0, 'rgba(56, 189, 248, 0.09)');
    halo.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.2, 0, Math.PI * 2);
    ctx.fill();

    const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R);
    body.addColorStop(0, 'rgba(30, 41, 59, 0.6)');
    body.addColorStop(0.7, 'rgba(15, 23, 42, 0.74)');
    body.addColorStop(1, 'rgba(11, 15, 25, 0.86)');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    const spec = ctx.createRadialGradient(cx - R * 0.42, cy - R * 0.48, 0, cx - R * 0.42, cy - R * 0.48, R * 0.6);
    spec.addColorStop(0, 'rgba(255, 255, 255, 0.07)');
    spec.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = spec;
    ctx.fill();

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.32)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // A green flash of the rim when the loop halts.
    if (L && L.haltedNow && L.sinceEnd < 1000) {
      ctx.strokeStyle = `rgba(${COL.halt}, ${(0.55 * (1 - L.sinceEnd / 1000)).toFixed(3)})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

  private drawRun(rv: RunView, L: Live, layer: Layer) {
    const a = L.alpha;
    if (a <= 0.01) return;
    const isCur = rv === this.current;
    const fw = (k: number) => (isCur ? this.focusW[k] ?? 0 : 0);
    const haltBlend = L.haltedNow ? clamp01(L.sinceEnd / 450) : 0;
    const K = rv.tokens.length;

    // Answers at the reference λ (only when this run uses another λ).
    if (rv.answers) {
      for (const p of rv.answers) {
        this.strokePath(this.smallCircle(p, 0.075), layer, COL.halt, 0.8 * a, 1.5, [3, 3]);
        this.dot(p, layer, COL.halt, 1.5, 0.85 * a);
      }
    }
    // Inputs.
    for (const tok of rv.tokens) this.ring(tok.x, layer, COL.input, 5, 0.95 * a);

    // Trails along the smooth paths, fading towards the tail.
    const trailCol = mixRgb(COL.state, COL.halt, haltBlend);
    for (let k = 0; k < K; k++) this.drawTrail(rv.paths[k], L.u, L.P[k], layer, trailCol, a);
    // Beads at the actual iterates (they pop in as the state passes them).
    for (let k = 0; k < K; k++) {
      const pts = rv.pts[k];
      const iMax = Math.floor(L.u + 1e-9);
      for (let i = Math.max(1, Math.ceil(L.u - TRAIL)); i <= iMax; i++) {
        const age = 1 - (L.u - i) / TRAIL;
        const pop = clamp01((L.u - i) * 7);
        const s = this.project(pts[i]);
        if ((s.d >= 0) !== (layer === 'front')) continue;
        const ctx = this.ctx;
        ctx.fillStyle = `rgba(${trailCol}, ${((layer === 'back' ? 0.3 : 1) * a * (0.12 + 0.6 * age) * pop).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.9 * (0.5 + 0.5 * pop), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Guides: inject (orange) and block (blue dashed) arcs, recomputed from the moving state.
    // They fade out when the loop halts and dim when it gives up.
    const guideA = L.haltedNow ? 1 - haltBlend : L.done ? 1 - 0.5 * clamp01(L.sinceEnd / 350) : 1;
    if (guideA > 0.01) {
      for (let k = 0; k < K; k++) {
        const w = fw(k);
        const g = 0.42 + 0.58 * w;
        this.strokePath(this.arc(L.P[k], L.inj[k]), layer, COL.input, 0.9 * g * a * guideA, 1.5 + 0.5 * w);
        this.strokePath(this.arc(L.inj[k], L.prop[k]), layer, COL.prop, 0.75 * g * a * guideA, 1.2 + 0.3 * w, [4, 4]);
      }
    }

    // Halting caps of radius τ around every state; the proposal must land inside to halt.
    for (let k = 0; k < K; k++) {
      const settle = Math.max(L.settle[k], haltBlend);
      const capA = settle > 0.02 ? 0.3 + 0.45 * settle : 0.2 + 0.35 * fw(k);
      this.strokePath(this.smallCircle(L.P[k], rv.tau), layer, mixRgb(COL.cap, COL.halt, settle), capA * a, settle > 0.5 ? 1.4 : 1, settle > 0.5 ? undefined : [2, 3]);
    }

    // Proposals and states.
    if (guideA > 0.01) {
      for (let k = 0; k < K; k++) this.dot(L.prop[k], layer, COL.prop, 2.5 + 0.7 * fw(k), (0.7 + 0.3 * fw(k)) * a * guideA);
    }
    for (let k = 0; k < K; k++) {
      const settle = Math.max(L.settle[k], haltBlend);
      this.head(L.P[k], layer, mixRgb(COL.state, COL.halt, settle), a, fw(k));
    }

    // Halt: rings expanding from every state.
    if (L.haltedNow && L.sinceEnd < 1300) {
      const q = L.sinceEnd / 1300;
      const ctx = this.ctx;
      for (const p of L.P) {
        const s = this.project(p);
        if ((s.d >= 0) !== (layer === 'front')) continue;
        ctx.strokeStyle = `rgba(${COL.halt}, ${((1 - q) * (layer === 'back' ? 0.25 : 0.8) * a).toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 5 + easeOut(q) * 30, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /** The last TRAIL iterations of a smooth path, drawn in chunks that thin and fade towards the tail. */
  private drawTrail(path: Vec[], u: number, head: Vec, layer: Layer, rgb: string, a: number) {
    const end = u * SUB;
    const start = Math.max(0, end - TRAIL * SUB);
    const i0 = Math.floor(start);
    const i1 = Math.min(path.length - 1, Math.floor(end));
    if (i1 < i0) return;
    const pts: Vec[] = [];
    for (let j = i0; j <= i1; j++) pts.push(path[j]);
    pts.push(head);
    const span = Math.max(1e-6, end - start);
    const CH = 4;
    for (let c = 0; c < pts.length - 1; c += CH) {
      const seg = pts.slice(c, Math.min(pts.length, c + CH + 1));
      const age = clamp01((i0 + c + CH / 2 - start) / span); // 0 tail .. 1 head
      this.strokePath(seg, layer, rgb, a * (0.05 + 0.75 * age * age), 0.9 + 1.5 * age);
    }
  }

  /** Pick the highlighted token: the hovered one, else the worst one, switching only after a dwell. */
  private updateFocus(L: Live, now: number, dt: number) {
    const K = L.P.length;
    if (this.focusW.length !== K) this.focusW = new Array(K).fill(0);
    let target: number | null;
    if (this.hover !== null && this.hover < K) target = this.hover;
    else if (L.haltedNow) target = null;
    else {
      const worst = argmax(L.res);
      if (this.focus === null || this.focus >= K) {
        this.focus = worst;
        this.focusSince = now;
      } else if (worst !== this.focus && now - this.focusSince > 1500 && L.res[this.focus] < 0.8 * L.res[worst]) {
        this.focus = worst;
        this.focusSince = now;
      }
      target = this.focus;
    }
    const kf = 1 - Math.exp(-dt / 170);
    for (let k = 0; k < K; k++) this.focusW[k] += ((k === target ? 1 : 0) - this.focusW[k]) * kf;
  }

  /** Live angle of the highlighted token next to its proposal (cross-fades when the focus moves). */
  private drawFocusLabel(rv: RunView, L: Live) {
    const ctx = this.ctx;
    ctx.font = MONO;
    for (let k = 0; k < L.P.length; k++) {
      const fade = L.alpha * (this.focusW[k] ?? 0);
      if (fade < 0.03) continue;
      const q = this.project(L.prop[k]);
      if (q.d < 0) continue;
      const inside = L.res[k] < rv.tau;
      const text = `${(L.res[k] * DEG).toFixed(1)}°${inside ? ' ✓' : ''}`;
      const tw = ctx.measureText(text).width;
      const x = Math.min(this.w - tw - 14, q.x + 10);
      const y = Math.max(16, q.y - 12);
      ctx.fillStyle = `rgba(15, 23, 42, ${(0.8 * fade).toFixed(3)})`;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(x - 5, y - 11, tw + 10, 17, 4);
      else ctx.rect(x - 5, y - 11, tw + 10, 17);
      ctx.fill();
      ctx.fillStyle = `rgba(${inside ? COL.halt : COL.prop}, ${fade.toFixed(3)})`;
      ctx.fillText(text, x, y + 2);
    }
  }

  /** Halting residual (largest angle, log scale) against the iterations, with the 8.1° threshold. */
  private drawChart(rv: RunView, L: Live) {
    const ctx = this.cctx;
    if (!ctx || this.cw < 40) return;
    const w = this.cw, h = this.ch;
    ctx.clearRect(0, 0, w, h);
    const run = rv.run;
    const n = run.n;
    const N = Math.max(n, 10);
    const padL = 34, padR = 8, padT = 5, padB = 5;
    const X = (i: number) => padL + (i / N) * (w - padL - padR);
    const lo = Math.log(1), hi = Math.log(180);
    const Y = (rad: number) => {
      const d = Math.min(180, Math.max(1, rad * DEG));
      return padT + (1 - (Math.log(d) - lo) / (hi - lo)) * (h - padT - padB);
    };
    // Frame and threshold.
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL + 0.5, padT);
    ctx.lineTo(padL + 0.5, h - padB);
    ctx.lineTo(w - padR, h - padB);
    ctx.stroke();
    const yT = Math.round(Y(rv.tau)) + 0.5;
    ctx.strokeStyle = `rgba(${COL.halt}, 0.7)`;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, yT);
    ctx.lineTo(w - padR, yT);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${COL.halt}, 0.9)`;
    ctx.fillText('8.1°', 2, yT);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
    ctx.fillText('max ∠', 2, padT + 4);
    ctx.textBaseline = 'alphabetic';

    // η decays (adaptive runs): small violet ticks on the axis.
    ctx.strokeStyle = `rgba(${COL.state}, 0.9)`;
    for (const d of run.decays) {
      if (d > L.u) continue;
      const x = Math.round(X(d)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, h - padB);
      ctx.lineTo(x, h - padB - 5);
      ctx.stroke();
    }

    // Residual so far (interpolated in log space between iterations).
    const u = L.u;
    const iMax = Math.floor(u);
    const pts: [number, number][] = [];
    for (let i = 0; i <= Math.min(iMax, n); i++) pts.push([X(i), Y(run.maxRes[i])]);
    if (iMax < n && u > iMax) {
      const f = u - iMax;
      const a = Math.log(Math.max(1e-4, run.maxRes[iMax])), b = Math.log(Math.max(1e-4, run.maxRes[iMax + 1]));
      pts.push([X(u), Y(Math.exp(a + (b - a) * f))]);
    }
    if (pts.length) {
      const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
      grad.addColorStop(0, `rgba(${COL.prop}, 0.22)`);
      grad.addColorStop(1, `rgba(${COL.prop}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], h - padB);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(pts[pts.length - 1][0], h - padB);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(${COL.prop}, 0.95)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      pts.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      const [lx, ly] = pts[pts.length - 1];
      ctx.fillStyle = `rgba(${L.haltedNow ? COL.halt : COL.prop}, 1)`;
      ctx.beginPath();
      ctx.arc(lx, ly, L.haltedNow ? 3.5 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private updateStatus(rv: RunView, L: Live) {
    const el = this.ui.status;
    if (!el) return;
    const run = rv.run;
    const n = run.n;
    const K = rv.tokens.length;
    const i = Math.min(n, L.i);
    let text: string;
    if (L.haltedNow) text = `halted at iteration ${n} · all ${K} within 8.1°`;
    else if (L.done) text = `no halt after ${n} iterations · max ∠ ${(run.maxRes[n] * DEG).toFixed(1)}°`;
    else {
      const within = run.residuals[i].filter((r) => r < rv.tau).length;
      text = `iteration ${i} · η ${run.eta[i].toFixed(2)} · max ∠ ${(run.maxRes[i] * DEG).toFixed(1)}° · ${within}/${K} settled`;
    }
    if (text !== this.lastStatus) {
      el.textContent = text;
      el.classList.toggle('is-halted', L.haltedNow);
      el.classList.toggle('is-stuck', L.done && !L.haltedNow);
      this.lastStatus = text;
    }
  }

  // --- Hover tooltip -----------------------------------------------------------------------------
  private pickHover(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    let best: number | null = null;
    let bd = 20 * 20;
    this.heads.forEach((hd, k) => {
      if (!hd.front) return;
      const d = (hd.x - x) ** 2 + (hd.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    this.setHover(best);
  }

  private setHover(k: number | null) {
    if (k === this.hover) return;
    this.hover = k;
    this.canvas.classList.toggle('is-hovering', k !== null);
    if (k === null && this.tip) this.tip.el.hidden = true;
    if (!this.raf) this.draw();
  }

  private updateTooltip(rv: RunView, L: Live) {
    const tip = this.tip;
    if (!tip) return;
    const k = this.hover;
    if (k === null || k >= L.P.length) {
      tip.el.hidden = true;
      return;
    }
    const hd = this.heads[k];
    const deg = L.res[k] * DEG;
    const inside = L.res[k] < rv.tau;
    const key = `${k}|${deg.toFixed(1)}|${inside}`;
    if (key !== this.lastTip) {
      tip.title.textContent = `Token ${k + 1}`;
      tip.value.textContent = `${deg.toFixed(1)}°`;
      tip.state.textContent = inside ? 'inside its 8.1° cap' : 'outside its 8.1° cap';
      tip.el.classList.toggle('is-inside', inside);
      this.lastTip = key;
    }
    tip.el.hidden = false;
    const tw = tip.el.offsetWidth, th = tip.el.offsetHeight;
    const x = Math.min(this.w - tw - 8, hd.x + 16);
    const y = Math.max(8, hd.y - th - 10);
    tip.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
}

// --- Mounting (works with Astro's ClientRouter) ---------------------------------------------------
let current: SphereHero | null = null;

function mount() {
  const el = document.querySelector<HTMLElement>('[data-sphere-hero]');
  if (!el || el.dataset.mounted) return;
  el.dataset.mounted = '1';
  try {
    current = new SphereHero(el);
  } catch (err) {
    console.warn('Hero illustration disabled:', err);
  }
}

function unmount() {
  current?.destroy();
  current = null;
}

document.addEventListener('astro:page-load', mount);
document.addEventListener('astro:before-swap', unmount);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else mount();
