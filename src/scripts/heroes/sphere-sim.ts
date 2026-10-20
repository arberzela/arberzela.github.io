// Toy dynamics for the SFPRM hero illustration: the spherical fixed-point loop on S².
// Pure math, no DOM, so it can be checked in Node.
//
// Each token t has an input x_t. One iteration of the loop is
//   ẑ = Slerp_λ(z, x)          inject: move a fraction λ of the arc toward the input
//   z̃ = f_t(ẑ)                 block: a fixed toy map with a spiralling fixed point
//   halt if max_t ∠(z, z̃) < τ  halting test on angles
//   z ← Slerp_η(z, z̃)          damp: rotate a fraction η of the way to the proposal
// The toy block rotates states around a per-token centre c_t by an angle φ and stretches their
// geodesic distance to it by a gain that saturates far away. Near the fixed point the raw map is
// then a growing spiral (|ζ| > 1), the oscillating kind of mode that angular damping tames: the
// damped map (1-η)·Id + η·J has every eigenvalue inside the unit disk once η < η_max.

export type Vec = [number, number, number];

export const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const norm = (a: Vec): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec): Vec => scale(a, 1 / (norm(a) || 1));
export const angle = (a: Vec, b: Vec): number => Math.atan2(norm(cross(a, b)), dot(a, b));

export function slerp(a: Vec, b: Vec, t: number): Vec {
  const om = angle(a, b);
  if (om < 1e-7) return a;
  const s = Math.sin(om);
  return normalize(add(scale(a, Math.sin((1 - t) * om) / s), scale(b, Math.sin(t * om) / s)));
}

/** Tangent vector at c pointing to w, with length equal to the geodesic distance. */
export function logMap(c: Vec, w: Vec): Vec {
  const th = angle(c, w);
  if (th < 1e-9) return [0, 0, 0];
  const u = sub(w, scale(c, dot(c, w)));
  const n = norm(u);
  return n < 1e-12 ? [0, 0, 0] : scale(u, th / n);
}

export function expMap(c: Vec, v: Vec): Vec {
  const th = norm(v);
  if (th < 1e-9) return c;
  return normalize(add(scale(c, Math.cos(th)), scale(v, Math.sin(th) / th)));
}

/** Rotate a tangent vector v at c by angle phi around the axis c. */
export const rotateTangent = (c: Vec, v: Vec, phi: number): Vec => add(scale(v, Math.cos(phi)), scale(cross(c, v), Math.sin(phi)));

