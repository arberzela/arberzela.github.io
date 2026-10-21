// ASCII-mosaic space with turtles for the site background (no DOM; drawn by ../background.ts).
//
// The viewport is a grid of square cells. Turtles, seen from above, swim through a starfield:
// every cell a turtle covers becomes a tinted tile with a monospace glyph. Each shell is a small
// nebula scattered with stars and crossed by the seams of its scutes, drawn as glowing line glyphs
// that follow the seam on screen; head and flippers carry a scale mosaic and the eyes glow.
// Turtles row with their front flippers, shed stardust, steer away from the pointer and are
// startled by clicks, which also set off a burst of sparks. Stars twinkle, now and then a
// shooting star streaks past, and a slowly drifting constellation links nearby stars (and the
// pointer) with faint lines that the renderer draws beneath the turtles.
// Lengths are CSS pixels, times seconds.

export type Rgb = [number, number, number];

export interface SpacePalette {
  /** The shell's nebula: two tones plus a second hue swirling through it. */
  nebulaDark: Rgb;
  nebulaLight: Rgb;
  nebulaAlt: Rgb;
  /** Ring of marginal scutes, also the faint tint under the seams. */
  rim: Rgb;
  skin: Rgb;
  /** Pale lines between the scales of the head and flippers. */
  skinLine: Rgb;
  eye: Rgb;
  /** Page colour that distant turtles fade into. */
  cast: Rgb;
  /** Faint tile behind each constellation star. */
  nodeTile: Rgb;
}

/** A ring spreading from a constellation star. */
export interface Pulse {
  x: number;
  y: number;
  age: number;
  hue: number;
}

/** Glyphs used by the grid; index 0 is an empty cell. */
export const GLYPHS = [' ', '@', '8', '%', '#', 'S', 'X', 'x', 't', 'o', '+', ';', ':', "'", '.', ',', '-', '`', '°', 'O', '·', '*', '|', '/', '\\', '='];
/** Glyph colours: 1 light (on dark tiles), 2 dark (on light tiles), 3-5 accents, 6 dim (stars). */
export const INK = { light: 1, dark: 2, accentA: 3, accentB: 4, accentC: 5, dim: 6 } as const;
export const INK_COUNT = 6;

const G = (s: string) => s.split(' ').map((g) => GLYPHS.indexOf(g));
// Scale mosaic glyphs by tile brightness, darkest first.
const BANDS = [G('@ 8 # %'), G('S X % 8 #'), G('t x % S o'), G('; : t x +'), G(": ' . ; -")];
const EDGE = G(": ; ' . ,");
const HALO = G("' , . `");
/** Line glyphs for directions 0°, 45°, 90° and 135° on screen (y pointing down). */
const LINES = G('- \\ | /');
const SHELL_STAR = G('* + ·');
const NEBULA_DUST = G(". : ` '");
const STAR = G(". · ' + *");
const DUST = G('· . · + *');
const SPARK = G('* + · .');
const NODE = G('* +');
const DOT = GLYPHS.indexOf('·');
const COLON = GLYPHS.indexOf(':');
const EYE = GLYPHS.indexOf('o');
const HEAD_STAR = GLYPHS.indexOf('*');

const TAU = Math.PI * 2;
const LIGHT: [number, number, number] = [-0.4, -0.55, 0.73]; // from the top left, towards the viewer
const NONE = 0;
const SHELL = 1;
const HEAD = 2;
const NECK = 3;
const FRONT = 4;
const REAR = 5;
const SHELL_W = 0.74;

// Centres of the vertebral row and the right-hand costal scutes (the left side mirrors them).
const SCUTES: Array<[number, number]> = [
  [0.62, 0],
  [0.3, 0],
  [0.0, 0],
  [-0.3, 0],
  [-0.6, 0],
  [0.44, 0.43],
  [0.14, 0.47],
  [-0.17, 0.44],
  [-0.45, 0.33],
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function hash(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Cellular noise: distance between the two nearest feature points (small on cell borders). */
function cellEdge(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let d1 = 9;
  let d2 = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const dx = cx + 0.2 + 0.6 * hash(cx, cy, seed) - x;
      const dy = cy + 0.2 + 0.6 * hash(cy, cx, seed + 7) - y;
      const d = dx * dx + dy * dy;
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) d2 = d;
    }
  }
  return Math.sqrt(d2) - Math.sqrt(d1);
}

function setRgb(out: number[], c: Rgb): void {
  out[0] = c[0];
  out[1] = c[1];
  out[2] = c[2];
}

