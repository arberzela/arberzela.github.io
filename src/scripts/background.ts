// Neural-tissue background: draws the simulation in ./neural/tissue.ts on the fixed #bg-canvas.
// Mature cells are cached in an off-screen layer that is rebuilt when a cell matures or starts to
// die, or when the palette changes. Synapses, spikes, glows, growing and dying cells and ripples
// are drawn every frame at ~30 fps. Hovering depolarises the neurons under the pointer, and a
// click or tap makes the neurons around it fire. With reduced motion a single static frame is
// drawn. The loop idles while the tab is hidden or a blog post (which hides the canvas) is open,
// and it survives client-side navigation because the canvas is persisted by Astro's ClientRouter.

import { Tissue, synapsePoint, type Neuron, type Point, type Segment, type Spike, type Synapse } from './neural/tissue';

type Rgb = [number, number, number];

interface Palette {
  a: Rgb; // accent (first end of the neuron colour range)
  b: Rgb; // accent-2 (other end)
  c: Rgb; // accent-3: adult-born neurons, growth cones, potentiation, births
  spike: Rgb;
  arbor: number;
  synapse: number;
  soma: number;
  glow: number;
  /** Dark backgrounds use additive light for activity. */
  dark: boolean;
}

const TAU = Math.PI * 2;
const FRAME_MS = 30;
const PIXEL_BUDGET = 4.6e6; // device pixels per canvas; large screens trade sharpness for memory
const WIDTHS = [0.5, 0.85, 1.25, 1.7]; // stroke widths of the four dendrite thickness classes
const WHITE: Rgb = [255, 255, 255];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const backOut = (t: number) => {
  const c = 1.70158;
  const u = clamp(t, 0, 1) - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};
