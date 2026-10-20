// Site behaviour: theme toggle, reveal-on-scroll, scroll-spied tabs, reading progress, back-to-top,
// 3D tilt cards, collapsible news and publication search. Works with Astro's ClientRouter:
// one-time listeners live at module level, per-page wiring happens in init().

const root = document.documentElement;
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

// --- Theme ----------------------------------------------------------------------
function currentTheme(): 'dark' | 'light' {
  const t = root.getAttribute('data-theme');
  if (t === 'dark' || t === 'light') return t;
  return darkQuery.matches ? 'dark' : 'light';
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try {
    localStorage.setItem('theme', next);
  } catch {
    /* storage may be unavailable (private mode); the choice still applies for this page */
  }
}

// Client-side navigation replaces the <html> attributes with the new page's; restore the ones we own.
document.addEventListener('astro:after-swap', () => {
  root.classList.add('js');
  try {
    const t = localStorage.getItem('theme');
    if (t === 'dark' || t === 'light') root.setAttribute('data-theme', t);
  } catch {
    /* ignore */
  }
});

// --- One-time delegated handlers -----------------------------------------------------
document.addEventListener('click', (e) => {
  const target = e.target as Element | null;
  if (!target) return;
  if (target.closest('[data-theme-toggle]')) {
    toggleTheme();
    return;
  }
  if (target.closest('[data-to-top]')) {
    window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  }
});

// Cards tilt towards the cursor and carry a spotlight (CSS reads --px/--py).
if (finePointer.matches) {
  document.addEventListener(
    'pointermove',
    (e) => {
      if (reduceMotion.matches) return;
      const el = (e.target as Element | null)?.closest?.('[data-tilt]') as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const max = Number(el.dataset.tilt) || 5;
      el.style.setProperty('--px', `${(px * 100).toFixed(1)}%`);
      el.style.setProperty('--py', `${(py * 100).toFixed(1)}%`);
      el.style.transform = `perspective(900px) rotateX(${((0.5 - py) * max * 2).toFixed(2)}deg) rotateY(${((px - 0.5) * max * 2).toFixed(2)}deg) translateY(-3px)`;
      el.classList.add('is-tilting');
    },
    { passive: true },
  );
  document.addEventListener('pointerout', (e) => {
    const el = (e.target as Element | null)?.closest?.('[data-tilt]') as HTMLElement | null;
    if (!el) return;
    const to = e.relatedTarget as Node | null;
    if (to && el.contains(to)) return;
    el.style.transform = '';
    el.classList.remove('is-tilting');
  });
}

// --- Scroll-driven state (progress bar, back-to-top, scroll-spy) --------------------------
let navLinks: HTMLAnchorElement[] = [];
let sections: HTMLElement[] = [];
let navStrip: HTMLElement | null = null;
let currentSection = '';
let progressBar: HTMLElement | null = null;
let toTop: HTMLElement | null = null;
let queued = false;

function updateSpy(y: number) {
  if (!sections.length) return;
  const marker = y + window.innerHeight * 0.3;
  let current: HTMLElement | null = null;
  for (const s of sections) {
    if (s.getBoundingClientRect().top + y <= marker) current = s;
  }
  if (y < 40) current = sections[0];
  else if (window.innerHeight + y >= root.scrollHeight - 2) current = sections[sections.length - 1];
  const id = current ? current.id : '';
  if (id === currentSection) return;
  currentSection = id;

  let activeLink: HTMLAnchorElement | null = null;
  for (const a of navLinks) {
    const on = a.hash === `#${id}`;
    a.classList.toggle('active', on);
    if (on) activeLink = a;
  }
  // Keep the active tab in view when the tab strip scrolls horizontally (phones).
  if (activeLink && navStrip && navStrip.scrollWidth > navStrip.clientWidth + 4) {
    const stripRect = navStrip.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();
    const left = linkRect.left - stripRect.left + navStrip.scrollLeft - stripRect.width / 2 + linkRect.width / 2;
    navStrip.scrollTo({ left, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  }
}

function onScroll() {
  queued = false;
  const y = window.scrollY;
  if (progressBar) {
    const max = root.scrollHeight - window.innerHeight;
    progressBar.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
  }
  toTop?.classList.toggle('is-visible', y > 600);
  updateSpy(y);
}

function queueScroll() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(onScroll);
}
window.addEventListener('scroll', queueScroll, { passive: true });
window.addEventListener('resize', queueScroll, { passive: true });

// --- Per-page wiring --------------------------------------------------------------------
let revealObserver: IntersectionObserver | null = null;
let brandObserver: IntersectionObserver | null = null;

function setupReveal() {
  revealObserver?.disconnect();
  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
  if ('IntersectionObserver' in window && !reduceMotion.matches) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          revealObserver?.unobserve(entry.target);
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -6% 0px' },
    );
    els.forEach((el) => revealObserver!.observe(el));
  } else {
    els.forEach((el) => el.classList.add('is-visible'));
  }
}

