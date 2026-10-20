// Toy neural tissue for the site background (simulation only, no DOM; drawn by ../background.ts).
//
// Neurons are leaky integrate-and-fire cells with branching dendrites. Their axons form synapses
// on the dendrites of nearby cells, and spikes travel along those synapses. The wiring keeps
// changing:
//  · Plasticity (STDP): a synapse whose spike arrives shortly before its target fires is
//    strengthened; one whose spike arrives right after the target fired is weakened. Every
//    weight also decays slowly, so synapses that stop carrying useful spikes fade and are pruned.
//  · Synaptogenesis: new axons sprout towards nearby cells and grow until they reach a dendrite.
//  · Homeostasis: each spike raises a neuron's threshold, which then relaxes back; each neuron
//    slowly tunes its excitability towards a target firing rate; and synaptic scaling shrinks all
//    inputs of a neuron whose summed input weight exceeds a cap. Together they keep Hebbian
//    feedback from running away into seizure-like activity.
//  · Neurogenesis: every few seconds a neuron is born, grows its dendrites, is hyperexcitable
//    while it matures (as adult-born neurons are) and wires itself in. While there are more
//    neurons than the viewport wants, the least integrated mature one dies and its synapses
//    retract.
// Times are milliseconds of simulation time; lengths are CSS pixels.

export type Rng = () => number;

export interface Point {
  x: number;
  y: number;
}

/** One straight piece of a dendrite, as an offset from the soma. */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Stroke width; dendrites taper towards their tips. */
  w: number;
  /** Path distance from the soma at the start and end of the segment (drives growth). */
  d1: number;
  d2: number;
}

export type NeuronState = 'growing' | 'mature' | 'dying';

export interface Neuron {
  id: number;
  x: number;
  y: number;
  /** Soma radius. */
  r: number;
  segs: Segment[];
  /** Dendrite tips (offsets), where incoming axons land. */
  tips: Point[];
  /** Longest path distance from the soma to a tip. */
  reach: number;
  /** Colour position between the two accent colours (0..1). */
  hue: number;
  /** Membrane potential and firing threshold (raised by each spike, relaxing back to `base`). */
  v: number;
  theta: number;
  /** Resting threshold, tuned so the cell fires at about the target rate. */
  base: number;
  /** Running estimate of the firing rate (spikes per ms). */
  rate: number;
  lastSpike: number;
  /** Visual activation after a spike, 1 → 0. */
  glow: number;
  state: NeuronState;
  born: number;
  growStart: number;
  growDur: number;
  matureAt: number;
  /** Adult-born and not yet mature: tinted, hyperexcitable, preferred by new synapses. */
  newborn: boolean;
  wired: boolean;
  /** Fraction of the dendritic arbor that has grown (or is left while dying). */
  growth: number;
  /** 1 → 0 while dying. */
  fade: number;
  nIn: number;
  nOut: number;
  /** Summed weight of the incoming synapses (scratch value for synaptic scaling). */
  sumIn: number;
}

export type SynapseState = 'growing' | 'active' | 'pruning';

export interface Synapse {
  pre: Neuron;
  post: Neuron;
  /** Quadratic Bézier from the axon hillock (x0, y0) via (cx, cy) to the dendrite (x2, y2). */
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  x2: number;
  y2: number;
  len: number;
  /** Synaptic weight (0..1). */
  w: number;
  state: SynapseState;
  /** How far the axon has grown along the curve (0..1). */
  growth: number;
  /** Delay before the axon starts growing (intro only). */
  wait: number;
  lastArrival: number;
  /** Highlight after a potentiation, 1 → 0. */
  flash: number;
}

export interface Spike {
  syn: Synapse;
  /** Position along the synapse (0..1). */
  t: number;
}

export interface Birth {
  x: number;
  y: number;
  at: number;
}

