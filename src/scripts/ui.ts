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
  let t: string | null = null;
  try {
    t = localStorage.getItem('theme');
  } catch {
    /* ignore */
  }
  if (t === 'dark' || t === 'light') root.setAttribute('data-theme', t);
  else if (root.dataset.section === 'blog') root.setAttribute('data-theme', 'dark');
});

// --- One-time delegated handlers -----------------------------------------------------
function setTocDrawer(open: boolean) {
  const sidebar = document.getElementById('toc-sidebar');
  const btn = document.querySelector<HTMLElement>('[data-toc-toggle]');
  if (!sidebar) return;
  sidebar.classList.toggle('open', open);
  btn?.classList.toggle('active', open);
  btn?.setAttribute('aria-expanded', String(open));
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.querySelector('.toc-sidebar.open')) setTocDrawer(false);
});

document.addEventListener('click', (e) => {
  const target = e.target as Element | null;
  if (!target) return;
  if (target.closest('[data-toc-toggle]')) {
    setTocDrawer(!document.querySelector('.toc-sidebar.open'));
    return;
  }
  const openDrawer = document.querySelector('.toc-sidebar.open');
  if (openDrawer && (!openDrawer.contains(target) || target.closest('a'))) setTocDrawer(false);
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

// --- Scroll-driven state (progress bar, back-to-top, scroll-spies) --------------------------
type Spy = { links: HTMLAnchorElement[]; sections: HTMLElement[]; strip: HTMLElement | null; current: string };
let spies: Spy[] = [];
let progressBar: HTMLElement | null = null;
let toTop: HTMLElement | null = null;
let queued = false;

function makeSpy(links: HTMLAnchorElement[], strip: HTMLElement | null): Spy | null {
  const inPage = links.filter((a) => a.hash !== '' && a.pathname === location.pathname);
  const sections = inPage.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1)))).filter((s): s is HTMLElement => s !== null);
  return sections.length ? { links: inPage, sections, strip, current: '' } : null;
}

function updateSpy(spy: Spy, y: number) {
  const marker = y + window.innerHeight * 0.3;
  let current: HTMLElement | null = null;
  for (const s of spy.sections) {
    if (s.getBoundingClientRect().top + y <= marker) current = s;
  }
  if (y < 40) current = spy.sections[0];
  else if (window.innerHeight + y >= root.scrollHeight - 2) current = spy.sections[spy.sections.length - 1];
  const id = current ? current.id : '';
  if (id === spy.current) return;
  spy.current = id;

  let activeLink: HTMLAnchorElement | null = null;
  for (const a of spy.links) {
    const on = decodeURIComponent(a.hash) === `#${id}`;
    a.classList.toggle('active', on);
    a.parentElement?.classList.toggle('active', on);
    if (on) activeLink = a;
  }
  // Keep the active tab in view when the tab strip scrolls horizontally (phones).
  if (activeLink && spy.strip && spy.strip.scrollWidth > spy.strip.clientWidth + 4) {
    const stripRect = spy.strip.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();
    const left = linkRect.left - stripRect.left + spy.strip.scrollLeft - stripRect.width / 2 + linkRect.width / 2;
    spy.strip.scrollTo({ left, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
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
  for (const spy of spies) updateSpy(spy, y);
}

function queueScroll() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(onScroll);
}
window.addEventListener('scroll', queueScroll, { passive: true });
window.addEventListener('resize', queueScroll, { passive: true });

// --- Copy buttons, lightbox (delegated, one-time) ----------------------------------------
async function copyText(text: string, btn: HTMLElement) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* unsupported */ }
    ta.remove();
  }
  const original = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i> Copied';
  btn.classList.add('is-copied');
  window.setTimeout(() => {
    btn.innerHTML = original;
    btn.classList.remove('is-copied');
  }, 1600);
}