/** An orthonormal basis (u, v) of the tangent plane at p. */
export function tangentBasis(p: Vec): [Vec, Vec] {
  const ref: Vec = Math.abs(p[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(p, ref));
  return [u, cross(p, u)];
}

export interface Token {
  x: Vec; // input token
  c: Vec; // centre of the toy block
  phi: number; // swirl per application of the block (radians, signed)
  gain: number; // radial gain near the centre
  thetaS: number; // saturation radius of the gain (radians)
}

export function block(tok: Token, w: Vec): Vec {
  const v = logMap(tok.c, w);
  const th = norm(v);
  const g = tok.gain / Math.sqrt(1 + (th / tok.thetaS) ** 2);
  return expMap(tok.c, rotateTangent(tok.c, scale(v, g), tok.phi));
}

export const inject = (tok: Token, z: Vec, lambda: number): Vec => slerp(z, tok.x, lambda);
export const propose = (tok: Token, z: Vec, lambda: number): Vec => block(tok, inject(tok, z, lambda));

export interface LoopParams {
  lambda: number;
  eta: number; // initial step size (the fixed one when not adaptive)
  adaptive: boolean; // multiply η by `decay` when the residual has not improved for `patience` iterations
  decay: number;
  patience: number;
  maxIter: number;
  tau: number; // halting threshold on the angle, radians
}

export interface LoopRun {
  /** states[i][k]: state of token k after i damping updates, i = 0..n. */
  states: Vec[][];
  /** residuals[i][k] = ∠(z_i, F(z_i)); maxRes[i] = max over tokens. */
  residuals: number[][];
  maxRes: number[];
  /** eta[i]: step size used for the update i → i+1 (the last entry repeats the final value). */
  eta: number[];
  /** Iterations at which η was decayed (the update from that iteration on uses the smaller η). */
  decays: number[];
  halted: boolean;
  n: number;
}

export function runLoop(tokens: Token[], p: LoopParams): LoopRun {
  let z: Vec[] = tokens.map((t) => t.x);
  let eta = p.eta;
  let best = Infinity;
  let stall = 0;
  const states: Vec[][] = [];
  const residuals: number[][] = [];
  const maxRes: number[] = [];
  const etas: number[] = [];
  const decays: number[] = [];
  for (let i = 0; ; i++) {
    const props = tokens.map((tok, k) => propose(tok, z[k], p.lambda));
    const res = tokens.map((_, k) => angle(z[k], props[k]));
    const m = Math.max(...res);
    states.push(z);
    residuals.push(res);
    maxRes.push(m);
    if (m < p.tau) return { states, residuals, maxRes, eta: [...etas, eta], decays, halted: true, n: i };
    if (i === p.maxIter) return { states, residuals, maxRes, eta: [...etas, eta], decays, halted: false, n: i };
    if (p.adaptive) {
      if (m < best - 1e-9) {
        best = m;
        stall = 0;
      } else if (++stall >= p.patience) {
        eta *= p.decay;
        stall = 0;
        decays.push(i);
      }
    }
    etas.push(eta);
    const e = eta;
    z = z.map((zk, k) => slerp(zk, props[k], e));
  }
}

/** Fixed point of the raw map, found with heavy damping. */
export function fixedPoint(tok: Token, lambda: number, eta = 0.15, iters = 6000): Vec {
  let z = tok.x;
  for (let i = 0; i < iters; i++) z = slerp(z, propose(tok, z, lambda), eta);
  return z;
}

/** Eigenvalues of the tangent Jacobian of the raw map at p (2×2, by finite differences). */
export function jacobianEig(tok: Token, p: Vec, lambda: number): { re: number; im: number }[] {
  const [u, v] = tangentBasis(p);
  const h = 1e-5;
  const F = (q: Vec) => logMap(p, propose(tok, q, lambda));
  const f0 = F(p);
  const du = scale(sub(F(expMap(p, scale(u, h))), f0), 1 / h);
  const dv = scale(sub(F(expMap(p, scale(v, h))), f0), 1 / h);
  const a = dot(du, u), c = dot(du, v), b = dot(dv, u), d = dot(dv, v);
  const tr = a + d, det = a * d - b * c, disc = tr * tr / 4 - det;
  if (disc >= 0) return [{ re: tr / 2 + Math.sqrt(disc), im: 0 }, { re: tr / 2 - Math.sqrt(disc), im: 0 }];
  return [{ re: tr / 2, im: Math.sqrt(-disc) }, { re: tr / 2, im: -Math.sqrt(-disc) }];
}

/** Largest fixed step size for which angular damping converges locally (the paper's η_max). */
export function etaMax(eigs: { re: number; im: number }[]): number {
  return Math.min(...eigs.map((z) => (2 * (1 - z.re)) / ((z.re - 1) ** 2 + z.im ** 2)));
}

// --- Smooth paths through the iterates ------------------------------------------------------------
// Centripetal Catmull–Rom in R³, projected back onto the sphere: C¹ in its knot parameter, passes
// through every iterate, and does not overshoot into loops or cusps the way the uniform variant can.
// Playback reaches iterate i at loop time u = i exactly; a monotone cubic map from u to the knot
// parameter keeps the velocity continuous through the iterates and starts and ends at rest.

function crPoint(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const k = (a: Vec, b: Vec) => Math.max(1e-6, Math.sqrt(norm(sub(b, a))));
  const t0 = 0, t1 = t0 + k(p0, p1), t2 = t1 + k(p1, p2), t3 = t2 + k(p2, p3);
  const T = t1 + (t2 - t1) * t;
  const lerp = (a: Vec, b: Vec, ta: number, tb: number): Vec => add(scale(a, (tb - T) / (tb - ta)), scale(b, (T - ta) / (tb - ta)));
  const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
  return normalize(lerp(b1, b2, t1, t2));
}

export interface PathTiming {
  /** Knot interval of each segment (square root of the chord length). */
  delta: number[];
  /** Knot speed dT/du at each iterate (0 at both ends). */
  m: number[];
}

export function pathTiming(pts: Vec[]): PathTiming {
  const n = pts.length - 1;
  const delta: number[] = [];
  for (let i = 0; i < n; i++) delta.push(Math.max(1e-6, Math.sqrt(norm(sub(pts[i + 1], pts[i])))));
  const m: number[] = [0];
  for (let i = 1; i < n; i++) {
    const avg = (delta[i - 1] + delta[i]) / 2;
    m.push(Math.min(avg, 3 * Math.min(delta[i - 1], delta[i]))); // Fritsch–Carlson: stays monotone
  }
  if (n > 0) m.push(0);
  return { delta, m };
}

/** Point on the smooth path at loop time u ∈ [0, n], passing iterate i at u = i with continuous velocity. */
export function pathAt(pts: Vec[], timing: PathTiming, u: number): Vec {
  const n = pts.length - 1;
  if (n <= 0 || u <= 0) return pts[0];
  if (u >= n) return pts[n];
  const i = Math.floor(u);
  const f = u - i;
  const d = timing.delta[i];
  const h10 = f * f * f - 2 * f * f + f;
  const h01 = -2 * f * f * f + 3 * f * f;
  const h11 = f * f * f - f * f;
  const T = h10 * timing.m[i] + h01 * d + h11 * timing.m[i + 1];
  return pathPoint(pts, i + Math.min(1, Math.max(0, T / d)));
}

/** Samples of the smooth path at loop times u = j / sub (last sample = last iterate). */
export function samplePathTimed(pts: Vec[], timing: PathTiming, sub: number): Vec[] {
  const n = pts.length - 1;
  const out: Vec[] = [];
  for (let j = 0; j < n * sub; j++) out.push(pathAt(pts, timing, j / sub));
  out.push(pts[n]);
  return out;
}

/** Point on the smooth path through pts at knot-uniform parameter s ∈ [0, pts.length - 1]. */
export function pathPoint(pts: Vec[], s: number): Vec {
  const n = pts.length - 1;
  if (n <= 0) return pts[0];
  const i = Math.min(n - 1, Math.max(0, Math.floor(s)));
  const t = Math.min(1, Math.max(0, s - i));
  const p1 = pts[i], p2 = pts[i + 1];
  if (angle(p1, p2) < 1e-6) return p1;
  const p0 = i > 0 ? pts[i - 1] : normalize(sub(scale(p1, 2), p2));
  const p3 = i + 2 <= n ? pts[i + 2] : normalize(sub(scale(p2, 2), p1));
  return crPoint(p0, p1, p2, p3, t);
}

/** Dense samples of the smooth path, `sub` per segment (last sample = last iterate). */
export function samplePath(pts: Vec[], sub: number): Vec[] {
  const n = pts.length - 1;
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < sub; j++) out.push(pathPoint(pts, i + j / sub));
  out.push(pts[n]);
  return out;
}

