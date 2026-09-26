// Сборка заполненного бланка .docx (Фаза 1.6, FR-40).
// Эталонный бланк не пересобирается: в нем меняется только word/document.xml, остальные части
// переносятся в новый файл сжатыми, байт в байт. Перед заполнением сверяется контрольная сумма
// бланка (критерий A1.6-4): если бланк не тот, файл не собирается.

import { readZip, entryText, replaceEntry, writeZip, sha256Hex } from './zip.mjs';
import { fillShapes, setCellText, setUnderscoreText, appendCellText, prependCellText, setBoxChars, replaceCaption, setCellParagraphText, stripFragment, findParagraph, replaceBlankText } from './ooxml.mjs';
import { setXlsxCell, setXlsxUnderscores, setXlsxCaption, XLSX_SHEET } from './xlsxfill.mjs';

export const CELL_FONT_HALF_POINTS = 16;   // 8 пунктов – как в клетках самого бланка

export async function checkBlank(bytes, layout) {
  const sha = await sha256Hex(bytes);
  if (layout.blank_sha256 && sha !== layout.blank_sha256) {
    throw new Error(`Бланк «${layout.blank}» отличается от того, по которому составлена карта раскладки`
      + ' – заполнение отменено. Обновите пакет бланков.');
  }
  return sha;
}

// Заполненный бланк: [{ shape, text }] – знаки в клетки, [{ place, text }] – значения в ячейки
// таблицы бланка (бланки ИПК); textEdits – [{ find, replace }] правки печатного текста для региона
// (regionBlankEdits): строка местных кодов бланка информационного центра другого региона.
export async function fillDocx(bytes, layout, edits, cellEdits = [], { textEdits = [] } = {}) {
  await checkBlank(bytes, layout);
  const entries = readZip(bytes);
  const edit = (xml) => textEdits.reduce((x, e) => replaceBlankText(x, e.find, e.replace) ?? x, xml);
  if (layout.kind === 'xlsx') {
    // ф. 3 – книга Excel: знаки в ячейки листа, текст – на линейки в тексте ячеек
    const sheetEntry = entries.find((e) => e.name === XLSX_SHEET);
    let sheet = await entryText(sheetEntry);
    const ssRaw = await entryText(entries.find((e) => e.name === 'xl/sharedStrings.xml'));
    const ss = edit(ssRaw);
    if (ss !== ssRaw) await replaceEntry(entries, 'xl/sharedStrings.xml', new TextEncoder().encode(ss));
    for (const e of edits) sheet = setXlsxCell(sheet, e.shape, e.text);
    for (const e of cellEdits) {
      sheet = e.mode === 'caption'
        ? setXlsxCaption(sheet, ss, e.place.cell, e.caption, e.text)
        : setXlsxUnderscores(sheet, ss, e.place.cell, e.text, { slot: e.place.slot ?? 0 });
    }
    await replaceEntry(entries, XLSX_SHEET, new TextEncoder().encode(sheet));
    return writeZip(entries);
  }
  const part = layout.part ?? 'word/document.xml';
  const entry = entries.find((e) => e.name === part);
  if (!entry) throw new Error(`В бланке нет части ${part}`);
  let xml = edit(await entryText(entry));
  if (edits.length) xml = fillShapes(xml, edits, { size: CELL_FONT_HALF_POINTS, force: true });
  // В одной ячейке места нумеруются подряд, а вписанный текст убирает подчеркивания –
  // поэтому места заполняются с конца ячейки, чтобы номера оставшихся не сдвигались.
  const key = (p) => [p.table ?? 999, p.row ?? 0, p.cell ?? 0];
  const ordered = [...cellEdits].sort((a, b) => (key(a.place)[0] - key(b.place)[0]) || (key(a.place)[1] - key(b.place)[1])
    || (key(a.place)[2] - key(b.place)[2]) || ((b.place.slot ?? 0) - (a.place.slot ?? 0)));
  for (const e of ordered) {
    if (e.mode === 'cell') xml = setCellText(xml, e.place, e.text, { size: e.size ?? null });
    else if (e.mode === 'append') xml = appendCellText(xml, e.place, e.text, { size: e.size ?? null });
    else if (e.mode === 'prepend') xml = prependCellText(xml, e.place, e.text, { size: e.size ?? null });
    else if (e.mode === 'boxes') xml = setBoxChars(xml, e.place, e.text, { slot: e.place.slot ?? 0 });
    else if (e.mode === 'caption') xml = replaceCaption(clearTexts(xml, e.clear), e.place, e.caption, e.text, { size: e.size ?? null });
    else if (e.mode === 'para') xml = setCellParagraphText(xml, e.place, e.place.para ?? 0, e.text, { size: e.size ?? null, font: e.font ?? null, replace: e.replace === true, align: e.align ?? null });
    else xml = setUnderscoreText(clearTexts(xml, e.clear), e.place, e.text, { slot: e.place.slot ?? 0, span: e.place.span ?? 1, boxes: Boolean(e.place.boxes), size: e.size ?? null });
  }
  await replaceEntry(entries, part, new TextEncoder().encode(xml));
  return writeZip(entries);
}

// Печатные надписи, которые заменяет вписанное значение (строки подписей: «Руководитель следственного органа,»)
function clearTexts(xml, fragments) {
  let out = xml;
  for (const f of fragments ?? []) out = stripFragment(out, findParagraph(out, f), f) ?? out;
  return out;
}

export function blankFileName(form, card, { ext = 'docx' } = {}) {
  const safe = (s) => String(s ?? '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  const parts = ['Форма', form];
  if (card?.title) parts.push(safe(card.title));
  return `${parts.join(' ')}.${ext}`;
}
