#!/usr/bin/env python3
"""Writes tests/shared.html: the site wired to the Firestore stand-in in tests/mock-sdk (no Firebase project needed).
usage: python3 tests/make_shared_page.py   then serve the site folder and open /tests/shared.html in two tabs."""
import os, re
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, '..', 'index.html'), encoding='utf-8').read()
src = src.replace('src="js/', 'src="../js/').replace('src="data/', 'src="../data/').replace('href="css/', 'href="../css/')
src = re.sub(r"<script>\s*// firebase: null.*?</script>",
             "<script>window.AB = { config: { dataMode: 'script', dataBase: '../data/', firebase: { app: { projectId: 'mock' }, sdkBase: '/tests/mock-sdk/' } } };</script>",
             src, count=1, flags=re.S)
assert 'sdkBase' in src
src = src.replace('<title>Армянская Библия</title>', '<title>Армянская Библия (тест общей версии)</title>')
with open(os.path.join(HERE, 'shared.html'), 'w', encoding='utf-8') as f:
    f.write(src)
print('tests/shared.html written')
