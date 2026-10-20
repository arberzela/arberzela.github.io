"""Pre-render every \\( ... \\) and \\[ ... \\] in index.src.html to inline SVG (no runtime MathJax)."""
import re, io, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.mathtext import MathTextParser
from matplotlib.font_manager import FontProperties
plt.rcParams.update({"mathtext.fontset": "cm", "svg.fonttype": "path", "font.size": 12})

DPI = 96                       # 1 pt -> 1.333 px, matches CSS px
FIX = [(r"\big(", r"\left("), (r"\big)", r"\right)"), (r"\le ", r"\leq "), (r"\ne ", r"\neq "), (r"\ge ", r"\geq "),
       (r"\mathbf z", r"\mathbf{z}"), (r"\mathbf x", r"\mathbf{x}"), (r"\tilde z", r"\tilde{z}"),
       (r"\mathbb R", r"\mathbb{R}"), (r"\mathbb S", r"\mathbb{S}"), (r"\operatorname{Id}", r"\mathrm{Id}"),
       (r"\mathrm E,", r"\mathrm{E},"), (r"\mathrm c,", r"\mathrm{c},")]

def norm(tex):
    tex = tex.strip()
    for a, b in FIX:
        tex = tex.replace(a, b)
    return tex

REF_PX = 19.0                  # inline math is rendered for 19 px text, then scaled in em

def descent_lp(size_pt):
    """Descent of the line box matplotlib pads text to (max of 'lp' and the formula)."""
    fig = plt.figure(figsize=(1, 1), dpi=DPI)
    r = fig.canvas.get_renderer()
    w, h, d = r.get_text_width_height_descent("lp", FontProperties(size=size_pt), ismath=False)
    plt.close(fig)
    return d

def render(tex, size_pt, color="#1c1c1c"):
    """Return (svg_markup, width_px, height_px, baseline_offset_px)."""
    prop = FontProperties(size=size_pt)
    vp = MathTextParser("path").parse(f"${tex}$", dpi=DPI, prop=prop)
    w, h, d = vp.width, vp.height, vp.depth
    fig = plt.figure(figsize=(max(w, 1) / DPI + 0.05, (h + d) / DPI + 0.3), dpi=DPI)
    fig.patch.set_alpha(0)
    fig.text(0.0, 0.3, f"${tex}$", fontproperties=prop, color=color)
    buf = io.StringIO()
    fig.savefig(buf, format="svg", dpi=DPI, bbox_inches="tight", pad_inches=0.0, transparent=True)
    plt.close(fig)
    svg = buf.getvalue()
    svg = svg[svg.index("<svg"):]
    m = re.search(r'viewBox="([\d.\- ]+)"', svg)
    vb = [float(x) for x in m.group(1).split()]
    wpx, hpx = vb[2] * DPI / 72, vb[3] * DPI / 72
    # the tight box is the text line box: its bottom sits max(depth, descent of 'lp') below the baseline
    below = max(d, descent_lp(size_pt))
    return svg, wpx, hpx, below

src = open("index.src.html").read()
# drop MathJax
src = re.sub(r"<!-- Math is rendered by MathJax.*?</script>\s*<script id=\"MathJax-script\"[^>]*></script>", "", src, flags=re.S)

INLINE_PT = 19 * 72 / DPI        # 19 px body text
DISPLAY_PT = 20.5 * 72 / DPI
n_inline = n_display = 0
failures = []

def repl_display(m):
    global n_display
    tex = norm(m.group(1))
    try:
        svg, w, h, d = render(tex, DISPLAY_PT)
    except Exception as e:
        failures.append((tex, str(e)[:120])); return m.group(0)
    n_display += 1
    svg = re.sub(r'width="[^"]+"', f'width="{w:.2f}px"', svg, count=1)
    svg = re.sub(r'height="[^"]+"', f'height="{h:.2f}px"', svg, count=1)
    return (f'<div class="math-display" role="img" aria-label="{tex}" data-tex="{tex}" '
            f'style="text-align:center;margin:10px 0 22px;overflow-x:auto">{svg}</div>')

def repl_inline(m):
    global n_inline
    tex = norm(m.group(1))
    try:
        svg, w, h, d = render(tex, INLINE_PT)
    except Exception as e:
        failures.append((tex, str(e)[:120])); return m.group(0)
    n_inline += 1
    svg = re.sub(r'width="[^"]+"', f'width="{w/REF_PX:.3f}em"', svg, count=1)
    svg = re.sub(r'height="[^"]+"', f'height="{h/REF_PX:.3f}em"', svg, count=1)
    svg = svg.replace("<svg ", f'<svg style="vertical-align:-{d/REF_PX:.3f}em;display:inline-block" ', 1)
    return f'<span class="math" role="img" aria-label="{tex}" data-tex="{tex}">{svg}</span>'

out = re.sub(r"\\\[(.+?)\\\]", repl_display, src, flags=re.S)
out = re.sub(r"\\\((.+?)\\\)", repl_inline, out, flags=re.S)
open("index.html", "w").write(out)
print(f"inline: {n_inline}, display: {n_display}, failures: {len(failures)}, size: {len(out)/1e6:.2f} MB")
for f in failures: print("  FAIL", f)
