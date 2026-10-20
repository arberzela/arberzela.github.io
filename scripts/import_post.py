"""Import a standalone blog post (index.html produced by build_math.py) into the site.

Usage: python3 scripts/import_post.py <index.html> <src/content/blog/<slug>/body.html> [media-list.txt]

Keeps the <body> content, turns the post's header/main/footer into plain containers (the site
layout provides those landmarks), rewrites media/ paths to /blog/<slug>/media/, wraps the results
table for horizontal scrolling and trims matplotlib metadata from the pre-rendered formulas.
"""
import re, sys, pathlib
src = pathlib.Path(sys.argv[1]).read_text()
out = pathlib.Path(sys.argv[2])
m = re.search(r"<body>(.*)</body>", src, re.S)
body = m.group(1)
# The site layout already provides header/main/footer landmarks; turn the post's into plain containers.
body = body.replace('<header class="hero">', '<div class="hero">', 1).replace('</header>', '</div>', 1)
body = body.replace('<main>', '<div class="post-body">', 1).replace('</main>', '</div>', 1)
body = body.replace('<footer>', '<div class="post-footer">', 1).replace('</footer>', '</div>', 1)
# Media now lives under the site's public folder.
slug = out.parent.name
body = body.replace('src="media/', f'src="/blog/{slug}/media/')
# The arXiv identifier is known now.
body = body.replace('<a href="#">Paper (arXiv)</a>', '<a href="https://arxiv.org/abs/2610.25646" target="_blank" rel="noopener">Paper (arXiv)</a>')
body = body.replace('<a href="https://github.com/arberzela/sfprm">Code</a>', '<a href="https://github.com/arberzela/sfprm" target="_blank" rel="noopener">Code</a>')
body = body.replace('arXiv:XXXX.XXXXX', 'arXiv:2610.25646')
# Wide results table scrolls horizontally on phones.
body = body.replace('<table class="results">', '<div class="table-scroll"><table class="results">').replace('</table>', '</table></div>')
# Trim per-formula matplotlib metadata and the repeated global <style> (replaced by one rule in post.scss).
body = re.sub(r"\s*<metadata>.*?</metadata>", "", body, flags=re.S)
body = re.sub(r'\s*<defs>\s*<style type="text/css">\*\{stroke-linejoin: round; stroke-linecap: butt\}</style>\s*</defs>', "", body)
# The pre-rendered <svg> ends with a newline before </span>, which rendered as a stray space before punctuation.
body = re.sub(r"</svg>\s*</span>", "</svg></span>", body)
body = re.sub(r"</svg>\s*</div>", "</svg></div>", body)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(body.strip() + "\n")
print(f"{len(src)} -> {len(body)} bytes; formulas: {body.count('class=\"math\"')} inline, {body.count('class=\"math-display\"')} display")
refs = sorted(set(re.findall(rf'/blog/{slug}/media/([^"]+)', body)))
print("media refs:", len(refs))
if len(sys.argv) > 3:
    pathlib.Path(sys.argv[3]).write_text("\n".join(refs) + "\n")
