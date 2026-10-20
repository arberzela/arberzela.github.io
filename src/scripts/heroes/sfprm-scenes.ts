// Scenes and settings of the SFPRM hero illustration (shared by the component markup and the client script).
import { TAU_ANG, type LoopParams, type LoopRun } from './sphere-sim';

/** Upper-case Latin letters only, so Greek symbols (η, λ) keep their meaning in titles. */
export const heroCaps = (s: string): string => s.replace(/[a-z]/g, (c) => c.toUpperCase());

export type EtaSetting = number | 'adaptive';

/** λ at which the toy loop reaches its "answers" (stands in for the trained injection strength). */
export const REF_LAMBDA = 0.3;
export const LAMBDA_OPTIONS = [0.15, 0.3, 0.5, 0.7];
export const ETA_OPTIONS: EtaSetting[] = ['adaptive', 1, 0.5, 0.25];

// Toy schedule: η halves when the largest angle has not improved for 3 iterations.
const DECAY = 0.5;
const PATIENCE = 3;

export const lambdaLabel = (l: number) => `λ = ${l.toFixed(2)}`;
export const etaLabel = (e: EtaSetting) => (e === 'adaptive' ? 'η adaptive' : `η = ${e}`);
export const etaValue = (e: EtaSetting) => (e === 'adaptive' ? 'adaptive' : String(e));
export const parseEta = (v: string): EtaSetting => (v === 'adaptive' ? 'adaptive' : Number(v));

export function loopParams(lambda: number, eta: EtaSetting, maxIter: number): LoopParams {
  return {
    lambda,
    eta: eta === 'adaptive' ? 1 : eta,
    adaptive: eta === 'adaptive',
    decay: DECAY,
    patience: PATIENCE,
    maxIter,
    tau: TAU_ANG,
  };
}

export interface HeroScene {
  title: string;
  desc: string;
  lambda: number;
  eta: EtaSetting;
  maxIter: number;
}

export const SFPRM_SCENES: HeroScene[] = [
  {
    title: 'Adaptive angular damping',
    desc: 'Each step injects toward the input (orange), the block proposes a point (blue), and the state turns a fraction η of the way there. η halves when progress stalls; the loop halts once every proposal lies inside its cap.',
    lambda: REF_LAMBDA,
    eta: 'adaptive',
    maxIter: 50,
  },
  {
    title: 'Without damping (η = 1)',
    desc: 'With η fixed at 1 the same map keeps circling its fixed points. The largest angle never drops below 8.1°, so the loop never halts.',
    lambda: REF_LAMBDA,
    eta: 1,
    maxIter: 30,
  },
  {
    title: 'Strong injection (λ = 0.7)',
    desc: 'Injection this strong makes the raw map a contraction: it halts within a few steps, but far from the answers it reaches at λ = 0.3 (green rings).',
    lambda: 0.7,
    eta: 1,
    maxIter: 30,
  },
];

export const CUSTOM_MAX_ITER = 50;

/** Title and description for user-chosen settings, written from the run's outcome. */
export function describeCustom(lambda: number, eta: EtaSetting, run: LoopRun, answerGapDeg: number | null): { title: string; desc: string } {
  const title = `${lambdaLabel(lambda)}, ${etaLabel(eta)}`;
  let desc: string;
  if (run.halted) {
    desc = run.n <= 4 ? `The loop halts after only ${run.n} iterations.` : `The loop halts after ${run.n} iterations.`;
    if (answerGapDeg !== null) desc += ` The green rings are the answers at λ = ${REF_LAMBDA}; the closest token stops ${answerGapDeg.toFixed(0)}° from its answer.`;
  } else {
    desc = `No halt within ${run.n} iterations: η is too large for this λ, so the angles keep circling. Try η adaptive or a smaller η.`;
  }
  return { title, desc };
}