function mixInto(out: number[], a: ArrayLike<number>, b: ArrayLike<number>, t: number): void {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

/** The line glyph closest to a screen direction. */
function lineGlyphAt(sx: number, sy: number): number {
  let a = Math.atan2(sy, sx);
  if (a < 0) a += Math.PI;
  return LINES[Math.round(a / (Math.PI / 4)) % 4];
}

/** Half-width of the heart-shaped carapace at position x along the body (x = 1 front, -1 rear). */
function shellHalfWidth(x: number): number {
  if (x <= -1 || x >= 1) return 0;
  const w = SHELL_W * Math.sqrt(1 - x * x);
  return x < 0 ? w * (1 + 0.32 * x) : w * (1 + 0.05 * x);
}

// --- Turtles -------------------------------------------------------------------------------------

export interface Turtle {
  x: number;
  y: number;
  heading: number;
  /** Cruising speed (px/s). */
  speed: number;
  /** Depth: 0.6 (far) … 1.1 (near); sets size, speed, contrast. */
  scale: number;
  /** Flipper stroke phase (rad) and period (s). */
  phase: number;
  period: number;
  /** Startle speed-up, decays. */
  boost: number;
  a1: number;
  w1: number;
  p1: number;
  a2: number;
  w2: number;
  p2: number;
  /** Has been inside the viewport (and may leave it for good). */
  entered: boolean;
  age: number;
  seed: number;
  /** Time until the next puff of stardust. */
  dust: number;
}

/** Per-frame pose of a turtle, shared by its cells. */
interface Pose {
  cos: number;
  sin: number;
  /** Front flipper direction (cos, sin of the angle from the forward axis) and width. */
  fc: number;
  fs: number;
  fw: number;
  /** Rear flipper direction. */
  rc: number;
  rs: number;
  sway: number;
  depth: number;
}

// Scratch output of partAt: position across a flipper (-1 leading edge … 1 trailing edge).
let flipN = 0;
// Scratch output of shade: tile alpha factor and an optional fixed glyph, ink and glyph alpha.
let tileK = 1;
let hintGlyph = 0;
let hintInk = 0;
let hintAlpha = 1;

function partAt(p: Pose, lx: number, ly: number): number {
  const hw = shellHalfWidth(lx);
  if (hw > 0 && Math.abs(ly) <= hw) return SHELL;
  const hx = (lx - 1.25) / 0.33;
  if (hx > -1 && hx < 1) {
    const hy = (ly - p.sway) / (0.24 * (1 - 0.2 * hx));
    if (hx * hx + hy * hy <= 1) return HEAD;
  }
  const nx = (lx - 0.98) / 0.2;
  const ny = ly / 0.19;
  if (nx * nx + ny * ny <= 1) return NECK;

  // Flippers are mirror-symmetric, so test the right-hand pair only.
  const ay = Math.abs(ly);
  let qx = lx - 0.52;
  let qy = ay - 0.5;
  let s = qx * p.fc + qy * p.fs;
  let n = -qx * p.fs + qy * p.fc;
  if (s >= 0 && s <= 1.15) {
    const r = s / 1.15;
    const k = n - 0.3 * s * s; // the paddle curves backwards like a scimitar
    const w = 0.33 * p.fw * Math.pow(1 - r * r, 0.6) * Math.min(1, 0.6 + 2 * r);
    if (Math.abs(k) <= w) {
      flipN = k / w;
      return FRONT;
    }
  }
  qx = lx + 0.72;
  qy = ay - 0.3;
  s = qx * p.rc + qy * p.rs;
  n = -qx * p.rs + qy * p.rc;
  if (s >= 0 && s <= 0.5) {
    const r = s / 0.5;
    const k = n - 0.3 * s * s;
    const w = 0.19 * Math.pow(1 - r * r, 0.6);
    if (Math.abs(k) <= w) {
      flipN = k / w;
      return REAR;
    }
  }
  return NONE;
}

/** Diffuse light on a surface with the given local normal, applied to `out`. */
function light(p: Pose, nx: number, ny: number, nz: number, out: number[], lo: number, gain: number): void {
  const len = Math.hypot(nx, ny, nz) || 1;
  const sx = nx * p.cos - ny * p.sin;
  const sy = nx * p.sin + ny * p.cos;
  const d = Math.max(0, (sx * LIGHT[0] + sy * LIGHT[1] + nz * LIGHT[2]) / len);
  const f = lo + gain * d;
  out[0] = Math.min(255, out[0] * f);
  out[1] = Math.min(255, out[1] * f);
  out[2] = Math.min(255, out[2] * f);
}

function shade(t: Turtle, p: Pose, part: number, lx: number, ly: number, pal: SpacePalette, out: number[]): void {
  tileK = 1;
  hintGlyph = 0;
  if (part === SHELL) {
    const ay = Math.abs(ly);
    let d1 = 9;
    let d2 = 9;
    let k1 = 0;
    let k2 = 0;
    for (let i = 0; i < SCUTES.length; i++) {
      const dx = lx - SCUTES[i][0];
      const dy = ay - SCUTES[i][1];
      const d = dx * dx + dy * dy * 1.15;
      if (d < d1) {
        d2 = d1;
        k2 = k1;
        d1 = d;
        k1 = i;
      } else if (d < d2) {
        d2 = d;
        k2 = i;
      }
    }
    const hw = shellHalfWidth(lx);
    const e = Math.max(Math.abs(lx), hw > 0 ? ay / hw : 1);
    if (e > 0.86) {
      // Ring of marginal scutes, studded with points of light at the seams.
      setRgb(out, pal.rim);
      const seg = (Math.atan2(ly / SHELL_W, lx) / TAU) * 26;
      const seam = seg - Math.floor(seg) < 0.22;
      hintGlyph = seam ? DOT : COLON;
      hintInk = seam ? INK.accentC : INK.light;
      hintAlpha = seam ? 1 : 0.5;
    } else if (Math.sqrt(d2) - Math.sqrt(d1) < 0.045 || e > 0.82) {
      // Seams between the scutes: glowing constellation lines over a faint tile.
      setRgb(out, pal.rim);
      tileK = 0.3;
      let dx: number;
      let dy: number;
      if (e > 0.8) {
        dx = -ly; // along the ring
        dy = lx;
      } else {
        const sgn = ly < 0 ? -1 : 1;
        dx = -(SCUTES[k2][1] - SCUTES[k1][1]) * sgn; // perpendicular to the line between the scute centres
        dy = SCUTES[k2][0] - SCUTES[k1][0];
      }
      hintGlyph = lineGlyphAt(dx * p.cos - dy * p.sin, dx * p.sin + dy * p.cos);
      hintInk = INK.accentC;
      hintAlpha = 1;
    } else {
      // A nebula inside each shell, with a scatter of stars that travel with the turtle.
      const n1 = 0.5 + 0.5 * Math.sin(lx * 3.1 + t.seed * 6) * Math.sin(ly * 3.7 - t.seed * 4);
      const n2 = 0.5 + 0.5 * Math.sin((lx + ly) * 4.3 + t.seed * 9);
      mixInto(out, pal.nebulaDark, pal.nebulaLight, n1);
      mixInto(out, out, pal.nebulaAlt, 0.55 * n2 * n2);
      const h = hash(Math.floor(lx * 7 + 50), Math.floor(ly * 7 + 50), (t.seed * 1e4) | 0);
      if (h < 0.1) {
        hintGlyph = SHELL_STAR[Math.floor(h * 30)];
        hintAlpha = 1;
      } else {
        hintGlyph = NEBULA_DUST[Math.floor(h * 40) % NEBULA_DUST.length];
        hintAlpha = 0.3;
      }
      hintInk = INK.light;
    }
    const r2 = lx * lx + (ly / SHELL_W) * (ly / SHELL_W);
    light(p, lx * 0.8, ly, 1.3 * Math.sqrt(Math.max(0, 1 - r2)), out, 0.75, 0.35);
  } else {
    const size = part === HEAD || part === NECK ? 0.12 : 0.16;
    const edge = cellEdge(lx / size, ly / size, (t.seed * 1000) | 0);
    mixInto(out, pal.skin, pal.skinLine, edge < 0.14 ? 0.85 : 0);
    if (part === HEAD) {
      const ex = lx - 1.31;
      const ey = Math.abs(ly - p.sway) - 0.14;
      if (ex * ex + ey * ey < 0.0036) {
        // Glowing eyes.
        setRgb(out, pal.eye);
        hintGlyph = t.seed < 0.5 ? EYE : HEAD_STAR;
        hintInk = INK.accentC;
        hintAlpha = 1;
      }
      light(p, (lx - 1.25) * 2, (ly - p.sway) * 2.5, 0.8, out, 0.62, 0.5);
    } else if (part === FRONT) {
      if (flipN < -0.55) mixInto(out, out, pal.skinLine, 0.35); // pale leading edge
      light(p, 0, 0, 1, out, 0.7 + 0.15 * -flipN, 0.25);
    } else {
      light(p, 0, 0, 1, out, 0.72, 0.25);
    }
  }
  mixInto(out, out, pal.cast, 0.08 + 0.32 * (1 - p.depth));
}

// --- Space ---------------------------------------------------------------------------------------

interface Star {
  x: number;
  y: number;
  glyph: number;
  ink: number;
  alpha: number;
  phase: number;
  rate: number;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  glyph: number;
  ink: number;
  /** Velocity damping per second. */
  drag: number;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  length: number;
}

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Colour position between the first two accents (0..1). */
  hue: number;
  glyph: number;
}

