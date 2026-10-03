#!/usr/bin/env python3
"""Builds the version of the site that is published as a claude.ai Artifact.

Output (in dist/):
  artifact.html          one HTML fragment: <title>, fonts, <style> (all CSS), markup, one <script> (all JS)
  host-test/index.html   the same fragment inside a full page with a fake `window.claude` (tests/host-mock.js),
                         for trying the hosted code paths locally
  host-test/data         symlink to data/json (the book files that the hosted page loads with fetch)

The Artifact tool publishes artifact.html as the page and data/json/bNN.json as `data/bNN.json` (see files.json).
usage: python3 tools/build_artifact.py
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(os.path.join(HERE, '..'))
DIST = os.path.join(SITE, 'dist')

FONTS = ('https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700'
         '&family=Noto+Serif+Armenian:wght@400;500;600&family=Noto+Sans+Armenian:wght@400;500;600&display=swap')
TITLE = 'Армянская Библия'

# order matters: every file may use what the earlier ones define
JS_ORDER = ['fold', 'sqlite-writer', 'zip', 'exporter', 'platform', 'store', 'data', 'i18n', 'refs',
            'ui', 'view-nav', 'view-edit', 'view-tools', 'app']

MARKUP = '''<div id="app">
  <aside id="sidebar" aria-label="Книги и главы"></aside>
  <div id="main">
    <header id="topbar"></header>
    <main id="reader" tabindex="-1"></main>
    <nav id="pager" aria-label="Переход между главами"></nav>
  </div>
</div>
<div id="overlay"></div>
<div id="toasts" role="status" aria-live="polite"></div>'''


def read(*parts):
    with open(os.path.join(SITE, *parts), encoding='utf-8') as f:
        return f.read()


def build_script():
    chunks = ["window.AB = { config: { dataMode: 'fetch', dataBase: 'data/' } };"]
    chunks.append(read('data', 'index.js').strip())          # book list, verse counts, notes (about 12 KB)
    for name in JS_ORDER:
        chunks.append('/* ---- %s.js ---- */\n' % name + read('js', name + '.js').strip())
    script = '\n;\n'.join(chunks)
    if re.search(r'</script', script, re.I) or '<!--' in script:
        raise SystemExit('the script contains a sequence that would end the <script> block early')
    return script


def build_fragment():
    css = read('css', 'app.css').strip()
    if re.search(r'</style', css, re.I):
        raise SystemExit('css contains </style')
    return '\n'.join([
        '<title>%s</title>' % TITLE,
        '<link rel="preconnect" href="https://fonts.googleapis.com">',
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
        '<link rel="stylesheet" href="%s">' % FONTS,
        '<style>', css, '</style>',
        MARKUP,
        '<script>', build_script(), '</script>',
        '',
    ])


def main():
    os.makedirs(DIST, exist_ok=True)
    fragment = build_fragment()
    with open(os.path.join(DIST, 'artifact.html'), 'w', encoding='utf-8') as f:
        f.write(fragment)

    # a full page with a fake viewer runtime, for local tests of the hosted paths
    test_dir = os.path.join(DIST, 'host-test')
    os.makedirs(test_dir, exist_ok=True)
    mock = read('tests', 'host-mock.js')
    page = ('<!doctype html><html><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
            'body{margin:0;font:14px system-ui,sans-serif;background:#fafafa}img{max-width:100%}[hidden]{display:none!important}</style>'
            '</head><body><script>' + mock + '</script>' + fragment + '</body></html>')
    with open(os.path.join(test_dir, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(page)
    link = os.path.join(test_dir, 'data')
    if not os.path.islink(link):
        if os.path.exists(link):
            raise SystemExit(link + ' exists and is not a symlink')
        os.symlink(os.path.join('..', '..', 'data', 'json'), link)

    # what the Artifact tool has to publish next to the page
    files = {'data/b%02d.json' % i: 'data/json/b%02d.json' % i for i in range(1, 67)}
    with open(os.path.join(DIST, 'files.json'), 'w', encoding='utf-8') as f:
        json.dump(files, f, indent=1)

    print('artifact.html: %d bytes; %d data files; test page: dist/host-test/index.html' % (len(fragment.encode('utf-8')), len(files)))


if __name__ == '__main__':
    main()
