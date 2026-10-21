// ASCII space turtles behind the pages: draws the scene in ./ascii/space.ts on the fixed #bg-canvas.
// Each frame the constellation lines are stroked first, then the tiles are written into a
// cell-sized ImageData and scaled up in one draw, a grid pattern goes on top (it separates the
// tiles and lines the empty space), and glyphs are stamped from a pre-rendered atlas. Turtles fade
// behind the text column so it stays readable. The pointer shoos turtles away and pulls in
// constellation lines; a click sets off a burst of sparks. With reduced motion a single still
// frame is drawn. The loop pauses while the tab is hidden or a blog post (which hides the canvas)
// is open, and it survives client-side navigation because the canvas is persisted.

import { Cosmos, GLYPHS, INK, INK_COUNT, type Rgb, type SpacePalette } from './ascii/space';

interface Theme {
  space: SpacePalette;
  /** Constellation line colours (the two ends of the hue range) and opacity. */
  lineA: Rgb;
  lineB: Rgb;
  lineAlpha: number;
  /** CSS colour per ink index (1..INK_COUNT). */
  inks: string[];
  grid: string;
  opacity: number;
  /** Visibility of the turtles behind the text column. */
  faint: number;
}

const CELL = 12; // CSS px per grid cell
const FRAME_MS = 40; // 20 fps at 60 Hz, 24 fps at 120 Hz: enough for the stepped ASCII motion
const PIXEL_BUDGET = 9e6; // device pixels per canvas; only very large screens drop below the device ratio
const FEATHER = 80; // px over which turtles fade at the edges of the text column

const WHITE: Rgb = [255, 255, 255];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const css = (c: Rgb) => `rgb(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0})`;
const cssA = (c: Rgb, a: number) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${clamp(a, 0, 1).toFixed(3)})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function parseRgb(value: string, fallback: Rgb): Rgb {
  const v = value.trim();
  if (v.startsWith('#')) {
    const hex = v.length === 4 ? v.slice(1).replace(/./g, (ch) => ch + ch) : v.slice(1, 7);
    const n = parseInt(hex, 16);
    return hex.length === 6 && Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : fallback;
  }
  const parts = v.split(',').map((p) => Number(p.trim()));
  return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? (parts as Rgb) : fallback;
}

/**
 * Turtle colours derived from the page palette, so they belong to the background: nebula shells
 * in the two accents, a pale ring, skin in the third accent, and distant turtles fade into the page.
 */
function spacePalette(bg: Rgb, text: Rgb, a: Rgb, b: Rgb, c: Rgb, dark: boolean): SpacePalette {
  const hue = mix(a, b, 0.5);
  if (!dark) {
    return {
      nebulaDark: mix(text, b, 0.35),
      nebulaLight: mix(text, a, 0.55),
      nebulaAlt: mix(text, c, 0.5),
      rim: mix(bg, hue, 0.45),
      skin: mix(text, c, 0.45),
      skinLine: mix(bg, c, 0.3),
      eye: text,
      cast: bg,
      nodeTile: mix(bg, hue, 0.35),
    };
  }
  return {
    nebulaDark: mix(bg, b, 0.4),
    nebulaLight: mix(bg, a, 0.6),
    nebulaAlt: mix(bg, c, 0.45),
    rim: mix(bg, hue, 0.65),
    skin: mix(bg, c, 0.42),
    skinLine: mix(bg, mix(c, WHITE, 0.4), 0.72),
    eye: bg,
    cast: bg,
    nodeTile: mix(bg, hue, 0.4),
  };
}

