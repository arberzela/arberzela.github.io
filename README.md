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
- `src/scripts/`: Client-side enhancements (ASCII space-turtle background, theme toggle, scroll reveal, scroll-spied tabs, tilt cards, publication search). Pages change client-side via Astro's `ClientRouter`, so `ui.ts` wires each page in `init()` on `astro:page-load`.
- `src/config.ts`: Central site configuration (title, email, social links, etc.).
- `public/`: Static assets (images, PDFs, external scripts).

## 📝 Customization

- **Site Info**: Edit `src/config.ts` to update your name, affiliation, and social links.
- **Publications**: Update `src/data/publications.ts` to add or modify your research papers.
- **Content**: Edit `src/pages/index.astro` to update your "About Me" text and the `interests`, `news` and `talks` arrays at the top of the file.
- **Navigation**: The tabs in the sticky top bar are the `tabs` array in `src/components/SiteHeader.astro`.
- **Styles**: Colors, fonts and spacing are CSS custom properties at the top of `src/styles/minimal-light.scss` (light and dark palettes). Set `font` in `src/config.ts` to `"Serif"` for a Crimson Pro body font.
- **Background**: ASCII-mosaic space turtles drifting through a starfield and a slowly moving constellation. `src/scripts/ascii/space.ts` holds the scene (turtle shape, swimming, stars, shooting stars, stardust, constellation), `src/scripts/background.ts` draws it on a 12 px grid and derives the turtle colours from the page palette. Opacity, the fade behind the text column, the grid and the constellation lines are the `--ascii-*` and `--constellation-alpha` tokens in `minimal-light.scss`. The pointer shoos turtles and pulls in constellation lines; a click sets off sparks. With reduced motion a still frame is shown, and the animation pauses on blog posts.
- **Publication teasers**: Put a wide (about 2:1) image in `public/assets/img/` and reference it from the `image` field.
- **Blog**: Posts are listed in `src/data/posts.ts`; each post's HTML body lives in `src/content/blog/<slug>/body.html` and its media in `public/blog/<slug>/media/`. `src/pages/blog/[slug].astro` renders a post in the style of the MorphoHDL article (paradigms-of-intelligence.github.io/morpho): a full-width dark hero, the article column with numbered figure captions, and "On this page" on the right (a slide-in drawer on phones). The blog section defaults to dark mode; the theme toggle still switches it. A post with `hero: "sfprm-sphere"` gets the interactive sphere hero (`src/components/heroes/SfprmHero.astro`, dynamics in `src/scripts/heroes/`), one with `hero: "pbtnca-worlds"` the strip of PBT-NCA rollouts over the run's score curve (`src/components/heroes/PbtNcaHero.astro`, scenes and data in `src/scripts/heroes/pbtnca-scenes.ts`); any other post shows its `cover` image in the hero. `paper` and `code` links feed the hero buttons. Interactive figures inside a post body live in `src/scripts/widgets/` and mount on their `data-*` element (e.g. the contested cell of the PBT-NCA post). `body.html` is edited directly; `src/content/blog/<slug>/source/` keeps the TeX source of a post. `scripts/render_math.py` turns such a source (`\( \)` and `\[ \]` math, needs matplotlib) into `body.html`, and `scripts/import_post.py` converts the SFPRM standalone export; both overwrite manual edits.

## 🚀 Deployment

The site is configured to automatically deploy to GitHub Pages via GitHub Actions.
- Workflow: `.github/workflows/astro.yml`
- Trigger: Pushes to `main`.

---
Originally migrated from a Jekyll-based setup.
