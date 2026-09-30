/*
 * Builds the files ProPresenter needs from the edited text: bible.db3 + rvmetadata.xml (+ a README), as one .zip.
 * `books` is always the complete Bible: [{idx, name, chapters:[[verse, ...], ...]}] for idx 1..66.
 */
(function () {
  'use strict';
  const AB = (globalThis.AB = globalThis.AB || {});

  const DEFAULT_META = { name: 'Armenian Old Ararat', abbr: 'ARARAT', slotAbbr: 'ACV' };
  const ALLOWED = /^[Ա-Ֆա-ֆև\s,.։\-()\[\]«»…՛՜՝՞՚]+$/;
  const MAX_VERSE_BYTES = 3800;    // a row has to fit into one 4 KiB database page

  function xmlEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function cleanText(t) {
    return String(t).replace(/\s+/g, ' ').trim();
  }

  /** Same layout as the rvmetadata.xml that ships with the current module (no comments: they crash ProPresenter on macOS). */
  function metadataXml(meta) {
    const m = Object.assign({}, DEFAULT_META, meta);
    return '<?xml version="1.0" encoding="utf-8" standalone="no"?>\n<RVBibleMetdata>\n' +
      '    <name>' + xmlEscape(m.name) + '</name>\n' +
      '    <abbreviation>' + xmlEscape(m.slotAbbr) + '</abbreviation>\n' +
      '    <displayAbbreviation>' + xmlEscape(m.abbr) + '</displayAbbreviation>\n' +
      '    <version>1</version>\n    <revision>1</revision>\n    <licenseType>0</licenseType>\n' +
      '    <license>Public Domain</license>\n</RVBibleMetdata>';
  }

  function readmeText(meta, stats, date) {
    const m = Object.assign({}, DEFAULT_META, meta);
    const d = date.toISOString().slice(0, 10);
    return [
      'Библия «' + m.name + '» для ProPresenter',
      'Создано: ' + d + ' · книг: ' + stats.books + ', глав: ' + stats.chapters + ', стихов: ' + stats.verses,
      '',
      'В архиве:',
      '  bible.db3        база Библии',
      '  rvmetadata.xml   название и сокращение',
      '',
      'Как установить (так же, как вы ставили прежний модуль):',
      '  1. Закройте ProPresenter.',
      '  2. Найдите папку установленной Библии «A Conservative Version» (ACV).',
      '     Windows: C:\\ProgramData\\RenewedVision\\ProPresenter\\Bibles\\<папка ACV>',
      '     (имя папки записано в файле BibleData.proPref в этой же папке).',
      '  3. Замените в ней bible.db3 и rvmetadata.xml файлами из этого архива.',
      '  4. Откройте ProPresenter — в списке Библий появится «' + m.name + '».',
      '',
      'Совет: перед заменой сохраните копии старых файлов.',
      '',
    ].join('\n');
  }

  /** Checks the whole Bible before export. errors block the export, warnings only inform. */
  function validate(books, meta) {
    const errors = [];
    const warnings = [];
    const stats = { books: 0, chapters: 0, verses: 0 };
    const m = Object.assign({}, DEFAULT_META, meta);
    if (!cleanText(m.name)) errors.push({ code: 'meta-name', text: 'Не заполнено название Библии.' });
    if (!cleanText(m.abbr)) errors.push({ code: 'meta-abbr', text: 'Не заполнено сокращение.' });
    if (!cleanText(m.slotAbbr)) errors.push({ code: 'meta-slot', text: 'Не заполнено сокращение установленной Библии (ACV).' });
    if (books.length !== 66) errors.push({ code: 'books', text: 'Ожидается 66 книг, найдено ' + books.length + '.' });
    const enc = new TextEncoder();
    for (const b of books) {
      stats.books += 1;
      if (!cleanText(b.name)) errors.push({ code: 'book-name', book: b.idx, text: 'У книги №' + b.idx + ' нет названия.' });
      if (!b.chapters.length) errors.push({ code: 'book-empty', book: b.idx, text: 'В книге «' + b.name + '» нет глав.' });
      b.chapters.forEach((verses, ci) => {
        stats.chapters += 1;
        if (!verses.length) errors.push({ code: 'chapter-empty', book: b.idx, chapter: ci + 1, text: b.name + ' ' + (ci + 1) + ': в главе нет стихов.' });
        verses.forEach((t, vi) => {
          stats.verses += 1;
          const ref = { book: b.idx, chapter: ci + 1, verse: vi + 1 };
          const s = cleanText(t);
          if (!s) errors.push(Object.assign({ code: 'verse-empty', text: b.name + ' ' + (ci + 1) + ':' + (vi + 1) + ': пустой стих.' }, ref));
          else if (enc.encode(s).length > MAX_VERSE_BYTES) errors.push(Object.assign({ code: 'verse-long', text: b.name + ' ' + (ci + 1) + ':' + (vi + 1) + ': стих слишком длинный для базы ProPresenter.' }, ref));
          else if (!ALLOWED.test(s)) warnings.push(Object.assign({ code: 'verse-chars', text: b.name + ' ' + (ci + 1) + ':' + (vi + 1) + ': есть необычные символы (не армянские буквы и не знаки препинания).' }, ref));
        });
      });
    }
    if (/[^\x20-\x7e]/.test(m.abbr)) warnings.push({ code: 'abbr-nonascii', text: 'Сокращение лучше писать латиницей.' });
    return { errors, warnings, stats };
  }

  /** @returns {{db:Uint8Array, xml:string, stats:object}} */
  function buildModule(books, meta) {
    const m = Object.assign({}, DEFAULT_META, meta);
    const clean = books.map((b) => ({
      idx: b.idx,
      name: cleanText(b.name),
      chapters: b.chapters.map((vs) => vs.map(cleanText)),
    }));
    const report = validate(clean, m);
    if (report.errors.length) {
      const e = new Error(report.errors[0].text);
      e.report = report;
      throw e;
    }
    const db = AB.sqlite.buildModuleDb(clean, { name: cleanText(m.name), slotAbbr: cleanText(m.slotAbbr) });
    return { db, xml: metadataXml({ name: cleanText(m.name), abbr: cleanText(m.abbr), slotAbbr: cleanText(m.slotAbbr) }), stats: report.stats, warnings: report.warnings };
  }

  /** The finished download: one zip with bible.db3, rvmetadata.xml and README.txt. */
  async function buildZip(books, meta, date) {
    const when = date || new Date();
    const built = buildModule(books, meta);
    const enc = new TextEncoder();
    const bytes = await AB.zip.makeZip([
      { name: 'bible.db3', data: built.db },
      { name: 'rvmetadata.xml', data: enc.encode(built.xml) },
      { name: 'README.txt', data: enc.encode(readmeText(meta, built.stats, when)) },
    ], { date: when });
    const stamp = when.toISOString().slice(0, 10);
    return { bytes, filename: 'ararat-propresenter-' + stamp + '.zip', stats: built.stats, warnings: built.warnings, dbSize: built.db.length };
  }

  AB.exporter = { DEFAULT_META, validate, buildModule, buildZip, metadataXml, readmeText, cleanText };
})();
