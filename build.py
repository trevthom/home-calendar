#!/usr/bin/env python3
"""
build.py — produce dist/index.html, a single self-contained file that runs
without a server (just open it in any browser, including mobile Safari/Chrome).

Inlines:
  - every <link rel="stylesheet"> as a <style> block
  - every <script type="module" src="…"> as one inline script with all modules
    concatenated in dependency order (imports/exports stripped)

Run:
    python3 build.py
"""

from pathlib import Path
import re

ROOT = Path(__file__).parent
SRC_HTML = ROOT / "index.html"
OUT_DIR = ROOT / "dist"
OUT_HTML = OUT_DIR / "index.html"

# Concatenation order matters: a module must come after everything it uses.
JS_ORDER = [
    "js/utils.js",
    "js/session.js",
    "js/storage.js",
    "js/sync.js",
    "js/state.js",
    "js/events.js",
    "js/ics.js",
    "js/modal.js",
    "js/dayModal.js",
    "js/grid.js",
    "js/upcoming.js",
    "js/countdown.js",
    "js/sidebar.js",
    "js/login.js",
    "js/app.js",
]

# Patterns that strip ES module syntax. We keep the *bodies* of declarations.
RE_IMPORT      = re.compile(r'^\s*import\s+[^;]+?;\s*$', re.M)
RE_EXPORT_DECL = re.compile(r'^(\s*)export\s+(default\s+)?(?=(function|class|const|let|var|async))', re.M)
RE_EXPORT_LIST = re.compile(r'^\s*export\s*\{[^}]*\}\s*;?\s*$', re.M)


def strip_module_syntax(code: str) -> str:
    code = RE_IMPORT.sub("", code)
    code = RE_EXPORT_LIST.sub("", code)
    # `export function foo` -> `function foo` ; same for const/let/class/async
    code = RE_EXPORT_DECL.sub(r'\1', code)
    return code


def inline_css(html: str) -> str:
    """Replace <link rel="stylesheet" href="..."> with inline <style>."""
    pattern = re.compile(
        r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*/?>',
        re.IGNORECASE,
    )
    def repl(m):
        path = ROOT / m.group(1)
        css = path.read_text(encoding="utf-8")
        return f"<style>\n/* === {m.group(1)} === */\n{css}\n</style>"
    return pattern.sub(lambda m: repl(m), html)


def inline_js(html: str) -> str:
    """Replace the module <script> tag with one inline non-module script."""
    chunks = []
    for rel in JS_ORDER:
        path = ROOT / rel
        body = strip_module_syntax(path.read_text(encoding="utf-8"))
        chunks.append(f"// === {rel} ===\n{body.strip()}\n")
    bundle = "\n".join(chunks)

    # Wrap in IIFE to avoid leaking names to window
    inline = f"<script>\n(function(){{\n'use strict';\n{bundle}\n}})();\n</script>"

    # Replace the original module script tag (with or without type="module")
    pattern = re.compile(
        r'<script\s+type="module"\s+src="[^"]+"\s*></script>',
        re.IGNORECASE,
    )
    # Use a lambda so backslashes in `inline` aren't interpreted as regex refs.
    return pattern.sub(lambda _m: inline, html)


def main():
    OUT_DIR.mkdir(exist_ok=True)
    html = SRC_HTML.read_text(encoding="utf-8")
    html = inline_css(html)
    html = inline_js(html)
    OUT_HTML.write_text(html, encoding="utf-8")
    size_kb = OUT_HTML.stat().st_size / 1024
    print(f"✓ Built {OUT_HTML}  ({size_kb:.1f} KB)")
    print("  Open it directly in any browser — no server needed.")


if __name__ == "__main__":
    main()