const OFFSETS = [-0.25, 0.25];
const ACCENTS = [INK.accentA, INK.accentB, INK.accentC, INK.light];
const LINK_DIST = 160;
const POINTER_DIST = 190;
const MAX_LINKS = 400;

export class Cosmos {
  readonly cell: number;
  cols = 0;
  rows = 0;
  width = 0;
  height = 0;
  /** Tile colour and alpha per cell (row-major), ready for an ImageData. */
  rgba = new Uint8ClampedArray(0);
  /** Glyph index, ink index and glyph alpha (0-255) per cell. */
  glyph = new Uint8Array(0);
  ink = new Uint8Array(0);
  inkA = new Uint8Array(0);
  /** Visibility factor per column (the renderer fades the area behind the text column). */
  mask = new Float32Array(0);
  time = 0;
  readonly turtles: Turtle[] = [];
  /** Constellation lines for this frame: x1, y1, x2, y2, strength (0..1), hue per line. */
  readonly links = new Float32Array(MAX_LINKS * 6);
  linkCount = 0;
  readonly pulses: Pulse[] = [];

  private readonly rng: () => number;
  private readonly nodes: Node[] = [];
  private nextPulse = 0;
  private readonly stars: Star[] = [];
  private readonly dust: Mote[] = [];
  private readonly sparks: Mote[] = [];
  private readonly meteors: Meteor[] = [];
  private readonly pointer = { x: 0, y: 0, active: false };
  private readonly pose: Pose = { cos: 1, sin: 0, fc: 0, fs: 1, fw: 1, rc: 0, rs: 1, sway: 0, depth: 1 };
  private readonly color = [0, 0, 0];
  private target = 1;
  private unit = 90;
  private nextSpawn = 0;
  private nextMeteor = 0;