export const PARAMS = {
  areaPerNeuron: 23000, // px² of viewport per neuron
  minNeurons: 12,
  maxNeurons: 72,
  margin: 24, // keep somata this far from the viewport edges
  // Membrane
  tauV: 420,
  refractory: 520,
  theta0: 1,
  thetaStep: 0.2,
  tauTheta: 7000,
  targetRate: 1 / 8000, // spikes per ms that firing-rate homeostasis aims for
  tauRate: 20000,
  rateGain: 0.14, // how fast the resting threshold follows the rate error
  baseRange: [0.6, 3],
  spontaneous: 1 / 14000, // spontaneous spikes per ms and neuron
  gain: 2.6, // depolarisation delivered through a synapse of weight 1
  conduction: 0.2, // px per ms
  maxSpikes: 90,
  // Synaptic plasticity
  ltpWindow: 250,
  ltp: 0.16,
  ltdWindow: 110,
  ltd: 0.1,
  decay: 0.0018 / 1000, // weight lost per ms
  pruneBelow: 0.07,
  scaleMax: 1, // cap on the summed input weight of a neuron (synaptic scaling)
  scaleTau: 2000, // ms to remove most of an excess
  // Structural plasticity
  sproutEvery: [900, 1800],
  newWeight: 0.3,
  axonSpeed: 0.16, // px per ms
  retractRate: 1 / 650, // growth fraction per ms
  synapsesPerNeuron: 2.8,
  maxOut: 4,
  maxIn: 5,
  // Neurogenesis and apoptosis
  birthEvery: [6500, 11000],
  growDur: 3200,
  matureAfter: 11000,
  immatureTheta: 0.72,
  immatureSpont: 2.2,
  dieDur: 2600,
  minAgeToDie: 25000,
  // Visual decay
  glowTau: 380,
  flashTau: 650,
};

const P = PARAMS;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const range = (rng: Rng, [lo, hi]: number[]) => lo + rng() * (hi - lo);

/** Point at parameter t on a synapse's curve. */
export function synapsePoint(s: Synapse, t: number, out: Point): Point {
  const u = 1 - t;
  out.x = u * u * s.x0 + 2 * u * t * s.cx + t * t * s.x2;
  out.y = u * u * s.y0 + 2 * u * t * s.cy + t * t * s.y2;
  return out;
}

// --- Morphology ---------------------------------------------------------------------------------

interface Arbor {
  segs: Segment[];
  tips: Point[];
  reach: number;
}

/** A tortuous dendrite that tapers, may give off oblique side branches and ends in a fork or a tip. */
function branch(
  arbor: Arbor,
  rng: Rng,
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
  depth: number,
  dist: number,
  obliques = 0,
): void {
  const steps = Math.max(2, Math.round(length / 6));
  const step = length / steps;
  const sides = new Set<number>();
  for (let k = 0; k < obliques; k++) sides.add(1 + Math.floor(rng() * Math.max(1, steps - 2)));
  let a = angle;
  let px = x;
  let py = y;
  let d = dist;
  let w = width;
  for (let i = 0; i < steps; i++) {
    a += (rng() - 0.5) * 0.42;
    const nx = px + Math.cos(a) * step;
    const ny = py + Math.sin(a) * step;
    w = Math.max(0.35, width * (1 - (0.5 * (i + 1)) / steps));
    arbor.segs.push({ x1: px, y1: py, x2: nx, y2: ny, w, d1: d, d2: d + step });
    px = nx;
    py = ny;
    d += step;
    if (sides.has(i)) {
      const side = rng() < 0.5 ? -1 : 1;
      branch(arbor, rng, px, py, a + side * (0.7 + rng() * 0.45), length * (0.22 + rng() * 0.14), w * 0.7, 1, d);
    }
  }
  if (depth > 0) {
    const spread = 0.32 + rng() * 0.38;
    for (const side of [-1, 1]) {
      branch(arbor, rng, px, py, a + side * spread * (0.8 + rng() * 0.4), length * (0.5 + rng() * 0.2), w, depth - 1, d);
    }
  } else {
    arbor.tips.push({ x: px, y: py });
  }
  arbor.reach = Math.max(arbor.reach, d);
}

/** A pyramidal cell (apical dendrite pointing up, short basal skirt) or a multipolar one. */
function growCell(rng: Rng): Arbor & { r: number } {
  const arbor: Arbor = { segs: [], tips: [], reach: 0 };
  if (rng() < 0.55) {
    const r = 3 + rng() * 1.1;
    branch(arbor, rng, 0, -r, -Math.PI / 2 + (rng() - 0.5) * 0.5, 40 + rng() * 24, 2, 1, 0, 2);
    const basal = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < basal; i++) {
      const a = Math.PI / 2 + ((i + 0.5) / basal - 0.5) * 2.6 + (rng() - 0.5) * 0.35;
      branch(arbor, rng, Math.cos(a) * r, Math.sin(a) * r, a, 16 + rng() * 14, 1.4, rng() < 0.4 ? 1 : 0, 0);
    }
    return { ...arbor, r };
  }
  const r = 2.3 + rng() * 1.1;
  const count = 4 + Math.floor(rng() * 3);
  const a0 = rng() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const a = a0 + (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.6;
    branch(arbor, rng, Math.cos(a) * r, Math.sin(a) * r, a, 18 + rng() * 18, 1.5, rng() < 0.5 ? 1 : 0, 0);
  }
  return { ...arbor, r };
}

