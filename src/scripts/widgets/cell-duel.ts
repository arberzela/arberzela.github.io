// "One contested cell" (PBT-NCA post): the PD-NCA competition rule at a single cell, evaluated live.
// Three agents and the environment each propose an attack and a defense direction. With two attack and
// two defense channels these are directions in the plane, so a cosine similarity is the cosine of the
// angle between two arrows. Dragging an arrowhead (or using the arrow keys on it) recomputes the
// strengths Ψ, the softmax shares w and the survival test w > α. The environment is always present.
// Mounted on any page with a [data-cell-duel] element (Astro ClientRouter safe).

const ALPHA = 0.4;
const PSI_MAX = 4; // half-width of the strength axis
const SIZE = 300;
const C = SIZE / 2;
const R_ATT = 122;
const R_DEF = 82;
const SVG_NS = 'http://www.w3.org/2000/svg';

interface Entity {
  key: string; // CSS class suffix: env, a1, a2, a3
  name: string;
  short: string; // subscript used in the breakdown
  att: number; // degrees, counter-clockwise from east
  def: number;
  fixed: boolean; // the environment's update is static
}

// Agents 1 and 2 both clear α here; agent 3 dies (see the post for the rule).
const DEFAULTS: Omit<Entity, 'name' | 'short' | 'key' | 'fixed'>[] = [
  { att: 215, def: 10 },
  { att: 0, def: 55 },
  { att: 40, def: 180 },
  { att: 240, def: 295 },
];

const rad = (deg: number) => (deg * Math.PI) / 180;
const wrap = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;
const fmt = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** φ_kl = cos(a_k, d_l) − cos(a_l, d_k); Ψ_k = Σ_{l≠k} φ_kl; w = softmax(Ψ). */
export function compete(att: number[], def: number[]) {
  const n = att.length;
  const phi = att.map((_, k) => att.map((__, l) => (k === l ? 0 : Math.cos(rad(att[k] - def[l])) - Math.cos(rad(att[l] - def[k])))));
  const psi = phi.map((row) => row.reduce((a, b) => a + b, 0));
  const m = Math.max(...psi);
  const e = psi.map((p) => Math.exp(p - m));
  const s = e.reduce((a, b) => a + b, 0);
  return { phi, psi, w: e.map((x) => x / s), n };
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}

function html<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: Element, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  parent?.appendChild(el);
  return el;
}

const tip = (r: number, deg: number) => ({ x: C + r * Math.cos(rad(deg)), y: C - r * Math.sin(rad(deg)) });

class CellDuel {
  private root: HTMLElement;
  private svgEl: SVGSVGElement;
  private entities: Entity[];
  private arrows: { shaft: SVGLineElement; head: SVGPolygonElement; handle: SVGCircleElement | null; r: number; kind: 'att' | 'def' }[][] = [];
  private rows: { psiBar: HTMLElement; psiVal: HTMLElement; wBar: HTMLElement; wVal: HTMLElement; status: HTMLElement }[] = [];
  private breakdown: HTMLElement;
  private summary: HTMLElement;
  private focus = 1; // entity whose strength is broken down
  private drag: { e: number; kind: 'att' | 'def'; id: number } | null = null;
  private lastSummary = '';
  private cleanups: (() => void)[] = [];
  private seed = 1;

