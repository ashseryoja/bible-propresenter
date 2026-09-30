#!/usr/bin/env python3
"""Open the databases written by the website's JS exporter with the real SQLite and check them.

usage: validate_db.py DIR      (DIR = output of tests/test-export.js)
"""
import json, os, sqlite3, sys, zipfile

D = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
REF_DB = os.path.abspath(os.path.join(HERE, '..', '..', 'ararat-old', 'bible.db3'))
REF_DDL = os.path.abspath(os.path.join(HERE, '..', '..', 'ararat-old', 'tools', 'ddl_reference.json'))
ok = True


def check(cond, msg):
    global ok
    print(('PASS  ' if cond else 'FAIL  ') + msg)
    ok = ok and bool(cond)


def open_ro(p):
    return sqlite3.connect('file:%s?mode=ro' % p, uri=True)


def generic_checks(name, path):
    con = open_ro(path)
    check(con.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', f'{name}: PRAGMA integrity_check')
    check(con.execute('PRAGMA quick_check').fetchone()[0] == 'ok', f'{name}: PRAGMA quick_check')
    ddl = {r[0]: r[1] for r in con.execute('select name, sql from sqlite_master where sql is not null')}
    check(ddl == json.load(open(REF_DDL, encoding='utf-8')), f'{name}: schema identical to the module in use')
    check(con.execute('PRAGMA encoding').fetchone()[0] == 'UTF-8', f'{name}: UTF-8')
    check(con.execute('PRAGMA page_size').fetchone()[0] == 4096, f'{name}: page size 4096')
    check(con.execute('PRAGMA freelist_count').fetchone()[0] == 0, f'{name}: no free pages')
    size = os.path.getsize(path)
    check(size == con.execute('PRAGMA page_count').fetchone()[0] * 4096, f'{name}: file size = page_count * 4096')
    return con


def dump(con, expected):
    """Compare the plain tables and the Z tables with the expected structure."""
    rows = con.execute('select c.ZBOOK_INDEX, c.ZBOOK_NAME, b.ZCHAPTER_NUMBER, a.ZVERSE_NUMBER, a.ZVERSE_CONTENT from ZVERSE a '
                       'join ZCHAPTER b on a.ZTOCHAPTER=b.Z_PK join ZBOOK c on b.ZTOBOOK=c.Z_PK '
                       'order by c.ZBOOK_INDEX, b.ZCHAPTER_NUMBER, a.ZVERSE_NUMBER').fetchall()
    got = {}
    for bi, bn, ch, v, t in rows:
        got.setdefault(bi, {'name': bn, 'chapters': {}})['chapters'].setdefault(ch, []).append((v, t))
    exp_rows = 0
    good = True
    for b in expected:
        g = got.get(b['idx'])
        if not g or g['name'] != b['name'] or len(g['chapters']) != len(b['chapters']):
            good = False
            continue
        for ci, vs in enumerate(b['chapters'], 1):
            gv = g['chapters'].get(ci)
            exp = [(vi, t) for vi, t in enumerate(vs, 1)]
            exp_rows += len(exp)
            if gv != exp:
                good = False
    check(good and exp_rows == len(rows), 'content equals expectation (%d verses)' % exp_rows)
    plain = con.execute('select b.book_name, c.chapter_num, v.verse_num, v.content from verses v join chapters c on v.chapter_id=c.pk join books b on c.book_id=b.pk order by v.pk').fetchall()
    zed = con.execute('select c.ZBOOK_NAME, b.ZCHAPTER_NUMBER, a.ZVERSE_NUMBER, a.ZVERSE_CONTENT from ZVERSE a join ZCHAPTER b on a.ZTOCHAPTER=b.Z_PK join ZBOOK c on b.ZTOBOOK=c.Z_PK order by a.Z_PK').fetchall()
    check(plain == zed, 'plain tables mirror the Z tables')
    for tbl, col in (('ZBOOK', 'ZTOBIBLE'), ('ZCHAPTER', 'ZTOBOOK'), ('ZVERSE', 'ZTOCHAPTER')):
        n1 = con.execute(f'select count(*) from {tbl} indexed by {tbl}_{col}_INDEX where {col} is not null').fetchone()[0]
        n2 = con.execute(f'select count(*) from {tbl} where {col} is not null').fetchone()[0]
        check(n1 == n2, f'index {tbl}_{col}_INDEX covers all {n2} rows')
    pk = dict((r[0], r[1]) for r in con.execute('select Z_NAME, Z_MAX from Z_PRIMARYKEY'))
    check(pk == {'Bible': 1, 'Book': len(expected), 'Chapter': sum(len(b['chapters']) for b in expected), 'Verse': exp_rows}, 'Z_PRIMARYKEY counters')


# ---- baseline must reproduce the delivered module row for row ------------------------------------------------------
con = generic_checks('baseline', os.path.join(D, 'baseline.db3'))
ref = open_ro(REF_DB)
for tbl in ('books', 'chapters', 'verses', 'ZBOOK', 'ZCHAPTER', 'ZVERSE', 'Z_PRIMARYKEY', 'ZBIBLE'):
    a = con.execute(f'select * from {tbl} order by rowid').fetchall()
    b = ref.execute(f'select * from {tbl} order by rowid').fetchall()
    check(a == b, f'baseline: table {tbl} identical to the delivered module ({len(a)} rows)')
# index usage sanity through the query planner
plan = con.execute("explain query plan select * from ZVERSE where ZTOCHAPTER=5").fetchall()
check(any('ZVERSE_ZTOCHAPTER_INDEX' in str(r) for r in plan), 'query planner uses ZVERSE_ZTOCHAPTER_INDEX')
xml = open(os.path.join(D, 'baseline.xml'), encoding='utf-8').read()
check(xml == open(os.path.join(HERE, '..', '..', 'ararat-old', 'rvmetadata.xml'), encoding='utf-8').read(), 'baseline rvmetadata.xml identical to the delivered one')

# ---- edited / tiny / big -------------------------------------------------------------------------------------------
for name in ('edited', 'tiny', 'big'):
    con = generic_checks(name, os.path.join(D, name + '.db3'))
    dump(con, json.load(open(os.path.join(D, name + '.expected.json'), encoding='utf-8')))

# ---- zip -----------------------------------------------------------------------------------------------------------
z = zipfile.ZipFile(os.path.join(D, 'baseline.zip'))
check(z.testzip() is None, 'zip passes the CRC test')
check(sorted(z.namelist()) == ['README.txt', 'bible.db3', 'rvmetadata.xml'], 'zip entries: ' + ', '.join(z.namelist()))
open('/dev/null', 'wb')
check(z.read('bible.db3') == open(os.path.join(D, 'baseline.db3'), 'rb').read(), 'zip bible.db3 equals the standalone database')
check(z.read('rvmetadata.xml').decode('utf-8') == xml, 'zip rvmetadata.xml equals the standalone file')
print('zip:', os.path.getsize(os.path.join(D, 'baseline.zip')), 'bytes for', sum(i.file_size for i in z.infolist()), 'bytes unpacked')
print('\nOVERALL:', 'ALL CHECKS PASSED' if ok else 'PROBLEMS FOUND')
sys.exit(0 if ok else 1)