// --- Random tokens ---------------------------------------------------------------------------------
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TokenOptions {
  gain: [number, number];
  thetaS: number;
  phiDeg: [number, number];
  offsetDeg: [number, number]; // angle between input and block centre
  latDeg: [number, number]; // latitude band for the inputs
}

export const DEFAULT_TOKENS: TokenOptions = {
  gain: [1.9, 2.3],
  thetaS: 0.45,
  phiDeg: [80, 104],
  offsetDeg: [45, 70],
  latDeg: [-45, 50],
};

export function makeTokens(n: number, rng: () => number, o: TokenOptions = DEFAULT_TOKENS): Token[] {
  const deg = Math.PI / 180;
  const lon0 = rng() * Math.PI * 2;
  const tokens: Token[] = [];
  for (let i = 0; i < n; i++) {
    // Inputs spread around the sphere (golden-angle longitudes, jittered latitudes).
    const lon = lon0 + i * 2.39996 + (rng() - 0.5) * 0.4;
    const lat = (o.latDeg[0] + ((i + rng() * 0.8) / n) * (o.latDeg[1] - o.latDeg[0])) * deg;
    const x: Vec = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
    // Block centre at a random direction and distance from the input.
    const r: Vec = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
    const dir = normalize(sub(r, scale(x, dot(r, x))));
    const off = (o.offsetDeg[0] + rng() * (o.offsetDeg[1] - o.offsetDeg[0])) * deg;
    const c = expMap(x, scale(dir, off));
    const phi = (o.phiDeg[0] + rng() * (o.phiDeg[1] - o.phiDeg[0])) * deg * (rng() < 0.5 ? -1 : 1);
    const gain = o.gain[0] + rng() * (o.gain[1] - o.gain[0]);
    tokens.push({ x, c, phi, gain, thetaS: o.thetaS });
  }
  return tokens;
}

export const TAU_C = 0.01;
export const TAU_ANG = Math.acos(1 - TAU_C); // ≈ 8.1°