  constructor(cell = 12, rng: () => number = Math.random) {
    this.cell = cell;
    this.rng = rng;
  }

  /** Fit the grid to the viewport; the first call puts a few turtles in view. */
  resize(width: number, height: number): void {
    const first = this.cols === 0;
    this.width = width;
    this.height = height;
    this.cols = Math.ceil(width / this.cell);
    this.rows = Math.ceil(height / this.cell);
    const n = this.cols * this.rows;
    this.rgba = new Uint8ClampedArray(n * 4);
    this.glyph = new Uint8Array(n);
    this.ink = new Uint8Array(n);
    this.inkA = new Uint8Array(n);
    this.mask = new Float32Array(this.cols).fill(1);
    this.target = Math.round(clamp((width * height) / 420000, 1, 4));
    this.unit = 90 * clamp(Math.sqrt(width * height) / 1100, 0.6, 1.1);

    const stars = Math.round(n / 180);
    while (this.stars.length > stars) this.stars.pop();
    while (this.stars.length < stars) this.stars.push(this.makeStar());
    for (const s of this.stars) {
      s.x %= width;
      s.y %= height;
    }
    const nodes = Math.round(clamp((width * height) / 34000, 14, 60));
    while (this.nodes.length > nodes) this.nodes.pop();
    while (this.nodes.length < nodes) this.nodes.push(this.makeNode());
    for (const v of this.nodes) {
      v.x %= width;
      v.y %= height;
    }
    if (first) {
      for (let i = 0; i < this.target; i++) this.turtles.push(this.makeTurtle(true));
      this.nextSpawn = 3 + this.rng() * 4;
      this.nextMeteor = 4 + this.rng() * 6;
    }
  }

  setPointer(x: number, y: number, active: boolean): void {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.active = active;
  }

