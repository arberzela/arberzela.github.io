# Personal Academic Homepage (Astro)

This is a personal academic homepage built with [Astro](https://astro.build/) and inspired by the [Minimal Light](https://github.com/yaoyao-liu/minimal-light) theme.

## 🚀 Getting Started

### Local Development

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start Dev Server**:
   ```bash
   npm run dev
   ```
   The site will be available at `http://localhost:4321`.

### Build

To build the static site:
```bash
npm run build
```
The output will be in the `dist/` directory.

## 📁 Project Structure

- `src/pages/`: Contains the main pages (e.g., `index.astro`).
- `src/layouts/`: Base layout for the site.
- `src/components/`: Reusable Astro components (e.g., `Publications.astro`).
- `src/data/`: Structured data for the site (e.g., `publications.ts`).
- `src/styles/`: SCSS styles (`minimal-light.scss` = theme tokens/layout, `publications.scss` = paper list).
- `src/scripts/`: Client-side enhancements (animated background, theme toggle, scroll reveal, scroll-spied tabs, tilt cards, publication search). Pages change client-side via Astro's `ClientRouter`, so `ui.ts` wires each page in `init()` on `astro:page-load`.
- `src/config.ts`: Central site configuration (title, email, social links, etc.).
- `public/`: Static assets (images, PDFs, external scripts).

## 📝 Customization

- **Site Info**: Edit `src/config.ts` to update your name, affiliation, and social links.
- **Publications**: Update `src/data/publications.ts` to add or modify your research papers.
- **Content**: Edit `src/pages/index.astro` to update your "About Me" text and the `interests`, `news` and `talks` arrays at the top of the file.
- **Navigation**: The tabs in the sticky top bar are the `tabs` array in `src/components/SiteHeader.astro`.
- **Styles**: Colors, fonts and spacing are CSS custom properties at the top of `src/styles/minimal-light.scss` (light and dark palettes). Set `font` in `src/config.ts` to `"Serif"` for a Crimson Pro body font.
- **Publication teasers**: Put a wide (about 2:1) image in `public/assets/img/` and reference it from the `image` field.
- **Blog**: Posts are listed in `src/data/posts.ts`; each post's HTML body lives in `src/content/blog/<slug>/body.html` and its media in `public/blog/<slug>/media/`. `src/pages/blog/[slug].astro` renders every listed post inside the wide layout with a scroll-spied table of contents (built from the body's `h2`/`h3`), heading anchors, a figure lightbox, copy buttons on code blocks, a share row and an author card; `src/pages/blog/index.astro` is the listing and `src/pages/rss.xml.ts` the feed. `body.html` is edited directly (the SFPRM body has been edited by hand since import). `src/content/blog/sfprm/source/` keeps the original TeX source and math pre-renderer; `scripts/import_post.py` converts such an export into a body file, but re-running it overwrites manual edits.

## 🚀 Deployment

The site is configured to automatically deploy to GitHub Pages via GitHub Actions.
- Workflow: `.github/workflows/astro.yml`
- Trigger: Pushes to `main`.

---
Originally migrated from a Jekyll-based setup.
