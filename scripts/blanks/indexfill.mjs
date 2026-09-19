// Номера фигур в клетках бланка (Фаза 1.6, сверка карты раскладки).
// В каждую клетку из диапазона вписываются две последние цифры ее номера – по печати видно,
// какая фигура где стоит, и исправления карты можно писать номерами без догадок.
//
// Запуск: node scripts/blanks/indexfill.mjs <бланк.docx> <куда.docx> <с> <по>
import { readFile, writeFile } from 'node:fs/promises';
import { readZip, entryText, replaceEntry, writeZip } from '../../src/core/zip.mjs';
import { shapes, fillShapes } from '../../src/core/ooxml.mjs';

const [src, dst, from, to] = process.argv.slice(2);
const entries = readZip(new Uint8Array(await readFile(src)));
let xml = await entryText(entries.find((e) => e.name === 'word/document.xml'));
const edits = shapes(xml)
  .filter((s) => s.index >= Number(from) && s.index <= Number(to) && !s.picture && !s.fallback)
  .map((s) => ({ shape: s.index, text: String(s.index % 100).padStart(2, '0') }));
xml = fillShapes(xml, edits, { size: 8, force: true }).replace(/inset="[^"]*"/g, 'inset="0,0,0,0"');
await replaceEntry(entries, 'word/document.xml', new TextEncoder().encode(xml));
await writeFile(dst, writeZip(entries));
console.log(`пронумеровано фигур: ${edits.length}`);
