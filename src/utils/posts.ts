// Helpers shared by the blog listing, the post pages and the RSS feed.
import { posts, type Post } from '../data/posts';

// Post bodies are plain HTML files next to their slug: src/content/blog/<slug>/body.html
const bodies = import.meta.glob('../content/blog/*/body.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export function getPostBody(slug: string): string {
  const html = bodies[`../content/blog/${slug}/body.html`];
  if (html === undefined) throw new Error(`No body.html found for blog post "${slug}"`);
  return html;
}

export function getPosts(): Post[] {
  return [...posts].sort((a, b) => b.date.localeCompare(a.date));
}

export function plainText(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function readingTime(html: string): number {
  const words = plainText(html).split(' ').filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function slugify(text: string): string {
  return plainText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'section';
}

export interface TocEntry {
  level: 2 | 3;
  id: string;
  text: string;
}

/**
 * Prepare a post body for rendering: give every h2/h3 an id (for the table of contents and
 * anchor links), lazy-load figure images, and collect the headings in document order.
 */
export function preparePost(html: string): { html: string; toc: TocEntry[] } {
  const toc: TocEntry[] = [];
  const used = new Set<string>();
  const out = html.replace(/<h([23])([^>]*)>([\s\S]*?)<\/h\1>/g, (_m, lvl: string, attrs: string, inner: string) => {
    const level = Number(lvl) as 2 | 3;
    const text = plainText(inner);
    const idMatch = attrs.match(/\sid="([^"]+)"/);
    let id = idMatch ? idMatch[1] : slugify(text);
    let base = id;
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    const attrsWithId = idMatch ? attrs.replace(/\sid="[^"]+"/, ` id="${id}"`) : `${attrs} id="${id}"`;
    toc.push({ level, id, text });
    return `<h${lvl}${attrsWithId}>${inner}</h${lvl}>`;
  });
  const lazy = out.replace(/<img\b(?![^>]*\bloading=)([^>]*)>/g, '<img loading="lazy" decoding="async"$1>');
  // Display formulas were pre-rendered with fixed pixel sizes for 19px text; express them in em
  // so they scale with the article's font size.
  const sized = lazy.replace(
    /(<div class="math-display"[^>]*>\s*<svg[^>]*?)width="([\d.]+)px" height="([\d.]+)px"/g,
    (_m, head: string, w: string, h: string) => `${head}width="${(Number(w) / 19).toFixed(3)}em" height="${(Number(h) / 19).toFixed(3)}em"`,
  );
  return { html: sized, toc };
}

export function tocHtml(toc: TocEntry[]): string {
  // Flat list; sub-sections are indented via their class (as on the reference article layout).
  if (!toc.length) return '';
  return `<ul>${toc.map((e) => `<li class="toc-h${e.level}"><a href="#${e.id}">${e.text}</a></li>`).join('')}</ul>`;
}