// --- Tissue -------------------------------------------------------------------------------------

interface SproutOptions {
  pre?: Neuron;
  post?: Neuron;
  weight?: number;
  /** Delay before the axon starts to grow. */
  wait?: number;
  /** Create the synapse fully grown (static frame). */
  instant?: boolean;
  /** Ignore growth state (initial wiring). */
  seeding?: boolean;
}

export class Tissue {
  readonly neurons: Neuron[] = [];
  readonly synapses: Synapse[] = [];
  readonly spikes: Spike[] = [];
  /** Recent births, for the renderer's birth ripples. */
  readonly births: Birth[] = [];
  /** Simulation clock (ms). */
  time = 0;
  /** Bumped whenever the set of mature neurons changes, so the renderer can cache them. */
  version = 0;
  width = 0;
  height = 0;
  target = 0;
  readonly stats = { fired: 0, spikes: 0, ltp: 0, ltd: 0, sprouted: 0, pruned: 0, births: 0, deaths: 0 };

  private readonly rng: Rng;
  private nextId = 1;
  private reach = 180;
  private nextBirth = 0;
  private nextDeath = Infinity;
  private nextSprout = 0;

  constructor(rng: Rng = Math.random) {
    this.rng = rng;
  }

  /** Fit the tissue to the viewport. The first call seeds it, growing it in when `intro` is set. */
  resize(width: number, height: number, intro = false): void {
    this.width = width;
    this.height = height;
    this.target = Math.round(clamp((width * height) / P.areaPerNeuron, P.minNeurons, P.maxNeurons));
    this.reach = clamp(Math.sqrt((width * height) / this.target) * 1.5, 130, 280);
    if (!this.neurons.length) {
      this.seed(intro);
      return;
    }
    // Cells far outside the new viewport go at once; the rest of the adjustment happens through
    // neurogenesis (faster while below target) and apoptosis (outside cells first).
    for (let i = this.neurons.length - 1; i >= 0; i--) {
      const n = this.neurons[i];
      if (n.x > width + 140 || n.y > height + 140) this.removeNeuron(i);
    }
    this.version++;
  }