const mixRgb = (p: Rgb, q: Rgb, t: number): Rgb => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
const css = (c: Rgb, alpha: number) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${clamp(alpha, 0, 1).toFixed(3)})`;

function parseRgb(value: string, fallback: Rgb): Rgb {
  const parts = value.split(',').map((v) => Number(v.trim()));
  return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? (parts as Rgb) : fallback;
}

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const num = (name: string, fallback: number) => {
    const v = parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
  };
  const bg = parseRgb(cs.getPropertyValue('--bg-rgb'), [245, 247, 251]);
  const dark = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2] < 128;
  const a = parseRgb(cs.getPropertyValue('--accent-rgb'), [37, 99, 235]);
  const b = parseRgb(cs.getPropertyValue('--accent-2-rgb'), [124, 58, 237]);
  const c = parseRgb(cs.getPropertyValue('--accent-3-rgb'), [8, 145, 178]);
  return {
    a,
    b,
    c,
    spike: dark ? mixRgb(c, WHITE, 0.45) : mixRgb(a, b, 0.35),
    arbor: num('--neural-arbor', 0.2),
    synapse: num('--neural-synapse', 0.3),
    soma: num('--neural-soma', 0.5),
    glow: num('--neural-glow', 0.45),
    dark,
  };
}

// Dendrite segments grouped by thickness class, so a whole arbor takes four strokes.
const classCache = new WeakMap<Neuron, Segment[][]>();
function classesOf(n: Neuron): Segment[][] {
  let groups = classCache.get(n);
  if (!groups) {
    groups = [[], [], [], []];
    for (const s of n.segs) groups[s.w < 0.68 ? 0 : s.w < 1.05 ? 1 : s.w < 1.45 ? 2 : 3].push(s);
    classCache.set(n, groups);
  }
  return groups;
}

function strokeArbor(g: CanvasRenderingContext2D, n: Neuron, extent: number, widen = 1): void {
  const groups = classesOf(n);
  for (let k = 0; k < 4; k++) {
    const segs = groups[k];
    if (!segs.length) continue;
    g.lineWidth = WIDTHS[k] * widen;
    g.beginPath();
    for (const s of segs) {
      if (s.d1 >= extent) continue;
      const f = s.d2 > extent ? (extent - s.d1) / (s.d2 - s.d1) : 1;
      g.moveTo(n.x + s.x1, n.y + s.y1);
      g.lineTo(n.x + s.x1 + (s.x2 - s.x1) * f, n.y + s.y1 + (s.y2 - s.y1) * f);
    }
    g.stroke();
  }
}

function start(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const tissue = new Tissue();
  const layer = document.createElement('canvas');
  const lctx = layer.getContext('2d');
  const sprite = document.createElement('canvas');
  const pointer = { x: 0, y: 0, active: false };
  const touches: Array<{ x: number; y: number; at: number }> = [];
  const pt: Point = { x: 0, y: 0 };

  let width = 0;
  let height = 0;
  let dpr = 1;
  let pal = readPalette();
  let layerVersion = -1;
  let raf = 0;
  let running = false;
  let last = 0;

  const isPost = () => root.dataset.page === 'post';

  /** A neuron's colour; adult-born cells start in the third accent and take on their own. */
  const cellRgb = (n: Neuron): Rgb => {
    const own = mixRgb(pal.a, pal.b, n.hue);
    if (!n.newborn) return own;
    const k = clamp((tissue.time - n.born) / Math.max(1, n.matureAt - n.born), 0, 1);
    return mixRgb(pal.c, own, k * k);
  };

  const makeSprite = () => {
    const size = 48;
    sprite.width = size;
    sprite.height = size;
    const g = sprite.getContext('2d');
    if (!g) return;
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, css(pal.spike, 1));
    grad.addColorStop(0.16, css(pal.spike, 0.9));
    grad.addColorStop(0.42, css(pal.spike, 0.22));
    grad.addColorStop(1, css(pal.spike, 0));
    g.clearRect(0, 0, size, size);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  };

  const drawCell = (g: CanvasRenderingContext2D, n: Neuron, k: number) => {
    const rgb = cellRgb(n);
    const extent = n.state === 'mature' ? Infinity : n.reach * n.growth;
    g.strokeStyle = css(rgb, pal.arbor * k);
    strokeArbor(g, n, extent);
    const pop =
      n.state === 'growing' ? backOut((tissue.time - n.growStart) / 650) : n.state === 'dying' ? Math.max(0, n.fade) : 1;
    if (pop <= 0) return;
    g.fillStyle = css(rgb, pal.soma * k);
    g.beginPath();
    g.arc(n.x, n.y, n.r * pop, 0, TAU);
    g.fill();
  };

  const rebuildLayer = () => {
    layerVersion = tissue.version;
    if (!lctx) return;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, layer.width, layer.height);
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.lineCap = 'round';
    for (const n of tissue.neurons) if (n.state === 'mature') drawCell(lctx, n, 1);
  };

  const drawGrowthCones = (n: Neuron) => {
    const extent = n.reach * n.growth;
    ctx.fillStyle = css(pal.c, 0.75);
    ctx.beginPath();
    for (const s of n.segs) {
      if (s.d1 >= extent || s.d2 <= extent) continue;
      const f = (extent - s.d1) / (s.d2 - s.d1);
      const x = n.x + s.x1 + (s.x2 - s.x1) * f;
      const y = n.y + s.y1 + (s.y2 - s.y1) * f;
      ctx.moveTo(x + 1.2, y);
      ctx.arc(x, y, 1.2, 0, TAU);
    }
    ctx.fill();
  };

  const drawSynapse = (s: Synapse, now: number) => {
    const g = s.growth;
    const rgb = cellRgb(s.pre);
    const alpha = pal.synapse * (0.2 + 0.8 * s.w);
    // The grown part of the axon is the sub-curve [0, g] of the Bézier (de Casteljau).
    synapsePoint(s, g, pt);
    ctx.strokeStyle = css(rgb, alpha);
    ctx.lineWidth = 0.4 + 1.2 * s.w;
    ctx.beginPath();
    ctx.moveTo(s.x0, s.y0);
    ctx.quadraticCurveTo(s.x0 + (s.cx - s.x0) * g, s.y0 + (s.cy - s.y0) * g, pt.x, pt.y);
    ctx.stroke();
    if (s.state === 'growing') {
      ctx.fillStyle = css(pal.c, 0.9);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 1.5, 0, TAU);
      ctx.fill();
    } else if (s.state === 'active') {
      // Bouton: swells briefly when a spike has just arrived.
      const hit = clamp(1 - (now - s.lastArrival) / 280, 0, 1);
      ctx.fillStyle = css(rgb, alpha * 1.6 + hit * 0.4);
      ctx.beginPath();
      ctx.arc(s.x2, s.y2, 0.7 + 1.1 * s.w + hit * 1.2, 0, TAU);
      ctx.fill();
    }
  };

  const drawGlow = (n: Neuron) => {
    const k = n.glow;
    const own = cellRgb(n);
    const rgb = pal.dark ? mixRgb(own, WHITE, 0.3) : own;
    ctx.strokeStyle = css(rgb, pal.glow * 0.55 * k);
    strokeArbor(ctx, n, n.state === 'mature' ? Infinity : n.reach * n.growth, 1.15);
    const radius = 6 + n.r * 5;
    const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, radius);
    grad.addColorStop(0, css(rgb, pal.glow * k));
    grad.addColorStop(0.4, css(rgb, pal.glow * 0.3 * k));
    grad.addColorStop(1, css(rgb, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(n.x, n.y, radius, 0, TAU);
    ctx.fill();
  };

  const drawFlash = (s: Synapse) => {
    // Potentiation: the synapse lights up as it is strengthened.
    ctx.strokeStyle = css(pal.c, pal.glow * 0.8 * s.flash);
    ctx.lineWidth = 1.6 + 1.2 * s.w;
    ctx.beginPath();
    ctx.moveTo(s.x0, s.y0);
    ctx.quadraticCurveTo(s.cx, s.cy, s.x2, s.y2);
    ctx.stroke();
  };

  const drawSpike = (sp: Spike) => {
    for (let j = 3; j >= 0; j--) {
      const t = sp.t - j * 0.03;
      if (t < 0) continue;
      synapsePoint(sp.syn, t, pt);
      const size = j === 0 ? 12 : 9 - j * 1.8;
      ctx.globalAlpha = j === 0 ? 1 : 0.5 - j * 0.12;
      ctx.drawImage(sprite, pt.x - size / 2, pt.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  };

  const drawRipples = (now: number) => {
    ctx.lineWidth = 1.3;
    for (const b of tissue.births) {
      for (const delay of [0, 380]) {
        const t = (now - b.at - delay) / 1500;
        if (t <= 0 || t >= 1) continue;
        ctx.strokeStyle = css(pal.c, 0.6 * Math.pow(1 - t, 1.6));
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4 + 44 * easeOut(t), 0, TAU);
        ctx.stroke();
      }
    }
    while (touches.length && now - touches[0].at > 900) touches.shift();
    const touchRgb = mixRgb(pal.a, pal.b, 0.5);
    for (const p of touches) {
      const t = (now - p.at) / 900;
      ctx.strokeStyle = css(touchRgb, 0.45 * Math.pow(1 - t, 1.5));
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 + 120 * easeOut(t), 0, TAU);
      ctx.stroke();
    }
  };

  const draw = () => {
    const now = tissue.time;
    if (layerVersion !== tissue.version) rebuildLayer();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(layer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';

    for (const n of tissue.neurons) {
      if (n.state === 'mature' || (n.state === 'growing' && now < n.growStart)) continue;
      drawCell(ctx, n, n.state === 'dying' ? Math.max(0, n.fade) : 1);
      if (n.state === 'growing' && n.growth < 1) drawGrowthCones(n);
    }
    for (const s of tissue.synapses) if (s.wait <= 0 && s.growth > 0.002) drawSynapse(s, now);

    // Activity on top; on dark backgrounds as additive light.
    ctx.globalCompositeOperation = pal.dark ? 'lighter' : 'source-over';
    for (const n of tissue.neurons) if (n.glow > 0.03) drawGlow(n);
    for (const s of tissue.synapses) if (s.flash > 0.03 && s.state === 'active') drawFlash(s);
    for (const sp of tissue.spikes) drawSpike(sp);
    drawRipples(now);
    ctx.globalCompositeOperation = 'source-over';
  };

  const resize = (first = false) => {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = clamp(Math.sqrt(PIXEL_BUDGET / Math.max(1, width * height)), 0.75, Math.min(window.devicePixelRatio || 1, 2));
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    layer.width = canvas.width;
    layer.height = canvas.height;
    tissue.resize(width, height, first && !reduceMotion.matches);
    layerVersion = -1;
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (isPost()) {
      last = now;
      return;
    }
    const elapsed = now - last;
    if (elapsed < FRAME_MS) return;
    last = now;
    const dt = Math.min(elapsed, 50);
    if (pointer.active) tissue.stimulate(pointer.x, pointer.y, 110, 0.0042 * dt);
    tissue.step(dt);
    draw();
  };
  const play = () => {
    if (running || reduceMotion.matches) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };
  const pause = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
  const refreshPalette = () => {
    pal = readPalette();
    makeSprite();
    layerVersion = -1;
    if (!running) draw();
  };

  makeSprite();
  resize(true);
  draw();
  play();

  let resizeTimer = 0;
  window.addEventListener(
    'resize',
    () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resize();
        if (!running) draw();
      }, 150);
    },
    { passive: true },
  );

  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
  reduceMotion.addEventListener('change', () => {
    if (reduceMotion.matches) {
      pause();
      draw();
    } else {
      play();
    }
  });

  if (finePointer.matches) {
    window.addEventListener(
      'pointermove',
      (e) => {
        pointer.x = e.clientX;
        pointer.y = e.clientY;
        pointer.active = true;
      },
      { passive: true },
    );
    root.addEventListener('mouseleave', () => {
      pointer.active = false;
    });
  }

  // A click or tap makes the neurons around it fire, with a ripple.
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (reduceMotion.matches || isPost()) return;
      tissue.stimulate(e.clientX, e.clientY, 150, 1.6);
      touches.push({ x: e.clientX, y: e.clientY, at: tissue.time });
    },
    { passive: true },
  );

  // Re-read the palette when the theme or the section changes (toggle, OS preference, navigation).
  new MutationObserver(refreshPalette).observe(root, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-section', 'data-page'],
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshPalette);
}

const canvas = document.getElementById('bg-canvas') as HTMLCanvasElement | null;
const ctx = canvas?.getContext('2d');
if (canvas && ctx) {
  try {
    start(canvas, ctx);
  } catch (err) {
    console.warn('Background animation disabled:', err);
  }
}