// The brand in the top bar appears once the profile card is out of view.
function setupBrand() {
  brandObserver?.disconnect();
  const bar = document.querySelector<HTMLElement>('.topbar');
  const profile = document.querySelector<HTMLElement>('.profile');
  if (!bar) return;
  if (!profile || !('IntersectionObserver' in window)) {
    bar.classList.add('show-brand');
    return;
  }
  brandObserver = new IntersectionObserver(
    ([entry]) => bar.classList.toggle('show-brand', !entry.isIntersecting),
    { threshold: 0, rootMargin: '-56px 0px 0px 0px' },
  );
  brandObserver.observe(profile);
}

function setupNews() {
  const collapsible = document.querySelector<HTMLElement>('[data-collapsible]');
  if (!collapsible || collapsible.nextElementSibling?.classList.contains('show-more')) return;
  const limit = Number(collapsible.dataset.collapsible) || 6;
  const items = Array.from(collapsible.children) as HTMLElement[];
  if (items.length <= limit) return;
  const extra = items.slice(limit);
  let collapsed = true;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pill show-more';
  const render = () => {
    extra.forEach((li) => (li.hidden = collapsed));
    btn.innerHTML = collapsed
      ? `<i class="fas fa-chevron-down" aria-hidden="true"></i> Show ${extra.length} more`
      : `<i class="fas fa-chevron-up" aria-hidden="true"></i> Show less`;
    btn.setAttribute('aria-expanded', String(!collapsed));
  };
  btn.addEventListener('click', () => {
    collapsed = !collapsed;
    render();
  });
  render();
  collapsible.insertAdjacentElement('afterend', btn);
}

function setupPublications() {
  const pubs = document.querySelector<HTMLElement>('[data-pubs]');
  if (!pubs) return;
  const input = pubs.querySelector<HTMLInputElement>('[data-pub-search]');
  const chips = Array.from(pubs.querySelectorAll<HTMLButtonElement>('[data-pub-filter]'));
  const groups = Array.from(pubs.querySelectorAll<HTMLElement>('.pub-group'));
  const cards = Array.from(pubs.querySelectorAll<HTMLElement>('.pub'));
  const empty = pubs.querySelector<HTMLElement>('.pubs-empty');
  const count = pubs.querySelector<HTMLElement>('[data-pub-count]');
  let type = 'all';

  const apply = () => {
    const q = (input?.value || '').trim().toLowerCase();
    let shown = 0;
    for (const card of cards) {
      const okType = type === 'all' || card.dataset.type === type;
      const okQuery = !q || (card.dataset.search || '').includes(q);
      const show = okType && okQuery;
      card.classList.toggle('is-hidden', !show);
      if (show) shown++;
    }
    for (const g of groups) {
      g.classList.toggle('is-hidden', g.querySelector('.pub:not(.is-hidden)') === null);
    }
    empty?.classList.toggle('is-visible', shown === 0);
    if (count) count.textContent = shown === cards.length ? `${cards.length} papers` : `${shown} of ${cards.length} papers`;
  };

  input?.addEventListener('input', apply);
  chips.forEach((chip) =>
    chip.addEventListener('click', () => {
      type = chip.dataset.pubFilter || 'all';
      chips.forEach((c) => c.classList.toggle('active', c === chip));
      apply();
    }),
  );
}

let initializedFor: HTMLElement | null = null;

function init() {
  if (initializedFor === document.body) return;
  initializedFor = document.body;

  progressBar = document.querySelector<HTMLElement>('[data-scroll-progress]');
  toTop = document.querySelector<HTMLElement>('[data-to-top]');
  navStrip = document.querySelector<HTMLElement>('.site-nav');
  // Only tabs that point into the current page take part in the scroll-spy.
  navLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.site-nav a')).filter(
    (a) => a.hash !== '' && a.pathname === location.pathname,
  );
  sections = navLinks
    .map((a) => document.getElementById(a.hash.slice(1)))
    .filter((s): s is HTMLElement => s !== null);
  currentSection = '';

  setupReveal();
  setupBrand();
  setupNews();
  setupPublications();
  root.classList.add('ui-ready');
  onScroll();
}

document.addEventListener('astro:page-load', init);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
