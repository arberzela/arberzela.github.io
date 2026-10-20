// Animated "constellation" background: drifting nodes in a blue→violet gradient joined by faint
// edges, with a soft glow, occasional pulses, ripples on click, edges lighting up around the
// pointer, and a slight parallax against the page scroll. Renders a single static frame when the
// visitor prefers reduced motion, pauses while the tab is hidden, and keeps running across
// client-side navigations (the canvas element is persisted by Astro's ClientRouter).

type Node = { x: number; y: number; vx: number; vy: number; r: number; mix: number; col: string };
type Pulse = { x: number; y: number; start: number; dur: number; max: number; col: string; screen: boolean };

const LINK_DIST = 150;
const POINTER_DIST = 190;
const PUSH_DIST = 130;
const PARALLAX = 0.08;

function parseRgb(value: string, fallback: [number, number, number]): [number, number, number] {
  const parts = value.split(',').map((v) => Number(v.trim()));
  return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? (parts as [number, number, number]) : fallback;
}

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  return `${Math.round(a[0] + (b[0] - a[0]) * t)}, ${Math.round(a[1] + (b[1] - a[1]) * t)}, ${Math.round(a[2] + (b[2] - a[2]) * t)}`;
}

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  return {
    a: parseRgb(cs.getPropertyValue('--accent-rgb'), [37, 99, 235]),
    b: parseRgb(cs.getPropertyValue('--accent-2-rgb'), [124, 58, 237]),
    lineAlpha: parseFloat(cs.getPropertyValue('--line-alpha')) || 0.16,
    nodeAlpha: parseFloat(cs.getPropertyValue('--node-alpha')) || 0.55,
  };
}

function start(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const pointer = { x: 0, y: 0, active: false };

  let width = 0;
  let height = 0;
  let nodes: Node[] = [];
  let pulses: Pulse[] = [];
  let colors = readColors();
  let raf = 0;
  let running = false;
  let lastFrame = 0;
  let lastPulse = 0;

  const colorize = () => {
    for (const n of nodes) n.col = mix(colors.a, colors.b, n.mix);
  };

  const makeNode = (): Node => {
    const speed = 0.12 + Math.random() * 0.22;
    const angle = Math.random() * Math.PI * 2;
    const node: Node = {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 1.2 + Math.random() * 1.7,
      mix: Math.random(),
      col: '',
    };
    node.col = mix(colors.a, colors.b, node.mix);
    return node;
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Node count follows the viewport area; keep existing nodes so a resize doesn't "jump".
    const target = Math.max(24, Math.min(110, Math.round((width * height) / 14000)));
    nodes = nodes.filter((n) => n.x <= width && n.y <= height).slice(0, target);
    while (nodes.length < target) nodes.push(makeNode());
  };

  const step = (now: number) => {
    for (const n of nodes) {
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < -10) n.x = width + 10;
      else if (n.x > width + 10) n.x = -10;
      if (n.y < -10) n.y = height + 10;
      else if (n.y > height + 10) n.y = -10;
    }
    // Nodes make way for the pointer.
    if (pointer.active) {
      const oy = (window.scrollY * PARALLAX) % height;
      for (const n of nodes) {
        const dx = n.x - pointer.x;
        const dy = n.y - oy - pointer.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.5 && d < PUSH_DIST) {
          const f = (1 - d / PUSH_DIST) * 0.9;
          n.x += (dx / d) * f;
          n.y += (dy / d) * f;
        }
      }
    }
    // A node lights up every couple of seconds.
    if (now - lastPulse > 2400 && nodes.length) {
      lastPulse = now;
      const n = nodes[Math.floor(Math.random() * nodes.length)];
      pulses.push({ x: n.x, y: n.y, start: now, dur: 1500, max: 56, col: n.col, screen: false });
    }
    pulses = pulses.filter((p) => now - p.start < p.dur);
  };

  const draw = (now: number) => {
    ctx.clearRect(0, 0, width, height);
    const { lineAlpha, nodeAlpha } = colors;
    const oy = (window.scrollY * PARALLAX) % height;

    // Screen positions with parallax (wrapped vertically).
    const px = new Float32Array(nodes.length);
    const py = new Float32Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      px[i] = nodes[i].x;
      let y = nodes[i].y - oy;
      if (y < -12) y += height;
      py[i] = y;
    }

    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = px[i] - px[j];
        const dy = py[i] - py[j];
        const d2 = dx * dx + dy * dy;
        if (d2 > LINK_DIST * LINK_DIST) continue;
        const t = 1 - Math.sqrt(d2) / LINK_DIST;
        ctx.strokeStyle = `rgba(${a.col}, ${(t * lineAlpha).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(px[i], py[i]);
        ctx.lineTo(px[j], py[j]);
        ctx.stroke();
      }
      if (pointer.active) {
        const dx = px[i] - pointer.x;
        const dy = py[i] - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < POINTER_DIST * POINTER_DIST) {
          const t = 1 - Math.sqrt(d2) / POINTER_DIST;
          ctx.strokeStyle = `rgba(${a.col}, ${(t * lineAlpha * 2.2).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(px[i], py[i]);
          ctx.lineTo(pointer.x, pointer.y);
          ctx.stroke();
        }
      }
    }

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      ctx.fillStyle = `rgba(${n.col}, ${(nodeAlpha * 0.12).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(px[i], py[i], n.r * 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${n.col}, ${nodeAlpha})`;
      ctx.beginPath();
      ctx.arc(px[i], py[i], n.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.lineWidth = 1.5;
    for (const p of pulses) {
      const t = (now - p.start) / p.dur;
      let y = p.screen ? p.y : p.y - oy;
      if (!p.screen && y < -12) y += height;
      ctx.strokeStyle = `rgba(${p.col}, ${(Math.pow(1 - t, 1.5) * 0.55).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, y, 3 + t * p.max, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  // ~30 fps is plenty for slow drift and halves the CPU cost on laptops.
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    // Post pages hide this background (they have their own hero illustration).
    if (document.documentElement.dataset.page === 'post') return;
    if (now - lastFrame < 30) return;
    lastFrame = now;
    step(now);
    draw(now);
  };
  const play = () => {
    if (running || reduceMotion.matches) return;
    running = true;
    raf = requestAnimationFrame(frame);
  };
  const pause = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
  const refreshColors = () => {
    colors = readColors();
    colorize();
    if (!running) draw(performance.now());
  };

  resize();
  draw(performance.now());
  play();

  let resizeTimer = 0;
  window.addEventListener(
    'resize',
    () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resize();
        draw(performance.now());
      }, 120);
    },
    { passive: true },
  );

  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
  reduceMotion.addEventListener('change', () => (reduceMotion.matches ? (pause(), draw(performance.now())) : play()));

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
    document.documentElement.addEventListener('mouseleave', () => {
      pointer.active = false;
    });
  }

  // A ripple spreads out from wherever the page is clicked or tapped.
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (reduceMotion.matches) return;
      pulses.push({ x: e.clientX, y: e.clientY, start: performance.now(), dur: 900, max: 150, col: mix(colors.a, colors.b, 0.5), screen: true });
    },
    { passive: true },
  );

  // Re-read colours when the theme changes (toggle button or OS preference).
  new MutationObserver(refreshColors).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshColors);
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