  /** A click or tap: a burst of sparks, and nearby turtles dart away. */
  poke(x: number, y: number): void {
    const rng = this.rng;
    const count = 20 + Math.floor(rng() * 10);
    for (let i = 0; i < count && this.sparks.length < 160; i++) {
      const a = rng() * TAU;
      const v = 70 + rng() * 170;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        age: 0,
        life: 0.8 + rng() * 0.9,
        glyph: SPARK[Math.floor(rng() * SPARK.length)],
        ink: ACCENTS[Math.floor(rng() * ACCENTS.length)],
        drag: 2.2,
      });
    }
    for (const t of this.turtles) {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < 340) {
        t.boost = Math.max(t.boost, 1.3 * (1 - d / 340));
        t.heading += clamp(wrapAngle(Math.atan2(t.y - y, t.x - x) - t.heading), -0.6, 0.6) * (1 - d / 340);
      }
    }
  }

  step(dt: number): void {
    dt = clamp(dt, 0, 0.1);
    this.time += dt;
    const W = this.width;
    const H = this.height;
    const rng = this.rng;

    for (let i = this.turtles.length - 1; i >= 0; i--) {
      const t = this.turtles[i];
      t.age += dt;
      t.phase += (dt * TAU) / t.period;
      let turn = t.a1 * Math.sin(this.time * t.w1 + t.p1) + t.a2 * Math.sin(this.time * t.w2 + t.p2);
      if (!t.entered) {
        // Head into view first.
        turn += clamp(wrapAngle(Math.atan2(H / 2 - t.y, W / 2 - t.x) - t.heading), -1, 1) * 0.35;
      }
      if (this.pointer.active) {
        const zone = 230 * Math.max(0.7, t.scale);
        const d = Math.hypot(t.x - this.pointer.x, t.y - this.pointer.y);
        if (d < zone) {
          const away = Math.atan2(t.y - this.pointer.y, t.x - this.pointer.x);
          turn += clamp(wrapAngle(away - t.heading), -1, 1) * 1.6 * (1 - d / zone);
          t.boost = Math.max(t.boost, 0.9 * (1 - d / zone));
        }
      }
      t.heading = wrapAngle(t.heading + turn * dt);
      // Power stroke while the front flippers sweep back.
      const surge = 1 + 0.35 * Math.max(0, Math.cos(t.phase));
      const v = t.speed * surge * (1 + t.boost);
      const cos = Math.cos(t.heading);
      const sin = Math.sin(t.heading);
      t.x += cos * v * dt;
      t.y += sin * v * dt;
      t.boost *= Math.exp(-dt / 1.2);

      // Stardust shed from behind the shell.
      t.dust -= dt * (1 + t.boost);
      if (t.dust <= 0 && this.dust.length < 180) {
        t.dust = 0.12 + rng() * 0.18;
        const u = this.unit * t.scale;
        const side = (rng() - 0.5) * 0.7 * u;
        this.dust.push({
          x: t.x - cos * 1.05 * u - sin * side,
          y: t.y - sin * 1.05 * u + cos * side,
          vx: -cos * 10 + (rng() - 0.5) * 12,
          vy: -sin * 10 + (rng() - 0.5) * 12,
          age: 0,
          life: 1.4 + rng() * 1.4,
          glyph: DUST[Math.floor(rng() * DUST.length)],
          ink: ACCENTS[Math.floor(rng() * ACCENTS.length)],
          drag: 0.6,
        });
      }

      const margin = 2.2 * this.unit * t.scale;
      const inside = t.x > 0 && t.x < W && t.y > 0 && t.y < H;
      if (inside) t.entered = true;
      const gone = t.x < -margin || t.x > W + margin || t.y < -margin || t.y > H + margin;
      if ((t.entered && gone) || (!t.entered && t.age > 40)) this.turtles.splice(i, 1);
    }
    if (this.turtles.length < this.target && this.time >= this.nextSpawn) {
      this.turtles.push(this.makeTurtle(false));
      this.nextSpawn = this.time + 2 + rng() * 5;
    }

    // Stars drift very slowly, as if the view were moving; constellation stars wander on their own.
    for (const s of this.stars) {
      s.x -= 3 * dt;
      if (s.x < 0) s.x += W;
    }
    for (const v of this.nodes) {
      v.x += v.vx * dt;
      v.y += v.vy * dt;
      if (v.x < -10) v.x = W + 10;
      else if (v.x > W + 10) v.x = -10;
      if (v.y < -10) v.y = H + 10;
      else if (v.y > H + 10) v.y = -10;
    }
    if (this.time >= this.nextPulse && this.nodes.length) {
      this.nextPulse = this.time + 2.4;
      const v = this.nodes[Math.floor(rng() * this.nodes.length)];
      this.pulses.push({ x: this.snap(v.x), y: this.snap(v.y), age: 0, hue: v.hue });
    }
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      this.pulses[i].age += dt;
      if (this.pulses[i].age > 1.5) this.pulses.splice(i, 1);
    }
    for (const list of [this.dust, this.sparks]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        m.age += dt;
        const k = Math.exp(-m.drag * dt);
        m.vx *= k;
        m.vy *= k;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        if (m.age > m.life) list.splice(i, 1);
      }
    }

    if (this.time >= this.nextMeteor) {
      this.nextMeteor = this.time + 7 + rng() * 9;
      const right = rng() < 0.5;
      const a = (right ? 0.35 : Math.PI - 0.35) + (rng() - 0.5) * 0.5;
      const v = 520 + rng() * 300;
      this.meteors.push({
        x: right ? rng() * W * 0.6 : W * (0.4 + rng() * 0.6),
        y: -10 + rng() * H * 0.3,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        length: 9 + Math.floor(rng() * 7),
      });
    }
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const tail = m.length * this.cell;
      if (m.x < -tail || m.x > W + tail || m.y > H + tail) this.meteors.splice(i, 1);
    }
  }

  /** Fill the grid for the current state. */
  render(pal: SpacePalette, opacity: number): void {
    this.rgba.fill(0);
    this.glyph.fill(0);
    this.inkA.fill(0);

    for (const s of this.stars) {
      const tw = 0.5 + 0.5 * Math.sin(this.time * s.rate + s.phase);
      this.put(s.x, s.y, s.glyph, s.ink, s.alpha * (0.35 + 0.65 * tw), 0.45, false);
    }
    // Constellation: stars as glyphs on faintly lit cells, lines between neighbours and to the pointer.
    this.linkCount = 0;
    const nodes = this.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const ax = this.snap(a.x);
      const ay = this.snap(a.y);
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < LINK_DIST) this.link(ax, ay, this.snap(b.x), this.snap(b.y), 1 - d / LINK_DIST, (a.hue + b.hue) / 2);
      }
      if (this.pointer.active) {
        const d = Math.hypot(a.x - this.pointer.x, a.y - this.pointer.y);
        if (d < POINTER_DIST) this.link(ax, ay, this.pointer.x, this.pointer.y, Math.min(1, 2.2 * (1 - d / POINTER_DIST)), a.hue);
      }
      const c = Math.floor(a.x / this.cell);
      const r = Math.floor(a.y / this.cell);
      if (c >= 0 && r >= 0 && c < this.cols && r < this.rows) {
        const k = (r * this.cols + c) * 4;
        this.rgba[k] = pal.nodeTile[0];
        this.rgba[k + 1] = pal.nodeTile[1];
        this.rgba[k + 2] = pal.nodeTile[2];
        this.rgba[k + 3] = 255 * 0.14 * Math.max(this.mask[c], 0.5);
      }
      this.put(a.x, a.y, a.glyph, a.hue < 0.5 ? INK.accentA : INK.accentB, 0.9, 0.5, true);
    }
    for (const m of this.meteors) {
      const v = Math.hypot(m.vx, m.vy);
      const ux = m.vx / v;
      const uy = m.vy / v;
      const line = lineGlyphAt(ux, uy);
      for (let k = m.length; k >= 1; k--) {
        const f = 1 - k / (m.length + 1);
        this.put(m.x - ux * k * this.cell * 0.9, m.y - uy * k * this.cell * 0.9, line, INK.light, f * f * 0.9, 0.6, false);
      }
      this.put(m.x, m.y, HEAD_STAR, INK.light, 1, 0.6, false);
    }
    for (const m of this.dust) {
      const f = 1 - m.age / m.life;
      this.put(m.x, m.y, m.glyph, m.ink, f * 0.85, 0.4, false);
    }

    // Far turtles first, so nearer ones cover them.
    const order = this.turtles.slice().sort((a, b) => a.scale - b.scale);
    for (const t of order) this.renderTurtle(t, pal, opacity);

    for (const m of this.sparks) {
      const f = 1 - m.age / m.life;
      this.put(m.x, m.y, m.glyph, m.ink, Math.pow(f, 0.8), 0.85, true);
    }
  }

  /** Centre of the cell containing a coordinate, so lines meet the glyphs they connect. */
  private snap(v: number): number {
    return (Math.floor(v / this.cell) + 0.5) * this.cell;
  }

  private link(x1: number, y1: number, x2: number, y2: number, strength: number, hue: number): void {
    if (this.linkCount >= MAX_LINKS) return;
    const k = this.linkCount++ * 6;
    this.links[k] = x1;
    this.links[k + 1] = y1;
    this.links[k + 2] = x2;
    this.links[k + 3] = y2;
    this.links[k + 4] = strength;
    this.links[k + 5] = hue;
  }

  /** Put a lone glyph in the cell at (x, y); unless `over`, only where no turtle is drawn. */
  private put(x: number, y: number, glyph: number, ink: number, alpha: number, minMask: number, over: boolean): void {
    const c = Math.floor(x / this.cell);
    const r = Math.floor(y / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return;
    const i = r * this.cols + c;
    if (!over && this.rgba[i * 4 + 3] > 40) return;
    this.glyph[i] = glyph;
    this.ink[i] = ink;
    this.inkA[i] = 255 * clamp(alpha, 0, 1) * Math.max(this.mask[c], minMask);
  }

  private renderTurtle(t: Turtle, pal: SpacePalette, opacity: number): void {
    const { cols, rows, cell, rgba, glyph, ink, inkA, mask } = this;
    const p = this.pose;
    const u = this.unit * t.scale;
    p.cos = Math.cos(t.heading);
    p.sin = Math.sin(t.heading);
    const front = ((100 + 42 * Math.sin(t.phase)) * Math.PI) / 180;
    p.fc = Math.cos(front);
    p.fs = Math.sin(front);
    p.fw = 0.82 + 0.18 * Math.cos(t.phase);
    const rear = ((148 + 10 * Math.sin(t.phase + 1.2)) * Math.PI) / 180;
    p.rc = Math.cos(rear);
    p.rs = Math.sin(rear);
    p.sway = 0.03 * Math.sin(t.phase + 0.6);
    p.depth = clamp((t.scale - 0.6) / 0.5, 0, 1);
    const alphaDepth = 0.6 + 0.4 * p.depth;

    const reach = 2.15 * u;
    const c0 = Math.max(0, Math.floor((t.x - reach) / cell));
    const c1 = Math.min(cols - 1, Math.floor((t.x + reach) / cell));
    const r0 = Math.max(0, Math.floor((t.y - reach) / cell));
    const r1 = Math.min(rows - 1, Math.floor((t.y + reach) / cell));
    if (c0 > c1 || r0 > r1) return;
    const out = this.color;
    const inv = 1 / u;

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cx = (c + 0.5) * cell - t.x;
        const cy = (r + 0.5) * cell - t.y;
        // Coverage from 2×2 samples; colour from the centre (or the first covered sample).
        let hits = 0;
        let sx = 0;
        let sy = 0;
        let part = 0;
        for (const ox of OFFSETS) {
          for (const oy of OFFSETS) {
            const dx = cx + ox * cell;
            const dy = cy + oy * cell;
            const lx = (dx * p.cos + dy * p.sin) * inv;
            const ly = (-dx * p.sin + dy * p.cos) * inv;
            const k = partAt(p, lx, ly);
            if (k) {
              hits++;
              if (!part) {
                part = k;
                sx = lx;
                sy = ly;
              }
            }
          }
        }
        if (!hits) continue;
        const lxc = (cx * p.cos + cy * p.sin) * inv;
        const lyc = (-cx * p.sin + cy * p.cos) * inv;
        const centre = partAt(p, lxc, lyc);
        if (centre) {
          part = centre;
          sx = lxc;
          sy = lyc;
        } else {
          partAt(p, sx, sy); // restore the flipper scratch values for this sample
        }
        shade(t, p, part, sx, sy, pal, out);

        const cov = hits / 4;
        const i = r * cols + c;
        const fade = alphaDepth * mask[c];
        // Behind the text column glyphs fade faster than tiles, leaving a soft silhouette.
        const inkFade = fade * mask[c];
        const a = cov * opacity * fade * tileK;
        if (cov < 0.5 && rgba[i * 4 + 3] > a * 255) continue; // keep a nearer, fuller tile
        rgba[i * 4] = out[0];
        rgba[i * 4 + 1] = out[1];
        rgba[i * 4 + 2] = out[2];
        rgba[i * 4 + 3] = a * 255;
        const lum = (0.299 * out[0] + 0.587 * out[1] + 0.114 * out[2]) / 255;
        if (hintGlyph) {
          glyph[i] = hintGlyph;
          ink[i] = hintInk;
          inkA[i] = 255 * hintAlpha * opacity * inkFade * (cov >= 0.5 ? 1 : 0.6);
        } else if (cov >= 0.5) {
          const band = BANDS[lum < 0.22 ? 0 : lum < 0.38 ? 1 : lum < 0.55 ? 2 : lum < 0.72 ? 3 : 4];
          glyph[i] = band[Math.floor(hash(c, r) * band.length)];
          // A few glyphs carry an accent colour; they travel with the turtle.
          const spot = hash(Math.floor(sx * 5), Math.floor(sy * 5), (t.seed * 997) | 0);
          ink[i] = spot < 0.035 ? INK.accentA + Math.floor(spot * 85.7) : lum < 0.5 ? INK.light : INK.dark;
          inkA[i] = 255 * (0.55 + 0.45 * cov) * opacity * inkFade;
        } else {
          glyph[i] = EDGE[Math.floor(hash(c, r, 3) * EDGE.length)];
          ink[i] = INK.dim;
          inkA[i] = 255 * 0.7 * opacity * inkFade;
        }
      }
    }

    // Loose punctuation around the outline.
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * cols + c;
        if (rgba[i * 4 + 3] || glyph[i]) continue;
        const near =
          (c > 0 && rgba[(i - 1) * 4 + 3] > 0) ||
          (c < cols - 1 && rgba[(i + 1) * 4 + 3] > 0) ||
          (r > 0 && rgba[(i - cols) * 4 + 3] > 0) ||
          (r < rows - 1 && rgba[(i + cols) * 4 + 3] > 0);
        if (!near || hash(c, r, 99) > 0.45) continue;
        glyph[i] = HALO[Math.floor(hash(c, r, 5) * HALO.length)];
        ink[i] = INK.dim;
        inkA[i] = 255 * 0.5 * opacity * alphaDepth * mask[c] * mask[c];
      }
    }
  }

  private makeTurtle(inView: boolean): Turtle {
    const rng = this.rng;
    const W = this.width;
    const H = this.height;
    const scale = 0.6 + rng() * 0.5;
    let x: number;
    let y: number;
    let heading: number;
    if (inView) {
      x = W * (0.12 + 0.76 * rng());
      y = H * (0.15 + 0.7 * rng());
      heading = rng() * TAU;
    } else {
      // Enter from an edge, aiming somewhere across the middle.
      const m = 2.1 * this.unit * scale;
      const edge = rng() * (2 * W + 2 * H);
      if (edge < W) [x, y] = [edge, -m];
      else if (edge < 2 * W) [x, y] = [edge - W, H + m];
      else if (edge < 2 * W + H) [x, y] = [-m, edge - 2 * W];
      else [x, y] = [W + m, edge - 2 * W - H];
      heading = Math.atan2(H * (0.25 + 0.5 * rng()) - y, W * (0.25 + 0.5 * rng()) - x);
    }
    return {
      x,
      y,
      heading,
      speed: (34 + rng() * 18) * scale,
      scale,
      phase: rng() * TAU,
      period: 2.4 + rng() * 0.9,
      boost: 0,
      a1: (0.05 + rng() * 0.07) * (rng() < 0.5 ? -1 : 1),
      w1: 0.15 + rng() * 0.15,
      p1: rng() * TAU,
      a2: 0.03 + rng() * 0.04,
      w2: 0.5 + rng() * 0.4,
      p2: rng() * TAU,
      entered: inView,
      age: 0,
      seed: rng(),
      dust: rng() * 0.3,
    };
  }

  private makeNode(): Node {
    const rng = this.rng;
    const speed = 4 + rng() * 7;
    const angle = rng() * TAU;
    return {
      x: rng() * Math.max(1, this.width),
      y: rng() * Math.max(1, this.height),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      hue: rng(),
      glyph: NODE[rng() < 0.35 ? 0 : 1],
    };
  }

  private makeStar(): Star {
    const rng = this.rng;
    const m = rng();
    // Mostly faint dots; a few brighter stars, some in an accent colour.
    const glyph = STAR[m < 0.55 ? 0 : m < 0.8 ? 1 : m < 0.9 ? 2 : m < 0.97 ? 3 : 4];
    return {
      x: rng() * Math.max(1, this.width),
      y: rng() * Math.max(1, this.height),
      glyph,
      ink: rng() < 0.12 ? ACCENTS[Math.floor(rng() * 3)] : INK.dim,
      alpha: 0.35 + rng() * 0.5,
      phase: rng() * TAU,
      rate: 0.5 + rng() * 1.8,
    };
  }
}
