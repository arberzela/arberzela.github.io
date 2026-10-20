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
- **Blog**: Posts are listed in `src/data/posts.ts`. Each post's HTML body lives in `src/content/blog/<slug>/body.html` and its media in `public/blog/<slug>/media/`; the listing page is `src/pages/blog/index.astro` and each post gets a page in `src/pages/blog/` that renders the body inside the wide layout (`variant="wide"` of `BaseLayout`). The SFPRM post's TeX source and math pre-renderer are kept in `src/content/blog/sfprm/source/`. To change the post: edit `index.src.html` there, run `python build_math.py` in that folder (needs matplotlib) to regenerate `index.html`, then `python3 scripts/import_post.py src/content/blog/sfprm/source/index.html src/content/blog/sfprm/body.html` and copy any new media into `public/blog/sfprm/media/`.

## 🚀 Deployment

The site is configured to automatically deploy to GitHub Pages via GitHub Actions.
- Workflow: `.github/workflows/astro.yml`
- Trigger: Pushes to `main`.

---
Originally migrated from a Jekyll-based setup.
