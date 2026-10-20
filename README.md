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
- `src/scripts/`: Client-side enhancements (neural-tissue background, theme toggle, scroll reveal, scroll-spied tabs, tilt cards, publication search). Pages change client-side via Astro's `ClientRouter`, so `ui.ts` wires each page in `init()` on `astro:page-load`.
- `src/config.ts`: Central site configuration (title, email, social links, etc.).
- `public/`: Static assets (images, PDFs, external scripts).

## 📝 Customization

- **Site Info**: Edit `src/config.ts` to update your name, affiliation, and social links.
- **Publications**: Update `src/data/publications.ts` to add or modify your research papers.
- **Content**: Edit `src/pages/index.astro` to update your "About Me" text and the `interests`, `news` and `talks` arrays at the top of the file.
- **Navigation**: The tabs in the sticky top bar are the `tabs` array in `src/components/SiteHeader.astro`.
- **Styles**: Colors, fonts and spacing are CSS custom properties at the top of `src/styles/minimal-light.scss` (light and dark palettes). Set `font` in `src/config.ts` to `"Serif"` for a Crimson Pro body font.
- **Background**: A simulated patch of neural tissue behind the pages. `src/scripts/neural/tissue.ts` is the simulation (leaky integrate-and-fire neurons with STDP, synaptic scaling, firing-rate homeostasis, synapse sprouting and pruning, neurogenesis and apoptosis; all constants in `PARAMS`), and `src/scripts/background.ts` draws it. Colours and opacities come from the `--accent*-rgb` and `--neural-*` tokens in `minimal-light.scss`. Hovering makes neurons fire and a click sets off a burst; with reduced motion a static frame is shown. Without the homeostatic terms the network flips between silence and seizure-like activity, so re-run a long simulation before changing the gain or plasticity constants.
- **Publication teasers**: Put a wide (about 2:1) image in `public/assets/img/` and reference it from the `image` field.
- **Blog**: Posts are listed in `src/data/posts.ts`; each post's HTML body lives in `src/content/blog/<slug>/body.html` and its media in `public/blog/<slug>/media/`. `src/pages/blog/[slug].astro` renders a post in the style of the MorphoHDL article (paradigms-of-intelligence.github.io/morpho): a full-width dark hero, the article column with numbered figure captions, and "On this page" on the right (a slide-in drawer on phones). The blog section defaults to dark mode; the theme toggle still switches it. A post with `hero: "sfprm-sphere"` gets the interactive sphere hero (`src/components/heroes/SfprmHero.astro`, dynamics in `src/scripts/heroes/`), one with `hero: "pbtnca-worlds"` the strip of PBT-NCA rollouts over the run's score curve (`src/components/heroes/PbtNcaHero.astro`, scenes and data in `src/scripts/heroes/pbtnca-scenes.ts`); any other post shows its `cover` image in the hero. `paper` and `code` links feed the hero buttons. Interactive figures inside a post body live in `src/scripts/widgets/` and mount on their `data-*` element (e.g. the contested cell of the PBT-NCA post). `body.html` is edited directly; `src/content/blog/<slug>/source/` keeps the TeX source of a post. `scripts/render_math.py` turns such a source (`\( \)` and `\[ \]` math, needs matplotlib) into `body.html`, and `scripts/import_post.py` converts the SFPRM standalone export; both overwrite manual edits.

## 🚀 Deployment

The site is configured to automatically deploy to GitHub Pages via GitHub Actions.
- Workflow: `.github/workflows/astro.yml`
- Trigger: Pushes to `main`.

---
Originally migrated from a Jekyll-based setup.
