// Controller for the PBT-NCA hero: a strip of worlds (the best world of one PBT-NCA run at eight
// meta-iterations) whose active world plays its rollout, and a chart of the run's mean composite score
// in the control card whose playhead travels to each world's meta-iteration. Short clips loop until
// the world has been on stage for a while, then the next world slides in.
// Mounted per page (Astro ClientRouter) and torn down before the page is swapped out.
import { WORLD_SCENES, MEAN_SCORE, META_ITERATIONS, MEDIA, sceneTitle } from './pbtnca-scenes';

const SPEEDS = [1, 2, 0.5];
const DWELL_MS = 7500; // a world stays on stage at least this long (at 1×); shorter clips loop
const STUCK_MS = 20000; // advance anyway if a clip never starts or never ends
const TRAVEL_MS = 1100; // the playhead's trip between two worlds
const ACCENT = '56, 189, 248';
const SLATE = '148, 163, 184';
const GLASS = '15, 23, 42'; // the card surface: the ring around chart markers
const Y_LO = 0.25;
const Y_HI = 0.65;
const MONO = '600 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// Strip layout, in units of the active world's size: centre offset, scale and opacity by distance.
const SLOTS = [
  { x: 0, s: 1, a: 1 },
  { x: 0.86, s: 0.56, a: 0.62 },
  { x: 1.38, s: 0.36, a: 0.3 },
  { x: 1.72, s: 0.24, a: 0 },
];

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Mean score at a (fractional) meta-iteration, interpolated between the logged ones. */
function scoreAt(iter: number): number {
  const u = clamp(iter, 1, META_ITERATIONS) - 1;
  const i = Math.floor(u);
  const f = u - i;
  return i + 1 < MEAN_SCORE.length ? MEAN_SCORE[i] * (1 - f) + MEAN_SCORE[i + 1] * f : MEAN_SCORE[i];
}

class WorldsHero {
  private root: HTMLElement;
  private strip: HTMLElement;
  private tiles: HTMLElement[];
  private glow: HTMLElement | null;
  private overlay: HTMLElement | null;
  private legend: HTMLElement | null;
  private chart: HTMLCanvasElement | null;
  private cctx: CanvasRenderingContext2D | null;
  private tip: { el: HTMLElement; value: HTMLElement; label: HTMLElement } | null;
  private ui: Record<string, HTMLElement | null>;
  private reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Layout
  private w = 0;
  private size = 200;
  private cy = 0;
  private cw = 0;
  private ch = 0;

  // State
  private idx = 0;
  private playing = true;
  private speedIdx = 0;
  private dwell = 0;
  private videos = new Map<number, HTMLVideoElement>();
  private head: number = WORLD_SCENES[0].iter; // playhead, in meta-iterations
  private travel: { from: number; to: number; t: number } | null = null;
  private hoverIter: number | null = null;
  private chartDirty = true;
  private lastStatus = '';

  // Loop
  private raf = 0;
  private lastFrame = 0;
  private visible = true;
  private io: IntersectionObserver | null = null;
  private ro: ResizeObserver | null = null;
  private cleanups: (() => void)[] = [];
  private swipe: { x: number; y: number; id: number } | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.strip = root.querySelector('[data-worlds-strip]') as HTMLElement;
    this.tiles = Array.from(root.querySelectorAll<HTMLElement>('[data-world]'));
    this.glow = root.querySelector('[data-worlds-glow]');
    this.overlay = root.querySelector('.hero-overlay');
    this.legend = root.querySelector('.hero-legend');
    this.chart = root.querySelector('[data-hero-chart]');
    this.cctx = this.chart ? this.chart.getContext('2d') : null;
    const tipEl = root.querySelector<HTMLElement>('[data-chart-tip]');
    this.tip = tipEl
      ? { el: tipEl, value: tipEl.querySelector('[data-tip-value]') as HTMLElement, label: tipEl.querySelector('[data-tip-label]') as HTMLElement }
      : null;
    this.ui = {
      title: root.querySelector('[data-hero-title]'),
      desc: root.querySelector('[data-hero-desc]'),
      status: root.querySelector('[data-hero-status]'),
      counter: root.querySelector('[data-hero-counter]'),
      play: root.querySelector('[data-hero-play]'),
      replay: root.querySelector('[data-hero-replay]'),
      speed: root.querySelector('[data-hero-speed]'),
    };
    if (this.reduceMotion) {
      this.playing = false;
      if (this.ui.replay) this.ui.replay.textContent = 'Play clip';
    }
    this.root.classList.add('is-live');
    this.bind();
    this.resize();
    this.setScene(0, false);
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
    this.on(q('[data-hero-prev]'), 'click', () => this.setScene(this.idx - 1));
    this.on(q('[data-hero-next]'), 'click', () => this.setScene(this.idx + 1));
    this.on(this.ui.play, 'click', () => this.setPlaying(!this.playing));
    this.on(this.ui.replay, 'click', () => {
      this.dwell = 0;
      const v = this.videoFor(this.idx);
      v.currentTime = 0;
      this.playVideo(v);
    });
    this.on(this.ui.speed, 'click', () => {
      this.speedIdx = (this.speedIdx + 1) % SPEEDS.length;
      if (this.ui.speed) this.ui.speed.textContent = `Speed ${SPEEDS[this.speedIdx]}×`;
      for (const v of this.videos.values()) this.setRate(v);
    });