  constructor(root: HTMLElement) {
    this.root = root;
    this.entities = [
      { key: 'env', name: 'Environment', short: 'env', fixed: true, ...DEFAULTS[0] },
      { key: 'a1', name: 'Agent 1', short: '1', fixed: false, ...DEFAULTS[1] },
      { key: 'a2', name: 'Agent 2', short: '2', fixed: false, ...DEFAULTS[2] },
      { key: 'a3', name: 'Agent 3', short: '3', fixed: false, ...DEFAULTS[3] },
    ];
    root.textContent = '';
    const wrapEl = html('div', 'duel', root);

    // Dial ---------------------------------------------------------------------------------------
    const dial = html('div', 'duel-dial', wrapEl);
    this.svgEl = svg('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'duel-svg', role: 'group', 'aria-label': 'Attack and defense directions of the three agents and the environment' }, dial);
    svg('circle', { cx: C, cy: C, r: R_ATT, class: 'duel-ring' }, this.svgEl);
    svg('circle', { cx: C, cy: C, r: R_DEF, class: 'duel-ring' }, this.svgEl);
    const label = (text: string, r: number) => {
      const t = svg('text', { x: C, y: C - r - 6, class: 'duel-ring-label', 'text-anchor': 'middle' }, this.svgEl);
      t.textContent = text;
    };
    label('attack', R_ATT);
    label('defense', R_DEF);
    // Environment first so the agents' handles sit on top.
    this.entities.forEach((ent, e) => {
      const g = svg('g', { class: `duel-entity e-${ent.key}` }, this.svgEl);
      this.arrows[e] = (['att', 'def'] as const).map((kind) => {
        const r = kind === 'att' ? R_ATT : R_DEF;
        const shaft = svg('line', { x1: C, y1: C, class: 'duel-shaft' }, g);
        const head = svg('polygon', { class: `duel-head ${kind === 'att' ? 'is-attack' : 'is-defense'}` }, g);
        let handle: SVGCircleElement | null = null;
        if (!ent.fixed) {
          handle = svg('circle', {
            r: 16,
            class: 'duel-handle',
            tabindex: 0,
            role: 'slider',
            'aria-label': `${ent.name} ${kind === 'att' ? 'attack' : 'defense'} direction`,
            'aria-valuemin': 0,
            'aria-valuemax': 359,
          }, g);
          this.bindHandle(handle, e, kind);
        }
        return { shaft, head, handle, r, kind };
      });
    });
    svg('circle', { cx: C, cy: C, r: 3.5, class: 'duel-hub' }, this.svgEl);

    const actions = html('div', 'duel-actions', dial);
    const shuffle = html('button', 'pill', actions, 'Shuffle');
    shuffle.type = 'button';
    const reset = html('button', 'pill', actions, 'Reset');
    reset.type = 'button';
    this.on(shuffle, 'click', () => this.shuffle());
    this.on(reset, 'click', () => this.reset());

    // Table --------------------------------------------------------------------------------------
    const panel = html('div', 'duel-panel', wrapEl);
    const table = html('div', 'duel-table', panel);
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', 'Strength, share and fate of each entity in the cell');
    // Header and axis rows mirror a data row (track + value), so labels and ticks line up with the bars.
    const scaleRow = (cls: string, psi: [string, number][], w: [string, number][], role: string) => {
      const row = html('div', `duel-row ${cls}`, table);
      row.setAttribute('role', 'row');
      html('div', 'duel-name', row).setAttribute('role', role);
      for (const [key, ticks] of [['duel-psi', psi], ['duel-w', w]] as const) {
        const cell = html('div', key, row);
        cell.setAttribute('role', role);
        const track = html('div', 'duel-track is-scale', cell);
        for (const [text, at] of ticks) {
          const t = html('span', 'duel-tick', track, text);
          t.style.left = `${at}%`;
        }
        html('span', 'duel-val', cell);
      }
      html('div', 'duel-status', row).setAttribute('role', role);
    };
    scaleRow('is-head', [['strength Ψ', 0]], [['share w', 0]], 'columnheader');

    this.entities.forEach((ent, e) => {
      const row = html('div', `duel-row e-${ent.key}`, table);
      row.setAttribute('role', 'row');
      const name = html('div', 'duel-name', row);
      name.setAttribute('role', 'rowheader');
      html('span', 'duel-swatch', name).setAttribute('aria-hidden', 'true');
      html('span', '', name, ent.name);
      const psiCell = html('div', 'duel-psi', row);
      psiCell.setAttribute('role', 'cell');
      const psiTrack = html('div', 'duel-track is-diverging', psiCell);
      const psiBar = html('div', 'duel-bar', psiTrack);
      const psiVal = html('span', 'duel-val', psiCell);
      const wCell = html('div', 'duel-w', row);
      wCell.setAttribute('role', 'cell');
      const wTrack = html('div', 'duel-track', wCell);
      const wBar = html('div', 'duel-bar', wTrack);
      html('div', 'duel-alpha', wTrack).setAttribute('aria-hidden', 'true');
      const wVal = html('span', 'duel-val', wCell);
      const status = html('div', 'duel-status', row);
      status.setAttribute('role', 'cell');
      this.rows[e] = { psiBar, psiVal, wBar, wVal, status };
      this.on(row, 'pointerenter', () => this.setFocus(e));
    });
    scaleRow('is-axis', [[`−${PSI_MAX}`, 0], ['0', 50], [`+${PSI_MAX}`, 100]], [['0', 0], ['α = 0.4', ALPHA * 100], ['1', 100]], 'cell');
    (table.lastElementChild as HTMLElement).setAttribute('aria-hidden', 'true');

    this.breakdown = html('p', 'duel-breakdown', panel);
    this.summary = html('p', 'duel-summary', panel);
    this.summary.setAttribute('aria-live', 'polite');
    this.render();
  }

  private on(el: EventTarget, type: string, fn: (e: any) => void) {
    el.addEventListener(type, fn);
    this.cleanups.push(() => el.removeEventListener(type, fn));
  }

  destroy() {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
  }

  private bindHandle(handle: SVGCircleElement, e: number, kind: 'att' | 'def') {
    const angleAt = (ev: PointerEvent) => {
      const m = this.svgEl.getScreenCTM();
      if (!m) return null;
      const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
      return wrap((Math.atan2(C - p.y, p.x - C) * 180) / Math.PI);
    };
    this.on(handle, 'pointerdown', (ev: PointerEvent) => {
      ev.preventDefault();
      this.drag = { e, kind, id: ev.pointerId };
      handle.setPointerCapture?.(ev.pointerId);
      handle.classList.add('is-dragging');
      this.setFocus(e);
    });
    this.on(handle, 'pointermove', (ev: PointerEvent) => {
      if (!this.drag || this.drag.id !== ev.pointerId) return;
      const a = angleAt(ev);
      if (a === null) return;
      this.entities[e][kind] = a;
      this.render();
    });
    const end = () => {
      this.drag = null;
      handle.classList.remove('is-dragging');
    };
    this.on(handle, 'pointerup', end);
    this.on(handle, 'pointercancel', end);
    this.on(handle, 'focus', () => this.setFocus(e));
    this.on(handle, 'keydown', (ev: KeyboardEvent) => {
      const step = ev.shiftKey ? 15 : 5;
      const deltas: Record<string, number> = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: 30, PageDown: -30 };
      if (!(ev.key in deltas)) return;
      ev.preventDefault();
      this.entities[e][kind] = wrap(this.entities[e][kind] + deltas[ev.key]);
      this.render();
    });
  }

