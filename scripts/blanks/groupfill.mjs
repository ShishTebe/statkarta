// Разметка групп клеток для сверки карты раскладки (Фаза 1.6).
// В клетки каждой группы реквизита вписывается буква группы (a, b, c …), а в файл рядом –
// перечень «реквизит → группы (буква, число клеток, первая фигура)». По печати видно, какая группа
// к какому месту бланка относится, и ее можно перенести в исправлениях карты.
//
// Запуск: node scripts/blanks/groupfill.mjs <карта.json> <куда.docx>
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
const lines = [];
for (const field of layout.fields) {
  const parts = field.groups.map((g, gi) => {
    const letter = 'abcdefghijklmnopqrstuvwxyz'[gi];
    for (const shape of g) edits.push({ shape, text: letter });
    return `${letter}${g.length}@${g[0]}`;
  });
  lines.push(`${field.requisite}: ${parts.join(' ')}`);
}
xml = fillShapes(xml, edits, { size: 12, force: true });
await replaceEntry(entries, layout.part, new TextEncoder().encode(xml));
await writeFile(dst, writeZip(entries));
await writeFile(dst.replace(/\.docx$/, '.txt'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
