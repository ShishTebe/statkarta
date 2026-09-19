// Подготовка пакета эталонных бланков (Фаза 1.6, шаг Ш-1).
// Бланки из «Помощник статкарточек/new_cards» (ф. 1.1 и ИПК пересохранены из .doc, ф. 3 из .xls
// нативными Word и Excel) переносятся в data/blanks/2026 (публикуются, ответ В-44): из них убираются напечатанные
// образцы заполнения (сведения реального дела, риск П-8) и считается контрольная сумма, которой
// потом проверяется, что заполняется именно этот бланк (FR-40, критерий A1.6-4).
//
// Запуск: node scripts/blanks/normalize.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readZip, entryText, replaceEntry, writeZip, sha256Hex } from '../../src/core/zip.mjs';
import { findTableCell, stripFragment, cellText } from '../../src/core/ooxml.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, '..', 'new_cards');
const OUT = path.join(ROOT, 'data/blanks/2026');

const BLANKS = [
  { form: '1', src: 'cards_1.docx', file: 'cards_1.docx' },
  { form: '1.1', src: 'cards_1.1.docx', file: 'cards_1.1.docx' },
  { form: '2', src: 'cards_2.docx', file: 'cards_2.docx' },
  { form: '2.1', src: 'cards_2.1-vml.docx', file: 'cards_2.1.docx' },
  { form: '3', src: 'cards_3.xlsx', file: 'cards_3.xlsx' },
  { form: '4', src: 'cards_4.docx', file: 'cards_4.docx' },
  { form: '5', src: 'cards_5.docx', file: 'cards_5.docx' },
  { form: '6', src: 'cards_6.docx', file: 'cards_6.docx' },
  { form: 'ipk', src: 'ИПК.docx', file: 'ipk.docx' },
  { form: 'ipk-in', src: 'ИПК иностранец.docx', file: 'ipk-in.docx' },
];

const scrub = JSON.parse(await readFile(path.join(ROOT, 'data-private/blanks-src/scrub-2026.json'), 'utf8'));
const out = [];

