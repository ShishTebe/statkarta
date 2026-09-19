// Контрольное заполнение бланка по карте раскладки (Фаза 1.6, проверка шага Ш-3).
// В клетки каждого реквизита вписывается его номер по кругу: у реквизита 20.1 – «2 0 1 2 0 1 …».
// Файл печатается в PDF нативным Word и сверяется глазами с напечатанными номерами бланка.
//
// Запуск: node scripts/blanks/testfill.mjs <карта.json> <куда.docx>
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readZip, entryText, replaceEntry, writeZip } from '../../src/core/zip.mjs';
import { fillShapes } from '../../src/core/ooxml.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [mapPath, dst] = process.argv.slice(2);
const layout = JSON.parse(await readFile(mapPath, 'utf8'));
const entries = readZip(new Uint8Array(await readFile(path.join(ROOT, 'data/blanks/2026', layout.blank))));
let xml = await entryText(entries.find((e) => e.name === layout.part));

const edits = [];
for (const field of layout.fields) {
  const digits = field.requisite.replace(/\D/g, '') || '0';
  let i = 0;
  for (const group of field.groups) {
    for (const shape of group) {
      edits.push({ shape, text: digits[i % digits.length] });
      i += 1;
    }
  }
}
xml = fillShapes(xml, edits, { size: 12, force: true });
const cells = edits.length;
await replaceEntry(entries, layout.part, new TextEncoder().encode(xml));
await writeFile(dst, writeZip(entries));
console.log(`заполнено клеток: ${cells}`);