function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const num = (name: string, fallback: number) => {
    const v = parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
  };
  const bg = parseRgb(cs.getPropertyValue('--bg-rgb'), [245, 247, 251]);
  const dark = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2] < 128;
  const text = parseRgb(cs.getPropertyValue('--text'), dark ? [231, 234, 243] : [23, 27, 38]);
  const a = parseRgb(cs.getPropertyValue('--accent-rgb'), [37, 99, 235]);
  const b = parseRgb(cs.getPropertyValue('--accent-2-rgb'), [124, 58, 237]);
  const c = parseRgb(cs.getPropertyValue('--accent-3-rgb'), [8, 145, 178]);
  const inks: string[] = [];
  inks[INK.light] = css(dark ? text : WHITE);
  inks[INK.dark] = css(dark ? bg : text);
  inks[INK.accentA] = css(a);
  inks[INK.accentB] = css(b);
  inks[INK.accentC] = css(c);
  inks[INK.dim] = css(mix(bg, text, dark ? 0.6 : 0.45));
  return {
    space: spacePalette(bg, text, a, b, c, dark),
    lineA: a,
    lineB: b,
    lineAlpha: num('--constellation-alpha', 0.16),
    inks,
    grid: css(mix(bg, dark ? [255, 255, 255] : [23, 27, 38], num('--ascii-grid', 0.055))),
    opacity: num('--ascii-opacity', 0.9),
    faint: num('--ascii-faint', 0.3),
  };
}