function lightbox(): HTMLDialogElement {
  let dlg = document.querySelector<HTMLDialogElement>('dialog.lightbox');
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.className = 'lightbox';
  dlg.innerHTML = '<button type="button" class="lightbox-close" aria-label="Close"><i class="fas fa-xmark" aria-hidden="true"></i></button><figure><img alt=""><figcaption></figcaption></figure>';
  dlg.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t === dlg || t.closest('.lightbox-close')) dlg!.close();
  });
  dlg.addEventListener('close', () => root.classList.remove('lightbox-open'));
  document.body.appendChild(dlg);
  return dlg;
}

document.addEventListener('click', (e) => {
  const target = e.target as Element | null;
  if (!target) return;

  const copyLink = target.closest<HTMLElement>('[data-copy-link]');
  if (copyLink) {
    copyText(copyLink.dataset.copyLink || location.href, copyLink);
    return;
  }
  const copyBtn = target.closest<HTMLElement>('[data-copy-code]');
  if (copyBtn) {
    const pre = copyBtn.parentElement?.querySelector('pre');
    if (pre) copyText(pre.innerText, copyBtn);
    return;
  }
  const img = target.closest<HTMLImageElement>('.post figure img');
  if (img && !img.closest('dialog') && typeof HTMLDialogElement !== 'undefined') {
    e.preventDefault();
    const dlg = lightbox();
    const shown = dlg.querySelector('img')!;
    shown.src = img.currentSrc || img.src;
    shown.alt = img.alt;
    const cap = img.closest('figure')?.querySelector('figcaption');
    dlg.querySelector('figcaption')!.innerHTML = cap ? cap.innerHTML : '';
    root.classList.add('lightbox-open');
    dlg.showModal();
  }
});

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

// Posts: anchor links on headings, copy buttons on code blocks.
function setupPost() {
  const post = document.querySelector<HTMLElement>('[data-post]');
  if (!post) return;
  for (const h of post.querySelectorAll<HTMLElement>('h2[id], h3[id]')) {
    if (h.querySelector('.anchor')) continue;
    const a = document.createElement('a');
    a.className = 'anchor';
    a.href = `#${h.id}`;
    a.setAttribute('aria-label', 'Link to this section');
    a.textContent = '#';
    h.appendChild(a);
  }
  for (const pre of post.querySelectorAll<HTMLElement>('pre')) {
    if (pre.parentElement?.classList.contains('codeblock')) continue;
    const wrap = document.createElement('div');
    wrap.className = 'codeblock';
    pre.replaceWith(wrap);
    wrap.appendChild(pre);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.setAttribute('data-copy-code', '');
    btn.innerHTML = '<i class="fas fa-copy" aria-hidden="true"></i> Copy';
    wrap.appendChild(btn);
  }
}

// Looping videos only play while they are on screen.
let videoObserver: IntersectionObserver | null = null;
function setupVideos() {
  videoObserver?.disconnect();
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('.post video'));
  if (!videos.length || !('IntersectionObserver' in window)) return;
  videoObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const v = entry.target as HTMLVideoElement;
        if (entry.isIntersecting) v.play().catch(() => { /* autoplay blocked: the controls remain */ });
        else v.pause();
      }
    },
    { threshold: 0.15 },
  );
  videos.forEach((v) => videoObserver!.observe(v));
}

let initializedFor: HTMLElement | null = null;

function init() {
  if (initializedFor === document.body) return;
  initializedFor = document.body;

  progressBar = document.querySelector<HTMLElement>('[data-scroll-progress]');
  toTop = document.querySelector<HTMLElement>('[data-to-top]');
  // Only links that point into the current page take part in a scroll-spy.
  spies = [
    makeSpy(Array.from(document.querySelectorAll<HTMLAnchorElement>('.site-nav a')), document.querySelector<HTMLElement>('.site-nav')),
    makeSpy(Array.from(document.querySelectorAll<HTMLAnchorElement>('.toc-sidebar a')), null),
  ].filter((s): s is Spy => s !== null);

  setupReveal();
  setupBrand();
  setupNews();
  setupPublications();
  setupPost();
  setupVideos();
  root.classList.add('ui-ready');
  onScroll();
}

document.addEventListener('astro:page-load', init);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