for (const blank of BLANKS) {
  const bytes = new Uint8Array(await readFile(path.join(SRC, blank.src)));
  const entries = readZip(bytes);
  const isWord = blank.file.endsWith('.docx');
  const part = isWord ? 'word/document.xml' : null;
  let cleaned = bytes;
  const removed = [];
  const rules = scrub.blanks[blank.src] ?? [];
  if (rules.length && !isWord) throw new Error(`Вычистка не поддержана для ${blank.src}`);
  const xrule = scrub.xlsx?.[blank.src];
  if (xrule) {
    // книга Excel: очистка ячеек с образцом значения и правка общих строк
    const sheetEntry = entries.find((e) => e.name === 'xl/worksheets/sheet1.xml');
    let sheet = await entryText(sheetEntry);
    for (const ref of xrule.clear_cells) {
      const re = new RegExp(`<c r="${ref}"((?:\\s[a-z]+="[^"]*")*)>[\\s\\S]*?</c>`);
      const m = re.exec(sheet);
      if (!m) throw new Error(`В ${blank.src} нет значения в ячейке ${ref}`);
      const attrs = m[1].replace(/\st="[^"]*"/, '');
      sheet = sheet.replace(m[0], `<c r="${ref}"${attrs}/>`);
      removed.push(ref);
    }
    await replaceEntry(entries, 'xl/worksheets/sheet1.xml', new TextEncoder().encode(sheet));
    const ssEntry = entries.find((e) => e.name === 'xl/sharedStrings.xml');
    let strings = await entryText(ssEntry);
    for (const { from, to } of xrule.strings) {
      if (!strings.includes(from)) throw new Error(`В ${blank.src} не найден образец «${from}»`);
      strings = strings.split(from).join(to);
      removed.push(from);
    }
    // выделение варианта в тексте ячейки (прогон общей строки с полужирным и подчеркиванием)
    for (const rule of xrule.unformat_runs ?? []) {
      const re = new RegExp(`<r>(<rPr>[\\s\\S]*?</rPr>)(<t[^>]*>${rule.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</t></r>)`);
      const m = re.exec(strings);
      if (!m) throw new Error(`В ${blank.src} не найдено выделение «${rule.text}»`);
      let rPr = m[1];
      for (const tag of rule.remove) rPr = rPr.split(tag).join('');
      strings = strings.replace(m[0], `<r>${rPr}${m[2]}`);
      removed.push(`выделение «${rule.text}»`);
    }
    for (const fragment of scrub.forbidden) {
      if (strings.includes(fragment)) throw new Error(`В ${blank.src} остался образец «${fragment}»`);
    }
    await replaceEntry(entries, 'xl/sharedStrings.xml', new TextEncoder().encode(strings));
    cleaned = writeZip(entries);
  }
  if (rules.length) {
    let xml = await entryText(entries.find((e) => e.name === part));
    for (const rule of rules) {
      for (const fragment of rule.remove) {
        const next = stripFragment(xml, findTableCell(xml, rule), fragment);
        if (next === null) throw new Error(`В ${blank.src} не найден образец «${fragment}» в ячейке ${rule.table}/${rule.row}/${rule.cell}`);
        xml = next;
        removed.push(fragment);
      }
      const rest = cellText(xml, rule);
      for (const fragment of rule.remove) {
        if (rest.includes(fragment)) throw new Error(`В ${blank.src} остался образец «${fragment}»`);
      }
    }
    // образец выбора вариантов выделением (полужирный с подчеркиванием) – выделение снимается
    const unformat = scrub.unformat?.[blank.src];
    if (unformat) {
      let count = 0;
      xml = xml.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (whole, inner) => {
        if (!unformat.runs_with_all.every((tag) => inner.includes(tag))) return whole;
        count += 1;
        let cleaned = inner;
        for (const tag of unformat.remove) cleaned = cleaned.split(tag).join('');
        return `<w:rPr>${cleaned}</w:rPr>`;
      });
      removed.push(...Array(count).fill('выделение образца'));
    }
    // выделение одного варианта (курсив и т. п.), найденного по тексту прогона
    for (const rule of scrub.unformat_text?.[blank.src] ?? []) {
      const at = xml.indexOf(`>${rule.text}<`);
      if (at < 0) throw new Error(`В ${blank.src} не найден выделенный образец «${rule.text}»`);
      const runStart = Math.max(xml.lastIndexOf('<w:r>', at), xml.lastIndexOf('<w:r ', at));
      let head = xml.slice(runStart, at);
      for (const tag of rule.remove) head = head.split(tag).join('');
      xml = xml.slice(0, runStart) + head + xml.slice(at);
      removed.push(`выделение «${rule.text}»`);
    }
    for (const fragment of scrub.forbidden) {
      if (xml.includes(fragment)) throw new Error(`В ${blank.src} остался запрещенный фрагмент «${fragment}»`);
    }
    await replaceEntry(entries, part, new TextEncoder().encode(xml));
    cleaned = writeZip(entries);
  }
  // свойства файла (автор, кто изменял, руководитель, организация) – персональные данные сотрудников,
  // в опубликованный бланк не попадают
  {
    const ents = readZip(cleaned);
    for (const name of ['docProps/core.xml', 'docProps/app.xml']) {
      const e = ents.find((x) => x.name === name);
      if (!e) continue;
      const xml = (await entryText(e))
        .replace(/<(dc:creator|cp:lastModifiedBy|cp:keywords|dc:description|cp:category|cp:contentStatus|Manager|Company|HyperlinkBase)>[^<]*<\/\1>/g, '<$1></$1>')
        .replace(/<cp:lastPrinted>[^<]*<\/cp:lastPrinted>/g, '')
        .replace(/<Template>[^<]*<\/Template>/g, '<Template>Normal.dotm</Template>');
      await replaceEntry(ents, name, new TextEncoder().encode(xml));
    }
    cleaned = writeZip(ents);
  }
  await writeFile(path.join(OUT, blank.file), cleaned);
  out.push({ form: blank.form, file: blank.file, source: blank.src, bytes: cleaned.length,
    sha256: await sha256Hex(cleaned), scrubbed: removed.length });
  console.log(`${blank.form}: ${blank.file}, ${cleaned.length} байт, образцов убрано ${removed.length}`);
}

const manifest = { version: '2026.1', built: new Date().toISOString().slice(0, 10),
  note: 'Эталонные бланки карточек без образцов заполнения и без свойств файла (автор и т. п.). Заполняются вставкой текста в существующие места по картам раскладки data/layout/2026. Публикуются по решению заказчика от 20.09.2026 (ответ В-44).',
  blanks: out };
await writeFile(path.join(OUT, 'blanks.json'), `${JSON.stringify(manifest, null, 1)}\n`);
console.log('пакет бланков собран:', path.relative(ROOT, OUT));