function start(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const cosmos = new Cosmos(CELL);
  const tiles = document.createElement('canvas');
  const tctx = tiles.getContext('2d');
  let grid: CanvasPattern | null = null;
  const atlas = document.createElement('canvas');
  const actx = atlas.getContext('2d');

  let theme = readTheme();
  let image: ImageData | null = null;
  let width = 0;
  let height = 0;
  let cellPx = CELL; // device pixels per cell (an integer, so tiles and glyphs stay crisp)
  let raf = 0;
  let running = false;
  let last = 0;

  const isPost = () => root.dataset.page === 'post';
  const font = () => `600 ${Math.round(cellPx * 0.8)}px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;

  const buildAtlas = () => {
    if (!actx) return;
    atlas.width = cellPx * GLYPHS.length;
    atlas.height = cellPx * INK_COUNT;
    actx.clearRect(0, 0, atlas.width, atlas.height);
    actx.font = font();
    actx.textAlign = 'center';
    actx.textBaseline = 'middle';
    for (let ink = 1; ink <= INK_COUNT; ink++) {
      actx.fillStyle = theme.inks[ink];
      for (let g = 1; g < GLYPHS.length; g++) {
        actx.fillText(GLYPHS[g], (g + 0.5) * cellPx, (ink - 0.5) * cellPx + cellPx * 0.04);
      }
    }
  };

  // One cell with its top and left edge; repeated over the canvas it draws the grid.
  const buildGrid = () => {
    const cellCanvas = document.createElement('canvas');
    cellCanvas.width = cellPx;
    cellCanvas.height = cellPx;
    const g = cellCanvas.getContext('2d');
    if (!g) return;
    g.fillStyle = theme.grid;
    g.fillRect(0, 0, cellPx, 1);
    g.fillRect(0, 1, 1, cellPx - 1);
    grid = ctx.createPattern(cellCanvas, 'repeat');
  };

  // Fade turtles behind the main text column; they stay vivid in the margins and below the sidebar.
  const updateMask = () => {
    const mask = cosmos.mask;
    mask.fill(1);
    const column = document.querySelector<HTMLElement>('main.content');
    if (!column) return;
    const box = column.getBoundingClientRect();
    if (box.width <= 0) return;
    // On phones the column spans the screen; fade a little less so the turtles still show.
    const faint = box.width > 0.8 * width ? Math.max(theme.faint, 0.42) : theme.faint;
    for (let c = 0; c < mask.length; c++) {
      const x = (c + 0.5) * CELL;
      const outside = Math.max(box.left - x, x - box.right, 0);
      const t = clamp(outside / FEATHER, 0, 1);
      mask[c] = faint + (1 - faint) * t * t * (3 - 2 * t);
    }
  };

  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    // Match the device pixel ratio when the cell size comes out whole (1, 1.25, 1.5, 2 do), so the
    // canvas is not resampled and the glyphs stay sharp.
    const ideal = clamp(Math.sqrt(PIXEL_BUDGET / Math.max(1, width * height)), 0.75, Math.min(window.devicePixelRatio || 1, 2));
    cellPx = Math.max(8, Math.round(CELL * ideal));
    const dpr = cellPx / CELL;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    cosmos.resize(width, height);
    tiles.width = cosmos.cols;
    tiles.height = cosmos.rows;
    image = new ImageData(cosmos.rgba, cosmos.cols, cosmos.rows);
    buildGrid();
    buildAtlas();
    updateMask();
  };

  // Constellation lines and pulse rings, in CSS pixels, beneath everything else.
  const drawConstellation = () => {
    const { links, linkCount, pulses, mask } = cosmos;
    ctx.setTransform(cellPx / CELL, 0, 0, cellPx / CELL, 0, 0);
    ctx.lineWidth = 1;
    const fadeAt = (x: number) => Math.max(mask[clamp(Math.floor(x / CELL), 0, mask.length - 1)] ?? 1, 0.6);
    for (let k = 0; k < linkCount; k++) {
      const o = k * 6;
      const [x1, y1, x2, y2, strength, hue] = [links[o], links[o + 1], links[o + 2], links[o + 3], links[o + 4], links[o + 5]];
      const alpha = theme.lineAlpha * strength * (fadeAt(x1) + fadeAt(x2)) * 0.5;
      ctx.strokeStyle = cssA(mix(theme.lineA, theme.lineB, hue), alpha);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.lineWidth = 1.5;
    for (const p of pulses) {
      const t = p.age / 1.5;
      ctx.strokeStyle = cssA(mix(theme.lineA, theme.lineB, p.hue), 0.5 * Math.pow(1 - t, 1.5) * fadeAt(p.x));
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 + 56 * t, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  const draw = () => {
    if (!image || !tctx) return;
    cosmos.render(theme.space, theme.opacity);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawConstellation();
    tctx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tiles, 0, 0, cosmos.cols * cellPx, cosmos.rows * cellPx);
    if (grid) {
      ctx.fillStyle = grid;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const { glyph, ink, inkA, cols } = cosmos;
    for (let i = 0; i < glyph.length; i++) {
      const g = glyph[i];
      if (!g || !inkA[i]) continue;
      ctx.globalAlpha = inkA[i] / 255;
      ctx.drawImage(atlas, g * cellPx, (ink[i] - 1) * cellPx, cellPx, cellPx, (i % cols) * cellPx, Math.floor(i / cols) * cellPx, cellPx, cellPx);
    }
    ctx.globalAlpha = 1;
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const elapsed = now - last;
    if (elapsed < FRAME_MS) return;
    last = now;
    cosmos.step(Math.min(elapsed, 100) / 1000);
    draw();
  };
  const play = () => {
    if (running || reduceMotion.matches || document.hidden || isPost()) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };
  const pause = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
  const refreshTheme = () => {
    theme = readTheme();
    buildGrid();
    buildAtlas();
    updateMask();
    if (!running) draw();
  };

  resize();
  draw();
  play();

  // Glyphs fall back to a system monospace until JetBrains Mono has loaded.
  document.fonts?.load(font()).then(() => {
    buildAtlas();
    if (!running) draw();
  });

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
  // The text column moves with the layout of each page; blog posts hide the canvas.
  document.addEventListener('astro:page-load', () => {
    updateMask();
    if (isPost()) pause();
    else if (!running) {
      draw();
      play();
    }
  });

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
    window.addEventListener('pointermove', (e) => cosmos.setPointer(e.clientX, e.clientY, true), { passive: true });
    root.addEventListener('mouseleave', () => cosmos.setPointer(0, 0, false));
  }
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (reduceMotion.matches || isPost()) return;
      cosmos.poke(e.clientX, e.clientY);
    },
    { passive: true },
  );

  // Re-read the palette when the theme or the section changes (toggle, OS preference, navigation).
  new MutationObserver(refreshTheme).observe(root, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-section', 'data-page'],
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshTheme);
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
