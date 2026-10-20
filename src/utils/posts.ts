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
  return { html: lazy, toc };
}

export function tocHtml(toc: TocEntry[]): string {
  // Two levels: h2 items, each with an optional nested list of the h3s that follow it.
  type Item = { entry: TocEntry; children: TocEntry[] };
  const items: Item[] = [];
  for (const entry of toc) {
    if (entry.level === 3 && items.length) items[items.length - 1].children.push(entry);
    else items.push({ entry, children: [] });
  }
  const link = (e: TocEntry) => `<a href="#${e.id}">${e.text}</a>`;
  return `<ol>${items
    .map(({ entry, children }) => `<li>${link(entry)}${children.length ? `<ol>${children.map((c) => `<li>${link(c)}</li>`).join('')}</ol>` : ''}</li>`)
    .join('')}</ol>`;
}