    // Click a world to bring it on stage; swipe the strip sideways to step through the worlds.
    this.on(this.strip, 'pointerdown', (e: PointerEvent) => {
      this.swipe = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    this.on(this.strip, 'pointerup', (e: PointerEvent) => {
      const sw = this.swipe;
      this.swipe = null;
      if (!sw || sw.id !== e.pointerId) return;
      const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
      if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
        this.setScene(this.idx + (dx < 0 ? 1 : -1));
        return;
      }
      if (Math.hypot(dx, dy) > 8) return;
      const tile = (e.target as HTMLElement).closest<HTMLElement>('[data-world]');
      if (tile && Number(tile.dataset.world) !== this.idx) this.setScene(Number(tile.dataset.world));
    });
    this.on(this.strip, 'pointercancel', () => (this.swipe = null));

    // The chart: a crosshair with the score at the pointer; clicking jumps to the nearest world.
    if (this.chart) {
      this.on(this.chart, 'pointermove', (e: PointerEvent) => this.setHover(e.clientX));
      this.on(this.chart, 'pointerleave', () => this.setHover(null));
      this.on(this.chart, 'click', (e: MouseEvent) => {
        const it = this.iterAtClient(e.clientX);
        if (it === null) return;
        let best = 0;
        WORLD_SCENES.forEach((s, i) => {
          if (Math.abs(s.iter - it) < Math.abs(WORLD_SCENES[best].iter - it)) best = i;
        });
        this.setScene(best);
      });
    }

    this.ro = new ResizeObserver(() => {
      this.resize();
      this.layoutTiles();
      this.chartDirty = true;
      if (!this.raf) this.drawChart();
    });
    this.ro.observe(this.root);
    if (this.overlay) this.ro.observe(this.overlay);

    this.io = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.syncPlayback();
    });
    this.io.observe(this.root);
    this.on(document, 'visibilitychange', () => this.syncPlayback());
  }

  private resize() {
    const rect = this.root.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = rect.width;
    // Fit the active world between the legend and the control card.
    const ov = this.overlay?.getBoundingClientRect();
    const lg = this.legend?.getBoundingClientRect();
    const bottom = ov ? ov.top - rect.top - 16 : rect.height - 20;
    const top = lg ? lg.bottom - rect.top + 12 : 24;
    const avail = Math.max(120, bottom - top);
    this.size = Math.round(clamp(Math.min(avail, this.w * (this.w < 640 ? 0.62 : 0.4)), 120, 460));
    this.cy = Math.round(top + avail / 2);
    this.root.style.setProperty('--world-size', `${this.size}px`);
    this.root.style.setProperty('--world-cy', `${this.cy}px`);

    if (this.chart && this.cctx) {
      const cr = this.chart.getBoundingClientRect();
      this.cw = cr.width;
      this.ch = cr.height;
      this.chart.width = Math.round(this.cw * dpr);
      this.chart.height = Math.round(this.ch * dpr);
      this.cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /** Place every world by its distance from the active one; CSS transitions do the sliding. The strip
   *  is circular (the hero loops), so both sides stay populated and 460 → 20 is a single step. */
  private layoutTiles() {
    const narrow = this.w < 640;
    const n = this.tiles.length;
    this.tiles.forEach((tile, i) => {
      let o = (((i - this.idx) % n) + n) % n;
      if (o > n / 2) o -= n;
      const d = Math.abs(o);
      const slot = SLOTS[Math.min(d, SLOTS.length - 1)];
      const x = (d < SLOTS.length ? slot.x : SLOTS[SLOTS.length - 1].x + (d - SLOTS.length + 1) * 0.3) * Math.sign(o) * this.size;
      const alpha = narrow && d > 1 ? 0 : slot.a;
      tile.style.transform = `translate(-50%, -50%) translateX(${x.toFixed(1)}px) scale(${slot.s})`;
      tile.style.opacity = String(alpha);
      tile.style.zIndex = String(10 - d);
      tile.style.setProperty('--s', String(slot.s));
      tile.style.pointerEvents = alpha > 0 ? '' : 'none';
      tile.classList.toggle('is-active', o === 0);
    });
  }

  // --- Scenes -------------------------------------------------------------------------------------
  private setScene(i: number, animate = true) {
    const n = WORLD_SCENES.length;
    const next = ((i % n) + n) % n;
    const prev = this.idx;
    if (next !== prev) {
      const old = this.videos.get(prev);
      if (old) {
        old.pause();
        this.tiles[prev]?.classList.remove('has-video');
      }
    }
    this.idx = next;
    this.dwell = 0;
    const s = WORLD_SCENES[next];
    if (this.ui.title) this.ui.title.textContent = sceneTitle(s);
    if (this.ui.desc) this.ui.desc.textContent = s.desc;
    if (this.ui.counter) this.ui.counter.textContent = `${next + 1} / ${n}`;
    this.setGlow(s.slug);
    this.layoutTiles();

    if (animate && !this.reduceMotion) this.travel = { from: this.head, to: s.iter, t: 0 };
    else {
      this.travel = null;
      this.head = s.iter;
    }
    this.chartDirty = true;
    this.updateStatus();

    // Keep the clips around the active world loaded (the strip is circular); release the others.
    for (const [k, v] of this.videos) {
      const d = Math.abs(k - next);
      if (Math.min(d, n - d) > 1) {
        v.pause();
        v.removeAttribute('src');
        v.load();
        v.remove();
        this.tiles[k]?.classList.remove('has-video');
        this.videos.delete(k);
      }
    }
    // With reduced motion a clip only loads when asked for (Play clip).
    if (!this.reduceMotion) {
      this.videoFor(next).currentTime = 0;
      this.videoFor((next + 1) % n);
    }
    this.syncPlayback();
    if (!this.raf) this.drawChart();
  }

  private setGlow(slug: string) {
    const g = this.glow;
    if (!g) return;
    const img = document.createElement('img');
    img.alt = '';
    img.src = `${MEDIA}/${slug}-glow.png`; // pre-blurred, with a radial fade
    img.className = 'is-entering';
    g.appendChild(img);
    // Next frame: fade the new glow in and the old ones out, then drop the old ones.
    requestAnimationFrame(() => {
      img.classList.remove('is-entering');
      const olds = Array.from(g.querySelectorAll('img')).filter((x) => x !== img);
      olds.forEach((o) => o.classList.add('is-leaving'));
      window.setTimeout(() => olds.forEach((o) => o.remove()), this.reduceMotion ? 0 : 900);
    });
  }

  private videoFor(i: number): HTMLVideoElement {
    let v = this.videos.get(i);
    if (v) return v;
    v = document.createElement('video');
    v.className = 'world-video';
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.disablePictureInPicture = true;
    v.setAttribute('aria-hidden', 'true');
    v.setAttribute('muted', '');
    this.setRate(v);
    v.src = `${MEDIA}/${WORLD_SCENES[i].slug}.mp4`;
    const tile = this.tiles[i];
    v.addEventListener('playing', () => tile.classList.add('has-video'));
    v.addEventListener('ended', () => this.onEnded(i));
    tile.appendChild(v);
    this.videos.set(i, v);
    return v;
  }

  private setRate(v: HTMLVideoElement) {
    // The default rate survives a reload of the source; the current rate may not.
    v.defaultPlaybackRate = SPEEDS[this.speedIdx];
    v.playbackRate = SPEEDS[this.speedIdx];
  }

  private playVideo(v: HTMLVideoElement) {
    this.setRate(v);
    v.play().catch(() => {
      /* autoplay blocked or clip unavailable: the poster stays and the strip still advances */
    });
  }

  private onEnded(i: number) {
    if (i !== this.idx) return;
    if (!this.playing) return;
    if (this.dwell >= DWELL_MS) {
      this.setScene(this.idx + 1);
      return;
    }
    const v = this.videoFor(i);
    v.currentTime = 0;
    this.playVideo(v);
  }

  private setPlaying(p: boolean) {
    this.playing = p;
    if (this.ui.play) this.ui.play.textContent = p ? 'Pause' : 'Resume';
    this.syncPlayback();
  }

  /** Play the active clip only while auto-play is on and the hero is on screen. */
  private syncPlayback() {
    const live = this.visible && !document.hidden;
    const v = this.videos.get(this.idx);
    if (v) {
      if (this.playing && live) {
        if (v.ended) v.currentTime = 0;
        this.playVideo(v);
      } else if (!this.reduceMotion || !live) v.pause();
    }
    if (live) this.start();
    else this.stop();
  }

  // --- Loop ---------------------------------------------------------------------------------------
  private start() {
    if (this.raf || !this.visible || document.hidden) return;
    if (this.reduceMotion) {
      this.drawChart();
      return;
    }
    this.lastFrame = performance.now();
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.max(0, Math.min(64, now - this.lastFrame));
      this.lastFrame = now;
      if (this.travel) {
        this.travel.t += dt / TRAVEL_MS;
        const k = easeInOut(clamp(this.travel.t, 0, 1));
        this.head = this.travel.from + (this.travel.to - this.travel.from) * k;
        if (this.travel.t >= 1) {
          this.head = this.travel.to;
          this.travel = null;
        }
        this.chartDirty = true;
        this.updateStatus();
      }
      if (this.playing) {
        this.dwell += dt * SPEEDS[this.speedIdx];
        const v = this.videos.get(this.idx);
        const stalled = !v || v.error !== null || v.readyState < 2;
        if ((stalled && this.dwell > DWELL_MS) || this.dwell > STUCK_MS) this.setScene(this.idx + 1);
      }
      if (this.chartDirty) this.drawChart();
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
    for (const v of this.videos.values()) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
    this.videos.clear();
  }

  // --- Status and chart -------------------------------------------------------------------------
  private updateStatus() {
    const el = this.ui.status;
    if (!el) return;
    const it = Math.round(this.head);
    const text = `meta-iteration ${it} of ${META_ITERATIONS} · mean score ${scoreAt(it).toFixed(2)}`;
    if (text !== this.lastStatus) {
      el.textContent = text;
      this.lastStatus = text;
    }
  }

  private geometry() {
    const padL = 22, padR = 6, padT = 5, padB = 5;
    const X = (iter: number) => padL + ((iter - 1) / (META_ITERATIONS - 1)) * (this.cw - padL - padR);
    const Y = (v: number) => padT + (1 - (clamp(v, Y_LO, Y_HI) - Y_LO) / (Y_HI - Y_LO)) * (this.ch - padT - padB);
    return { padL, padR, padT, padB, X, Y };
  }

  private iterAtClient(clientX: number): number | null {
    if (!this.chart || this.cw < 40) return null;
    const { padL, padR } = this.geometry();
    const x = clientX - this.chart.getBoundingClientRect().left;
    const u = (x - padL) / (this.cw - padL - padR);
    if (u < -0.05 || u > 1.05) return null;
    return Math.round(1 + clamp(u, 0, 1) * (META_ITERATIONS - 1));
  }

  private setHover(clientX: number | null) {
    this.hoverIter = clientX === null ? null : this.iterAtClient(clientX);
    this.chartDirty = true;
    if (!this.raf) this.drawChart();
    this.updateTip();
  }

  private updateTip() {
    const tip = this.tip;
    if (!tip || !this.chart) return;
    const it = this.hoverIter;
    if (it === null) {
      tip.el.hidden = true;
      return;
    }
    tip.value.textContent = scoreAt(it).toFixed(2);
    tip.label.textContent = `meta-iteration ${it}`;
    tip.el.hidden = false;
    const hr = this.root.getBoundingClientRect();
    const cr = this.chart.getBoundingClientRect();
    const { X } = this.geometry();
    const tw = tip.el.offsetWidth;
    // Below the chart, over the status line (which it restates for the pointer).
    const x = clamp(cr.left - hr.left + X(it) - tw / 2, 8, hr.width - tw - 8);
    const y = cr.bottom - hr.top + 2;
    tip.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  /** The run's mean score: walked part in the accent, the rest dim; worlds marked on the curve. */
  private drawChart() {
    this.chartDirty = false;
    const ctx = this.cctx;
    if (!ctx || this.cw < 40) return;
    const w = this.cw, h = this.ch;
    const { padL, padR, padT, padB, X, Y } = this.geometry();
    ctx.clearRect(0, 0, w, h);

    // Two hairline gridlines carry the scale.
    ctx.font = MONO;
    ctx.textBaseline = 'middle';
    for (const g of [0.3, 0.6]) {
      const y = Math.round(Y(g)) + 0.5;
      ctx.strokeStyle = `rgba(${SLATE}, 0.14)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillStyle = `rgba(${SLATE}, 0.75)`;
      ctx.fillText(g.toFixed(1), 1, y);
    }

    const head = this.head;
    const path = (from: number, to: number) => {
      ctx.beginPath();
      for (let it = from; it <= to; it++) {
        const x = X(it), y = Y(MEAN_SCORE[it - 1]);
        if (it === from) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };
    const hi = Math.floor(head);

    // Ahead of the playhead: a dim line.
    if (hi < META_ITERATIONS) {
      path(Math.max(1, hi), META_ITERATIONS);
      ctx.strokeStyle = `rgba(${SLATE}, 0.35)`;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    // Walked so far: area wash and the line.
    path(1, Math.max(1, hi));
    const hx = X(head), hy = Y(scoreAt(head));
    ctx.lineTo(hx, hy);
    ctx.lineTo(hx, h - padB);
    ctx.lineTo(X(1), h - padB);
    ctx.closePath();
    ctx.fillStyle = `rgba(${ACCENT}, 0.12)`;
    ctx.fill();
    path(1, Math.max(1, hi));
    ctx.lineTo(hx, hy);
    ctx.strokeStyle = `rgba(${ACCENT}, 0.95)`;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Playhead.
    ctx.strokeStyle = `rgba(${ACCENT}, 0.45)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(hx) + 0.5, padT);
    ctx.lineTo(Math.round(hx) + 0.5, h - padB);
    ctx.stroke();

    // Worlds on the curve: reached ones in the accent, the active one larger.
    WORLD_SCENES.forEach((s, i) => {
      const x = X(s.iter), y = Y(scoreAt(s.iter));
      const active = i === this.idx;
      const reached = s.iter <= head + 0.5;
      const r = active ? 5 : 4;
      ctx.fillStyle = `rgb(${GLASS})`;
      ctx.beginPath();
      ctx.arc(x, y, r + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = active ? '#f8fafc' : reached ? `rgb(${ACCENT})` : `rgba(${SLATE}, 0.8)`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (active) {
        ctx.strokeStyle = `rgb(${ACCENT})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });

    // Crosshair at the pointer.
    if (this.hoverIter !== null) {
      const x = Math.round(X(this.hoverIter)) + 0.5;
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, h - padB);
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(X(this.hoverIter), Y(scoreAt(this.hoverIter)), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textBaseline = 'alphabetic';
  }
}

// --- Mounting (works with Astro's ClientRouter) ---------------------------------------------------
let current: WorldsHero | null = null;

function mount() {
  const el = document.querySelector<HTMLElement>('[data-worlds-hero]');
  if (!el || el.dataset.mounted) return;
  el.dataset.mounted = '1';
  try {
    current = new WorldsHero(el);
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
