// Адреса ячеек таблиц бланка (Фаза 1.6, сверка карт раскладки ИПК).
// В каждую пустую ячейку вписывается ее адрес «таблица.строка.ячейка» мелким шрифтом – по печати
// видно, в какую ячейку впечатывать значение реквизита.
//
// Запуск: node scripts/blanks/cellmap.mjs <бланк.docx> <куда.docx>
import { readFile, writeFile } from 'node:fs/promises';
import { readZip, entryText, replaceEntry, writeZip } from '../../src/core/zip.mjs';
import { findTableCell, cellText, elementRange } from '../../src/core/ooxml.mjs';

const [src, dst] = process.argv.slice(2);
const entries = readZip(new Uint8Array(await readFile(src)));
let xml = await entryText(entries.find((e) => e.name === 'word/document.xml'));

// перечень ячеек: обход таблиц и строк по порядку
const cells = [];
for (let t = 0; ; t += 1) {
  try { findTableCell(xml, { table: t, row: 0, cell: 0 }); } catch { break; }
  for (let r = 0; ; r += 1) {
    try { findTableCell(xml, { table: t, row: r, cell: 0 }); } catch { break; }
    for (let c = 0; ; c += 1) {
      try { findTableCell(xml, { table: t, row: r, cell: c }); } catch { break; }
      cells.push({ table: t, row: r, cell: c });
    }
  }
}
// правка с конца, чтобы позиции предыдущих ячеек не сдвигались
let n = 0;
for (const p of cells.reverse()) {
  if (cellText(xml, p).replace(/[\s_]/g, '')) continue;
  const tc = findTableCell(xml, p);
  const body = xml.slice(tc.inner[0], tc.inner[1]);
  const at = body.lastIndexOf('</w:p>');
  if (at < 0) continue;
  const label = `<w:r><w:rPr><w:color w:val="C00000"/><w:sz w:val="9"/></w:rPr><w:t>${p.table}.${p.row}.${p.cell}</w:t></w:r>`;
  xml = xml.slice(0, tc.inner[0] + at) + label + xml.slice(tc.inner[0] + at);
  n += 1;
}
await replaceEntry(entries, 'word/document.xml', new TextEncoder().encode(xml));
await writeFile(dst, writeZip(entries));
console.log(`ячеек подписано: ${n}`);