  private setFocus(e: number) {
    if (this.focus === e) return;
    this.focus = e;
    this.renderBreakdown(compete(this.entities.map((x) => x.att), this.entities.map((x) => x.def)));
  }

  private shuffle() {
    // A small deterministic generator, so repeated shuffles differ but every visit replays the same ones.
    const rnd = () => {
      this.seed = (this.seed * 1103515245 + 12345) % 2147483648;
      return this.seed / 2147483648;
    };
    this.entities.forEach((ent) => {
      ent.att = wrap(rnd() * 360);
      ent.def = wrap(rnd() * 360);
    });
    this.render();
  }

  private reset() {
    this.entities.forEach((ent, e) => {
      ent.att = DEFAULTS[e].att;
      ent.def = DEFAULTS[e].def;
    });
    this.render();
  }

  private render() {
    const res = compete(this.entities.map((x) => x.att), this.entities.map((x) => x.def));

    // Arrows.
    this.entities.forEach((ent, e) => {
      for (const a of this.arrows[e]) {
        const deg = ent[a.kind];
        const t = tip(a.r, deg);
        const base = tip(a.r - 11, deg);
        a.shaft.setAttribute('x2', base.x.toFixed(2));
        a.shaft.setAttribute('y2', base.y.toFixed(2));
        // Arrowhead: a triangle from the tip back to ±6 px either side of the shaft.
        const nx = Math.sin(rad(deg)), ny = Math.cos(rad(deg));
        const pts = [t, { x: base.x + 6 * nx, y: base.y + 6 * ny }, { x: base.x - 6 * nx, y: base.y - 6 * ny }];
        a.head.setAttribute('points', pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '));
        if (a.handle) {
          a.handle.setAttribute('cx', t.x.toFixed(2));
          a.handle.setAttribute('cy', t.y.toFixed(2));
          a.handle.setAttribute('aria-valuenow', String(deg));
          a.handle.setAttribute('aria-valuetext', `${deg} degrees`);
        }
      }
    });

    // Bars and fates.
    const alive = res.w.map((w, e) => this.entities[e].fixed || w > ALPHA);
    this.entities.forEach((ent, e) => {
      const r = this.rows[e];
      const psi = res.psi[e];
      const half = Math.min(1, Math.abs(psi) / PSI_MAX) * 50;
      r.psiBar.style.left = `${psi >= 0 ? 50 : 50 - half}%`;
      r.psiBar.style.width = `${half}%`;
      r.psiVal.textContent = fmt(psi);
      r.wBar.style.width = `${(res.w[e] * 100).toFixed(1)}%`;
      r.wVal.textContent = pct(res.w[e]);
      r.status.textContent = ent.fixed ? 'stays' : alive[e] ? '✓ alive' : '✕ dies';
      r.status.classList.toggle('is-alive', !ent.fixed && alive[e]);
      r.status.classList.toggle('is-dead', !alive[e]);
    });
    this.renderBreakdown(res);

    // One sentence for screen readers and a quick read.
    const agents = [1, 2, 3].sort((x, y) => res.w[y] - res.w[x]);
    const living = agents.filter((k) => alive[k]);
    const dead = [1, 2, 3].filter((k) => !alive[k]).map((k) => this.entities[k].name);
    const deadText = dead.length === 1 ? `${dead[0]} dies here` : `${dead.slice(0, -1).join(', ')} and ${dead[dead.length - 1]} die here`;
    let text: string;
    if (living.length === 0) text = 'No agent reaches 40%: all three die here and the environment keeps the cell.';
    else if (living.length === 1) text = `${this.entities[living[0]].name} takes the cell with ${pct(res.w[living[0]])}; ${deadText}.`;
    else
      text = `${this.entities[living[0]].name} (${pct(res.w[living[0]])}) and ${this.entities[living[1]].name} (${pct(res.w[living[1]])}) share the cell; ${deadText}.`;
    if (text !== this.lastSummary) {
      this.summary.textContent = text;
      this.lastSummary = text;
    }
  }

  private renderBreakdown(res: ReturnType<typeof compete>) {
    const k = this.focus;
    const ent = this.entities[k];
    const el = this.breakdown;
    el.textContent = '';
    html('span', 'duel-bd-lead', el, `Ψ${sub(ent.short)} = `);
    let first = true;
    this.entities.forEach((other, l) => {
      if (l === k) return;
      const v = res.phi[k][l];
      const term = html('span', 'duel-bd-term', el);
      html('span', 'duel-bd-num', term, first ? fmt(v) : ` ${v >= 0 ? '+' : '−'} ${Math.abs(v).toFixed(2)}`);
      html('span', 'duel-bd-vs', term, ` vs ${other.fixed ? 'environment' : other.name.toLowerCase()}`);
      first = false;
    });
    html('span', 'duel-bd-lead', el, ' = ');
    html('span', 'duel-bd-num is-total', el, fmt(res.psi[k]));
  }
}

const SUBS: Record<string, string> = { '1': '₁', '2': '₂', '3': '₃' };
const sub = (s: string) => (s in SUBS ? SUBS[s] : `(${s})`);

// --- Mounting (works with Astro's ClientRouter) ---------------------------------------------------
let mounted: CellDuel[] = [];

function mount() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-cell-duel]')) {
    if (el.dataset.mounted) continue;
    el.dataset.mounted = '1';
    try {
      mounted.push(new CellDuel(el));
    } catch (err) {
      console.warn('Interactive figure disabled:', err);
    }
  }
}

function unmount() {
  mounted.forEach((m) => m.destroy());
  mounted = [];
}

document.addEventListener('astro:page-load', mount);
document.addEventListener('astro:before-swap', unmount);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else mount();