  /**
   * Depolarise the neurons around a point (pointer hover or click). The amount is in units of each
   * cell's resting threshold, so the response does not depend on how homeostasis has tuned it.
   */
  stimulate(x: number, y: number, radius: number, amount: number): void {
    for (const n of this.neurons) {
      if (n.state === 'dying' || n.growth < 0.5) continue;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < radius) n.v += amount * n.base * (1 - d / radius);
    }
  }

  step(dt: number): void {
    dt = clamp(dt, 0, 50);
    this.time += dt;
    const t = this.time;
    this.regulate();

    const leak = Math.exp(-dt / P.tauV);
    const relax = Math.exp(-dt / P.tauTheta);
    const forget = Math.exp(-dt / P.tauRate);
    const dim = Math.exp(-dt / P.glowTau);
    for (let i = this.neurons.length - 1; i >= 0; i--) {
      const n = this.neurons[i];
      n.glow *= dim;
      if (n.state === 'dying') {
        n.fade -= dt / P.dieDur;
        n.growth = Math.max(0, n.fade);
        if (n.fade <= 0) this.removeNeuron(i);
        continue;
      }
      if (n.state === 'growing') {
        n.growth = t < n.growStart ? 0 : easeOut((t - n.growStart) / n.growDur);
        if (n.newborn && !n.wired && n.growth >= 0.6) {
          // A new neuron sends out an axon and receives a couple of synapses straight away.
          n.wired = true;
          this.sprout({ pre: n });
          this.sprout({ post: n });
          this.sprout({ post: n });
        }
        if (t >= n.matureAt && n.growth >= 1) {
          n.state = 'mature';
          n.newborn = false;
          this.version++;
        }
      }
      // Firing-rate homeostasis, then relaxation of the spike-triggered threshold increase.
      n.rate *= forget;
      n.base = clamp(n.base + P.rateGain * (n.rate - P.targetRate) * dt, P.baseRange[0], P.baseRange[1]);
      const base = n.base * (n.newborn ? P.immatureTheta : 1);
      n.theta = base + (n.theta - base) * relax;
      if (n.growth < 0.5) {
        n.v = 0;
        continue;
      }
      n.v *= leak;
      if (this.rng() < P.spontaneous * (n.newborn ? P.immatureSpont : 1) * dt) n.v = Math.max(n.v, n.theta);
      if (n.v >= n.theta && t - n.lastSpike >= P.refractory) this.fire(n);
    }

    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const sp = this.spikes[i];
      const s = sp.syn;
      if (s.state !== 'active') {
        this.removeSpike(i);
        continue;
      }
      sp.t += (P.conduction * dt) / s.len;
      if (sp.t >= 1) {
        this.removeSpike(i);
        this.deliver(s);
      }
    }

    // Synaptic scaling: shrink every input of a neuron in proportion to its excess input weight.
    for (const n of this.neurons) n.sumIn = 0;
    for (const s of this.synapses) if (s.state !== 'pruning') s.post.sumIn += s.w;
    const scale = 1 - Math.exp(-dt / P.scaleTau);
    for (const s of this.synapses) {
      const sum = s.post.sumIn;
      if (s.state !== 'pruning' && sum > P.scaleMax) s.w -= s.w * (1 - P.scaleMax / sum) * scale;
    }

    const fadeFlash = Math.exp(-dt / P.flashTau);
    for (let j = this.synapses.length - 1; j >= 0; j--) {
      const s = this.synapses[j];
      s.flash *= fadeFlash;
      if (s.wait > 0) {
        s.wait -= dt;
        continue;
      }
      if (s.state === 'growing') {
        s.growth = Math.min(1, s.growth + (P.axonSpeed * dt) / s.len);
        if (s.growth >= 1) s.state = 'active';
      } else if (s.state === 'pruning') {
        s.growth -= P.retractRate * dt;
        if (s.growth <= 0) this.dropSynapse(j);
      } else {
        s.w -= P.decay * dt;
        if (s.w < P.pruneBelow) {
          s.state = 'pruning';
          this.stats.pruned++;
        }
      }
    }

    if (t >= this.nextSprout) {
      this.sprout();
      this.nextSprout = t + range(this.rng, P.sproutEvery);
    }
    while (this.births.length && t - this.births[0].at > 3000) this.births.shift();
  }

  // --- Activity ---------------------------------------------------------------------------------

  private fire(n: Neuron): void {
    n.v = 0;
    n.lastSpike = this.time;
    n.glow = 1;
    n.theta += P.thetaStep;
    n.rate += 1 / P.tauRate;
    this.stats.fired++;
    for (const s of this.synapses) {
      if (s.state !== 'active') continue;
      if (s.post === n) {
        // Hebbian potentiation: this input arrived just before the cell fired.
        if (this.time - s.lastArrival < P.ltpWindow) {
          s.w += P.ltp * (1 - s.w);
          s.flash = 1;
          this.stats.ltp++;
        }
      } else if (s.pre === n && this.spikes.length < P.maxSpikes) {
        this.spikes.push({ syn: s, t: 0 });
        this.stats.spikes++;
      }
    }
  }

  private deliver(s: Synapse): void {
    const post = s.post;
    if (post.state === 'dying') return;
    s.lastArrival = this.time;
    // Depression: the input arrived just after the cell had fired, so it did not contribute.
    if (this.time - post.lastSpike < P.ltdWindow) {
      s.w -= P.ltd * s.w;
      this.stats.ltd++;
    }
    post.v += P.gain * s.w;
  }

  private removeSpike(i: number): void {
    const last = this.spikes.pop()!;
    if (i < this.spikes.length) this.spikes[i] = last;
  }

  // --- Structure --------------------------------------------------------------------------------

  private seed(intro: boolean): void {
    for (let i = 0; i < this.target; i++) {
      const spot = this.findSpot(10);
      const n = this.addNeuron(spot.x, spot.y, false);
      n.born = this.time - P.minAgeToDie;
      if (intro) {
        n.state = 'growing';
        n.growth = 0;
        n.growStart = this.time + this.rng() * 900;
        n.growDur = 1100 + this.rng() * 500;
        n.matureAt = n.growStart + n.growDur;
      }
    }
    for (const n of this.neurons) {
      const k = 1 + Math.floor(this.rng() * 3);
      for (let j = 0; j < k; j++) {
        this.sprout({
          pre: n,
          weight: 0.18 + this.rng() * 0.6,
          wait: intro ? 700 + this.rng() * 1400 : 0,
          instant: !intro,
          seeding: true,
        });
      }
    }
    this.nextBirth = this.time + range(this.rng, P.birthEvery) * 0.6;
    this.nextSprout = this.time + range(this.rng, P.sproutEvery);
    this.version++;
  }

  private addNeuron(x: number, y: number, newborn: boolean): Neuron {
    const cell = growCell(this.rng);
    const t = this.time;
    const n: Neuron = {
      id: this.nextId++,
      x,
      y,
      r: cell.r,
      segs: cell.segs,
      tips: cell.tips,
      reach: cell.reach,
      hue: this.rng(),
      v: 0,
      theta: newborn ? P.immatureTheta : P.theta0,
      base: P.theta0,
      rate: P.targetRate,
      lastSpike: -1e9,
      glow: 0,
      state: newborn ? 'growing' : 'mature',
      born: t,
      growStart: t,
      growDur: P.growDur,
      matureAt: newborn ? t + P.matureAfter : t,
      newborn,
      wired: !newborn,
      growth: newborn ? 0 : 1,
      fade: 1,
      nIn: 0,
      nOut: 0,
      sumIn: 0,
    };
    this.neurons.push(n);
    return n;
  }

  /** Best of k random spots: the one farthest from every living soma. */
  private findSpot(k: number): Point {
    const m = P.margin;
    let best: Point = { x: this.width / 2, y: this.height / 2 };
    let bestD = -1;
    for (let i = 0; i < k; i++) {
      const x = m + this.rng() * Math.max(1, this.width - 2 * m);
      const y = m + this.rng() * Math.max(1, this.height - 2 * m);
      let d = Infinity;
      for (const n of this.neurons) {
        if (n.state === 'dying') continue;
        const dd = (n.x - x) ** 2 + (n.y - y) ** 2;
        if (dd < d) d = dd;
      }
      if (d > bestD) {
        bestD = d;
        best = { x, y };
      }
    }
    return best;
  }

  private regulate(): void {
    const t = this.time;
    let alive = 0;
    for (const n of this.neurons) if (n.state !== 'dying') alive++;
    if (t >= this.nextBirth) {
      if (alive <= this.target) {
        this.birth();
        alive++;
      }
      // Small tissues (phones) turn over more slowly, so each cell lives a few minutes.
      const slow = Math.sqrt(clamp(40 / this.target, 1, 2.5));
      this.nextBirth = t + (alive < this.target ? 350 + this.rng() * 500 : range(this.rng, P.birthEvery) * slow);
    }
    if (alive > this.target) {
      if (this.nextDeath === Infinity) {
        this.nextDeath = t + (alive > this.target + 2 ? 250 + this.rng() * 500 : 2500 + this.rng() * 3500);
      }
      if (t >= this.nextDeath) {
        const victim = this.pickVictim();
        if (victim) this.kill(victim);
        this.nextDeath = Infinity;
      }
    } else {
      this.nextDeath = Infinity;
    }
  }

  private birth(): void {
    const spot = this.findSpot(14);
    const n = this.addNeuron(spot.x, spot.y, true);
    n.glow = 1;
    this.births.push({ x: n.x, y: n.y, at: this.time });
    this.stats.births++;
  }

  /** The mature cell with the weakest wiring (cells outside the viewport first). */
  private pickVictim(): Neuron | null {
    let best: Neuron | null = null;
    let bestScore = Infinity;
    for (const n of this.neurons) {
      if (n.state !== 'mature' || this.time - n.born < P.minAgeToDie) continue;
      let score: number;
      if (n.x > this.width || n.y > this.height) {
        score = -1;
      } else {
        score = this.rng() * 0.05;
        for (const s of this.synapses) {
          if (s.state !== 'pruning' && (s.pre === n || s.post === n)) score += s.w + 0.1;
        }
      }
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return best;
  }

  private kill(n: Neuron): void {
    n.state = 'dying';
    n.fade = 1;
    for (const s of this.synapses) {
      if (s.state !== 'pruning' && (s.pre === n || s.post === n)) s.state = 'pruning';
    }
    this.stats.deaths++;
    this.version++;
  }

  private removeNeuron(i: number): void {
    const n = this.neurons[i];
    for (let j = this.synapses.length - 1; j >= 0; j--) {
      const s = this.synapses[j];
      if (s.pre === n || s.post === n) this.dropSynapse(j);
    }
    this.neurons.splice(i, 1);
  }

  private dropSynapse(j: number): void {
    const s = this.synapses[j];
    s.state = 'pruning';
    s.growth = 0;
    s.pre.nOut--;
    s.post.nIn--;
    const last = this.synapses.pop()!;
    if (j < this.synapses.length) this.synapses[j] = last;
  }

  private connected(pre: Neuron, post: Neuron): boolean {
    for (const s of this.synapses) if (s.pre === pre && s.post === post) return true;
    return false;
  }

  private pick<T>(items: T[], weights: number[]): T | null {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) return null;
    let u = this.rng() * total;
    for (let i = 0; i < items.length; i++) {
      u -= weights[i];
      if (u <= 0) return items[i];
    }
    return items[items.length - 1] ?? null;
  }

  /** Grow a new synapse; either end can be given, the other is chosen among nearby cells. */
  private sprout(opts: SproutOptions = {}): boolean {
    const ready = (n: Neuron) => n.state !== 'dying' && (opts.seeding === true || n.growth >= 0.5);
    let pre = opts.pre ?? null;
    let post = opts.post ?? null;
    const capped = this.synapses.length >= this.target * P.synapsesPerNeuron;
    if (capped && !pre?.newborn && !post?.newborn) return false;

    if (!pre) {
      const cands: Neuron[] = [];
      const weights: number[] = [];
      for (const n of this.neurons) {
        if (!ready(n) || n.nOut >= P.maxOut || n === post) continue;
        let w = (P.maxOut - n.nOut) * (n.newborn ? 4 : 1);
        if (post) {
          const d = Math.hypot(n.x - post.x, n.y - post.y);
          if (d > this.reach || this.connected(n, post)) continue;
          w /= d + 40;
        }
        cands.push(n);
        weights.push(w);
      }
      pre = this.pick(cands, weights);
    }
    if (!pre || pre.nOut >= P.maxOut) return false;

    if (!post) {
      const cands: Neuron[] = [];
      const weights: number[] = [];
      for (const n of this.neurons) {
        if (n === pre || !ready(n) || n.nIn >= P.maxIn) continue;
        const d = Math.hypot(n.x - pre.x, n.y - pre.y);
        if (d > this.reach || this.connected(pre, n)) continue;
        cands.push(n);
        weights.push((n.newborn ? 3 : 1) / (d + 40));
      }
      post = this.pick(cands, weights);
    }
    if (!post || post === pre || post.nIn >= P.maxIn || this.connected(pre, post)) return false;

    this.synapses.push(this.makeSynapse(pre, post, opts));
    pre.nOut++;
    post.nIn++;
    if (!opts.seeding) this.stats.sprouted++;
    return true;
  }

  private makeSynapse(pre: Neuron, post: Neuron, opts: SproutOptions): Synapse {
    // Land on one of the two dendrite tips of the target that are nearest to the presynaptic soma.
    let tip: Point = { x: 0, y: 0 };
    if (post.tips.length) {
      const order = post.tips
        .map((p) => ({ p, d: (post.x + p.x - pre.x) ** 2 + (post.y + p.y - pre.y) ** 2 }))
        .sort((a, b) => a.d - b.d);
      tip = order[Math.min(order.length - 1, Math.floor(this.rng() * 2))].p;
    }
    const x2 = post.x + tip.x;
    const y2 = post.y + tip.y;
    let dx = x2 - pre.x;
    let dy = y2 - pre.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    const x0 = pre.x + dx * (pre.r + 1);
    const y0 = pre.y + dy * (pre.r + 1);
    const chord = Math.hypot(x2 - x0, y2 - y0);
    const bend = (this.rng() - 0.5) * 0.55;
    return {
      pre,
      post,
      x0,
      y0,
      cx: (x0 + x2) / 2 - dy * bend * chord,
      cy: (y0 + y2) / 2 + dx * bend * chord,
      x2,
      y2,
      len: Math.max(12, chord * (1 + 0.67 * bend * bend)),
      w: opts.weight ?? P.newWeight,
      state: opts.instant ? 'active' : 'growing',
      growth: opts.instant ? 1 : 0,
      wait: opts.wait ?? 0,
      lastArrival: -1e9,
      flash: 0,
    };
  }
}
