"""Pre-render the TeX in a blog post fragment to inline SVG (no runtime MathJax).

Usage: python3 scripts/render_math.py <src/content/blog/<slug>/source/body.src.html> <src/content/blog/<slug>/body.html>

Every \\( ... \\) becomes an inline <span class="math"> and every \\[ ... \\] a <div class="math-display">,
rendered with matplotlib's mathtext (Computer Modern), the same way as the SFPRM post: inline formulas
are sized in em for 19 px text, display formulas in px (src/utils/posts.ts rescales those to em), and
the glyphs follow the text colour through post.scss. Needs matplotlib.

The output overwrites body.html, so edits made directly to body.html are lost when this is re-run.
mathtext gotcha: around tall content (a sum with limits) the largest \\right) glyph comes out as '!';
use \\left[ ... \\right] there instead.
"""
import io
import re
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
from matplotlib.mathtext import MathTextParser

plt.rcParams.update({"mathtext.fontset": "cm", "svg.fonttype": "path", "font.size": 12})

DPI = 96  # 1 pt -> 1.333 px, matches CSS px
REF_PX = 19.0  # inline math is rendered for 19 px text, then scaled in em
INLINE_PT = 19 * 72 / DPI
DISPLAY_PT = 20.5 * 72 / DPI


def descent_lp(size_pt):
    """Descent of the line box matplotlib pads text to (max of 'lp' and the formula)."""
    fig = plt.figure(figsize=(1, 1), dpi=DPI)
    r = fig.canvas.get_renderer()
    _, _, d = r.get_text_width_height_descent("lp", FontProperties(size=size_pt), ismath=False)
    plt.close(fig)
    return d


def render(tex, size_pt):
    """Return (svg_markup, width_px, height_px, baseline_offset_px)."""
    prop = FontProperties(size=size_pt)
    vp = MathTextParser("path").parse(f"${tex}$", dpi=DPI, prop=prop)
    w, h, d = vp.width, vp.height, vp.depth
    fig = plt.figure(figsize=(max(w, 1) / DPI + 0.05, (h + d) / DPI + 0.3), dpi=DPI)
    fig.patch.set_alpha(0)
    fig.text(0.0, 0.3, f"${tex}$", fontproperties=prop, color="#1c1c1c")
    buf = io.StringIO()
    fig.savefig(buf, format="svg", dpi=DPI, bbox_inches="tight", pad_inches=0.0, transparent=True)
    plt.close(fig)
    svg = buf.getvalue()
    svg = svg[svg.index("<svg"):]
    vb = [float(x) for x in re.search(r'viewBox="([\d.\- ]+)"', svg).group(1).split()]
    wpx, hpx = vb[2] * DPI / 72, vb[3] * DPI / 72
    # The tight box is the text line box: its bottom sits max(depth, descent of 'lp') below the baseline.
    return svg, wpx, hpx, max(d, descent_lp(size_pt))


def tidy(svg):
    """Drop matplotlib's per-formula metadata and style block (post.scss styles the glyphs)."""
    svg = re.sub(r"\s*<metadata>.*?</metadata>", "", svg, flags=re.S)
    svg = re.sub(r'\s*<defs>\s*<style type="text/css">\*\{stroke-linejoin: round; stroke-linecap: butt\}</style>\s*</defs>', "", svg)
    return svg.rstrip()


def attr(tex):
    return tex.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")


def main(src_path, out_path):
    src = open(src_path).read()
    failures = []
    counts = {"inline": 0, "display": 0}

    def repl_display(m):
        tex = m.group(1).strip()
        try:
            svg, w, h, _ = render(tex, DISPLAY_PT)
        except Exception as e:  # keep the TeX so the failure is visible on the page
            failures.append((tex, str(e)[:120]))
            return m.group(0)
        counts["display"] += 1
        svg = re.sub(r'width="[^"]+"', f'width="{w:.2f}px"', svg, count=1)
        svg = re.sub(r'height="[^"]+"', f'height="{h:.2f}px"', svg, count=1)
        return (f'<div class="math-display" role="img" aria-label="{attr(tex)}" data-tex="{attr(tex)}" '
                f'style="text-align:center;margin:10px 0 22px;overflow-x:auto">{tidy(svg)}</div>')

    def repl_inline(m):
        tex = m.group(1).strip()
        try:
            svg, w, h, d = render(tex, INLINE_PT)
        except Exception as e:
            failures.append((tex, str(e)[:120]))
            return m.group(0)
        counts["inline"] += 1
        svg = re.sub(r'width="[^"]+"', f'width="{w / REF_PX:.3f}em"', svg, count=1)
        svg = re.sub(r'height="[^"]+"', f'height="{h / REF_PX:.3f}em"', svg, count=1)
        svg = svg.replace("<svg ", f'<svg style="vertical-align:-{d / REF_PX:.3f}em;display:inline-block" ', 1)
        return f'<span class="math" role="img" aria-label="{attr(tex)}" data-tex="{attr(tex)}">{tidy(svg)}</span>'

    out = re.sub(r"\\\[(.+?)\\\]", repl_display, src, flags=re.S)
    out = re.sub(r"\\\((.+?)\\\)", repl_inline, out, flags=re.S)
    open(out_path, "w").write(out.strip() + "\n")
    print(f"inline: {counts['inline']}, display: {counts['display']}, failures: {len(failures)}, size: {len(out) / 1e3:.0f} kB")
    for f in failures:
        print("  FAIL", f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
