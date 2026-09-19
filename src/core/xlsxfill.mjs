// Заполнение ф. 3 в книге .xlsx (Фаза 1.6, FR-40; ИЦ принимает .xlsx – ответ от 16.09.2026).
// Значение вписывается в существующую ячейку листа как встроенная строка; стиль ячейки (рамка,
// шрифт) сохраняется, остальные части книги переносятся без изменений.

import { escapeXml } from './ooxml.mjs';

export const XLSX_SHEET = 'xl/worksheets/sheet1.xml';

function cellRe(ref) {
  return new RegExp(`<c r="${ref}"((?:\\s[a-z]+="[^"]*")*)\\s*(?:/>|>([\\s\\S]*?)</c>)`);
}

export function setXlsxCell(sheet, ref, text) {
  const m = cellRe(ref).exec(sheet);
  if (!m) throw new Error(`На листе нет ячейки ${ref}`);
  const attrs = m[1].replace(/\st="[^"]*"/, '');
  return sheet.replace(m[0], `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`);
}

// Текст ячейки с общей строкой (для линеек «____» в тексте листа)
export function xlsxCellText(sheet, sharedStrings, ref) {
  const m = cellRe(ref).exec(sheet);
  if (!m || !m[2]) return '';
  const v = /<v>([^<]*)<\/v>/.exec(m[2]);
  if (/\st="s"/.test(m[1]) && v) {
    const si = [...sharedStrings.matchAll(/<si>([\s\S]*?)<\/si>/g)][Number(v[1])]?.[1] ?? '';
    return [...si.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((x) => x[1]).join('');
  }
  const t = /<t(?:\s[^>]*)?>([^<]*)<\/t>/.exec(m[2]);
  return t ? t[1] : (v ? v[1] : '');
}

// Значение на линейку в тексте ячейки: подчеркивания заменяются по числу знаков
export function setXlsxUnderscores(sheet, sharedStrings, ref, value, { slot = 0 } = {}) {
  const text = xlsxCellText(sheet, sharedStrings, ref);
  const lines = [...text.matchAll(/_{3,}/g)];
  const line = lines[slot];
  if (!line) throw new Error(`В ячейке ${ref} нет линейки № ${slot + 1}`);
  const take = Math.min(value.length, line[0].length);
  const next = text.slice(0, line.index) + (/\s/.test(text[line.index - 1] ?? ' ') ? '' : ' ') + value
    + text.slice(line.index + take);
  return setXlsxCell(sheet, ref, next.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
}

