#!/usr/bin/env python3
"""Generate the site's text data from the module that was built for ProPresenter.

Source of truth: ../../ararat-old/bible.db3  (the delivered module, apostrophes already removed), so the site
shows exactly what the module contains and what an unedited export reproduces.

Writes
  data/index.js        book list, chapter verse counts, Russian names, notes      (loaded with <script>)
  data/bNN.js          one book each, as   AB.data[NN] = [[verse, ...], ...]     (loaded with <script>)
  data/json/bNN.json   the same as plain JSON                                     (used by the hosted build)
"""
import json, os, sqlite3, sys, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(os.path.join(HERE, '..'))
DB = os.path.abspath(os.path.join(SITE, '..', 'ararat-old', 'bible.db3'))

RU = [
 ('Бытие', 'Быт'), ('Исход', 'Исх'), ('Левит', 'Лев'), ('Числа', 'Чис'), ('Второзаконие', 'Втор'),
 ('Иисус Навин', 'Нав'), ('Судьи', 'Суд'), ('Руфь', 'Руф'), ('1 Царств', '1 Цар'), ('2 Царств', '2 Цар'),
 ('3 Царств', '3 Цар'), ('4 Царств', '4 Цар'), ('1 Паралипоменон', '1 Пар'), ('2 Паралипоменон', '2 Пар'),
 ('Ездра', 'Езд'), ('Неемия', 'Неем'), ('Есфирь', 'Есф'), ('Иов', 'Иов'), ('Псалтирь', 'Пс'), ('Притчи', 'Прит'),
 ('Екклесиаст', 'Екк'), ('Песнь Песней', 'Песн'), ('Исаия', 'Ис'), ('Иеремия', 'Иер'), ('Плач Иеремии', 'Плач'),
 ('Иезекииль', 'Иез'), ('Даниил', 'Дан'), ('Осия', 'Ос'), ('Иоиль', 'Иоил'), ('Амос', 'Ам'), ('Авдий', 'Авд'),
 ('Иона', 'Иона'), ('Михей', 'Мих'), ('Наум', 'Наум'), ('Аввакум', 'Авв'), ('Софония', 'Соф'), ('Аггей', 'Агг'),
 ('Захария', 'Зах'), ('Малахия', 'Мал'),
 ('От Матфея', 'Мф'), ('От Марка', 'Мк'), ('От Луки', 'Лк'), ('От Иоанна', 'Ин'), ('Деяния', 'Деян'),
 ('Римлянам', 'Рим'), ('1 Коринфянам', '1 Кор'), ('2 Коринфянам', '2 Кор'), ('Галатам', 'Гал'), ('Ефесянам', 'Еф'),
 ('Филиппийцам', 'Флп'), ('Колоссянам', 'Кол'), ('1 Фессалоникийцам', '1 Фес'), ('2 Фессалоникийцам', '2 Фес'),
 ('1 Тимофею', '1 Тим'), ('2 Тимофею', '2 Тим'), ('Титу', 'Тит'), ('Филимону', 'Флм'), ('Евреям', 'Евр'),
 ('Иакова', 'Иак'), ('1 Петра', '1 Пет'), ('2 Петра', '2 Пет'), ('1 Иоанна', '1 Ин'), ('2 Иоанна', '2 Ин'),
 ('3 Иоанна', '3 Ин'), ('Иуды', 'Иуд'), ('Откровение', 'Откр'),
]

# verses the reader should double-check against a printed Old Ararat (book index, chapter, verse) -> note
NOTES = {
    '24:50:41': 'Этих стихов нет ни на одном из онлайн-изданий. Текст восстановлен по прежнему модулю и переписан в старую орфографию — сверьте с печатной Библией.',
    '24:50:42': None, '24:50:43': None, '24:50:44': None, '24:50:45': None, '24:50:46': None,
}
NOTES = {k: (v or NOTES['24:50:41']) for k, v in NOTES.items()}


def main():
    con = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
    books = con.execute('select ZBOOK_INDEX, ZBOOK_NAME from ZBOOK order by ZBOOK_INDEX').fetchall()
    assert [b[0] for b in books] == list(range(1, 67))
    rows = con.execute(
        'select c.ZBOOK_INDEX, b.ZCHAPTER_NUMBER, a.ZVERSE_NUMBER, a.ZVERSE_CONTENT from ZVERSE a '
        'join ZCHAPTER b on a.ZTOCHAPTER=b.Z_PK join ZBOOK c on b.ZTOBOOK=c.Z_PK '
        'order by c.ZBOOK_INDEX, b.ZCHAPTER_NUMBER, a.ZVERSE_NUMBER').fetchall()
    data = {}
    for bi, ch, v, t in rows:
        chs = data.setdefault(bi, {})
        vs = chs.setdefault(ch, [])
        assert v == len(vs) + 1, (bi, ch, v)
        vs.append(t)
    os.makedirs(os.path.join(SITE, 'data', 'json'), exist_ok=True)

    index_books = []
    sha = hashlib.sha256()
    for bi, name in books:
        chs = [data[bi][c] for c in sorted(data[bi])]
        assert sorted(data[bi]) == list(range(1, len(chs) + 1))
        ru, ab = RU[bi - 1]
        index_books.append({'i': bi, 'hy': name, 'ru': ru, 'ab': ab, 'ot': 1 if bi <= 39 else 0,
                            'vs': [len(c) for c in chs]})
        blob = json.dumps(chs, ensure_ascii=False, separators=(',', ':'))
        sha.update(blob.encode('utf-8'))
        with open(os.path.join(SITE, 'data', 'b%02d.js' % bi), 'w', encoding='utf-8') as f:
            f.write('window.AB=window.AB||{};AB.data=AB.data||{};AB.data[%d]=%s;\n' % (bi, blob))
        with open(os.path.join(SITE, 'data', 'json', 'b%02d.json' % bi), 'w', encoding='utf-8') as f:
            f.write(blob)
    index = {'version': 'ararat-1896:' + sha.hexdigest()[:12], 'books': index_books, 'notes': NOTES}
    with open(os.path.join(SITE, 'data', 'index.js'), 'w', encoding='utf-8') as f:
        f.write('window.AB=window.AB||{};AB.index=%s;\n' % json.dumps(index, ensure_ascii=False, separators=(',', ':')))
    print('books', len(books), 'chapters', sum(len(b['vs']) for b in index_books),
          'verses', sum(sum(b['vs']) for b in index_books), 'version', index['version'])


if __name__ == '__main__':
    main()
