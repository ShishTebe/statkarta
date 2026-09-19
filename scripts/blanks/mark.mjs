// Разметка эталонного бланка (Фаза 1.6, вспомогательный шаг Ш-3).
// В каждое пустое место бланка вписывается короткая метка. Размеченный файл печатается в PDF
// нативным Word, после чего scripts/blanks/read_marks.py по расположению меток узнает, какому
// реквизиту принадлежит каждое место файла. Так карта раскладки строится из самого бланка,
// а не из догадок о порядке фигур.
//
// Запуск: node scripts/blanks/mark.mjs <бланк.docx> <куда.docx> <куда-метки.json>
import { readFile, writeFile } from 'node:fs/promises';
import { readZip, entryText, replaceEntry, writeZip } from '../../src/core/zip.mjs';
import { shapes, shapeText, fillShapes } from '../../src/core/ooxml.mjs';

// Метка – ровно два знака: строчная латинская буква и буква или цифра (26 × 62 = 1612 меток).
// Трехзначные метки в узкой клетке переносились, и обломок читался как чужая двузначная метка.
const FIRST = 'abcdefghijklmnopqrstuvwxyz';
const SECOND = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function marker(i) {
  if (i >= FIRST.length * SECOND.length) throw new Error('Мест в бланке больше, чем меток');
  return `${FIRST[Math.floor(i / SECOND.length)]}${SECOND[i % SECOND.length]}`;
}

const [src, dst, mapPath, cellsPath] = process.argv.slice(2);
if (!src || !dst || !mapPath) {
  console.error('Запуск: node scripts/blanks/mark.mjs <бланк.docx> <куда.docx> <метки.json> [клетки.json]');
  process.exit(1);
}
// Список мест задается снаружи (scripts/blanks/build_layout.py считает клетки по размеру):
// помечать все подряд нельзя – в бланке есть рисунки и рамки, надпись в них Word не принимает.
const only = cellsPath ? new Set(JSON.parse(await readFile(cellsPath, 'utf8'))) : null;

const entries = readZip(new Uint8Array(await readFile(src)));
const doc = entries.find((e) => e.name === 'word/document.xml');
let xml = await entryText(doc);

const edits = [];
const marks = [];
for (const shape of shapes(xml)) {
  if (only && !only.has(shape.index)) continue;       // вне списка мест
  if (shape.picture) continue;                        // рисунки бланка (герб, штрих-код) не трогаем
  if (shapeText(xml, shape.index) !== '') continue;   // места с печатным текстом бланка не трогаем
  const mark = marker(marks.length);
  edits.push({ shape: shape.index, text: mark });
  marks.push({ mark, shape: shape.index, id: shape.id, spid: shape.spid });
}
xml = fillShapes(xml, edits, { size: 8, force: true });

// У размеченной копии убираются отступы надписей, иначе метка из двух знаков переносится
// на вторую строку и читается как два отдельных слова. Эталонный бланк этим не затрагивается.
xml = xml.replace(/inset="[^"]*"/g, 'inset="0,0,0,0"');

await replaceEntry(entries, 'word/document.xml', new TextEncoder().encode(xml));
await writeFile(dst, writeZip(entries));
await writeFile(mapPath, JSON.stringify({ blank: src, marks }, null, 1));
console.log(`мест помечено: ${marks.length}`);
