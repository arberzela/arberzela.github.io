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
- `src/styles/`: SCSS and CSS styles.
- `src/config.ts`: Central site configuration (title, email, social links, etc.).
- `public/`: Static assets (images, PDFs, external scripts).

## 📝 Customization

- **Site Info**: Edit `src/config.ts` to update your name, affiliation, and social links.
- **Publications**: Update `src/data/publications.ts` to add or modify your research papers.
- **Content**: Edit `src/pages/index.astro` to update your "About Me", "News", or other sections.
- **Styles**: Adjust `src/styles/minimal-light.scss` to change the theme's appearance (e.g., avatar size, colors).

## 🚀 Deployment

The site is configured to automatically deploy to GitHub Pages via GitHub Actions.
- Workflow: `.github/workflows/astro.yml`
- Trigger: Pushes to `main`.

---
Originally migrated from a Jekyll-based setup.
