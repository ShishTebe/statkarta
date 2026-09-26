// Аудит публичных пакетов (риск П-1, критерий A0-9): признаки реальных дел и персональных данных.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, walk } from './lib-data.mjs';
import { readZip, entryText } from '../src/core/zip.mjs';

const RULES = [
  { name: 'номер уголовного дела (11–13 или 17 цифр подряд)', rx: /(?<![\d.])(?:\d{17}|\d{11,13})(?![\d.])/g },
  { name: 'Фамилия И.О.', rx: /[А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ]\.\s?[А-ЯЁ]\./g },
  { name: 'И.О. Фамилия', rx: /(?<![А-ЯЁа-яё])[А-ЯЁ]\.\s?[А-ЯЁ]\.\s?[А-ЯЁ][а-яё]{2,}/g },
  { name: 'дата рождения', rx: /\d{2}\.\d{2}\.(19|20)\d{2}\s*(г\.\s*)?р\./g },
  { name: 'паспорт', rx: /паспорт\w*\s*(серии|№)\s*\d/giu },
  { name: 'телефон', rx: /(\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g },
];
const files = [...walk('data'), ...walk('tests'), ...walk('docs')].filter((f) => !f.includes('/schema/') && !f.endsWith('manifest.json'));
// Образец заполнения из эталонного бланка ИПК (риск П-8): список фрагментов хранится только в data-private
const scrubFile = path.join(ROOT, 'data-private/blanks-src/scrub.json');
const scrub = fs.existsSync(scrubFile) ? JSON.parse(fs.readFileSync(scrubFile, 'utf8')).fragments : [];
// Вымышленный набор Фазы 2: ФИО допустимы, только если заданы в генераторе; номера генерируются им же
const FICTION_DIRS = ['tests/fixtures/vud/', 'tests/fixtures/docs/'];
const fiction = ['scripts/fixtures/make-vud-corpus.mjs', 'scripts/fixtures/make-docs-corpus.mjs']
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const fictional = (h) => fiction.includes(h.split(/\s+/)[0].replace(/\./g, '')) || fiction.includes(h.replace(/.*\s/, ''));
let total = 0;
for (const f of files) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const r of RULES) {
    // коды ОКАТО (11 разрядов) – открытый классификатор, не номера дел
    if (f.endsWith('okato.json') && r.name.startsWith('номер уголовного дела')) continue;
    // пакет региона: проверяется часть, внесенная вручную (местные коды, строка бланка, источники); ОКАТО –
    // открытые данные Росстата (коды из 11 цифр, названия населенных пунктов «им. В.И. Ленина»)
    const src = f.startsWith('data/regions/') && !f.endsWith('index.json') ? JSON.stringify({ ...JSON.parse(t), okato: undefined }) : t;
    let hits = [...new Set(src.match(r.rx) ?? [])];
    // ОКАТО тестового профиля органа в эталонном деле
    if (r.name.startsWith('номер уголовного дела')) hits = hits.filter((h) => !t.includes(`"okato": "${h}"`));
    // образцы номера с девятью и более нулями подряд (12602300000000001) – заведомо не номера дел
    if (r.name.startsWith('номер')) hits = hits.filter((h) => !/0{9}/.test(h));
    if (FICTION_DIRS.some((d) => f.startsWith(d))) hits = hits.filter((h) => !(['номер', 'телефон'].some((x) => r.name.startsWith(x)) || fictional(h)));
    if (hits.length) { total += hits.length; console.log(`${f}: ${r.name}: ${hits.slice(0, 8).join('; ')}${hits.length > 8 ? ' …' : ''}`); }
  }
}
for (const f of files) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  // ОКАТО в пакетах регионов – открытые данные Росстата: отдельное слово образца может совпасть с названием
  // населенного пункта; такие совпадения не считаются, фрагменты из нескольких слов проверяются
  const leaked = scrub.filter((x) => t.includes(x) && !(f.startsWith('data/regions/') && !/\s/.test(x.trim())));
  if (leaked.length) { total += leaked.length; console.log(`${f}: образец заполнения бланка ИПК: ${leaked.length} фрагм.`); }
}
// Адреса электронной почты (ответ В-71): адрес для писем с замечаниями в открытые файлы не попадает –
// он подставляется при сборке из секрета; допустимы только служебные и вымышленные адреса
const MAIL_OK = /@(users\.noreply\.github\.com|anthropic\.com|example\.(org|com))$/i;
const feedbackToFile = path.join(ROOT, 'data-private/feedback-to.txt');
const feedbackTo = fs.existsSync(feedbackToFile) ? fs.readFileSync(feedbackToFile, 'utf8').trim().toLowerCase() : '';
const walkAll = (dir) => (fs.existsSync(path.join(ROOT, dir)) ? fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? (e.name === '__pycache__' ? [] : walkAll(path.posix.join(dir, e.name))) : [path.posix.join(dir, e.name)])) : []);
const codeFiles = [...files, ...walkAll('src'), ...walkAll('scripts'), ...walkAll('.github'), 'README.md', 'CLA.md', 'package.json']
  .filter((f) => /\.(mjs|js|json|md|yml|yaml|py|html|css|txt)$/.test(f) && fs.existsSync(path.join(ROOT, f)));
for (const f of [...new Set(codeFiles)]) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const mails = [...new Set(t.match(/[\w.+-]+@[\w-]+\.[\w.-]*[a-z]/gi) ?? [])].filter((m) => !MAIL_OK.test(m));
  if (feedbackTo && t.toLowerCase().includes(feedbackTo)) { total++; console.log(`${f}: адрес для писем с замечаниями`); }
  if (mails.length) { total += mails.length; console.log(`${f}: адрес электронной почты: ${mails.length}`); }
}
// Опубликованные бланки (ответ В-44): текст без образцов и Ф.И.О., свойства файла без автора и организации
const office = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory()
  ? office(path.posix.join(dir, e.name)) : /\.(docx|xlsx)$/.test(e.name) ? [path.posix.join(dir, e.name)] : []));
for (const f of office('data')) {
  const entries = readZip(new Uint8Array(fs.readFileSync(path.join(ROOT, f))));
  let text = '';
  for (const e of entries.filter((x) => /^(word\/(document|header\d*|footer\d*|comments|people)\.xml|xl\/sharedStrings\.xml|xl\/worksheets\/sheet\d+\.xml)$/.test(x.name))) {
    text += ` ${(await entryText(e)).replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')}`;
  }
  const hits = [...new Set([...text.matchAll(RULES[1].rx), ...text.matchAll(RULES[2].rx)].map((m) => m[0]))].filter((h) => !/Ф\.И/.test(h));
  const leaked = scrub.filter((x) => text.includes(x));
  const props = [];
  for (const e of entries.filter((x) => /^docProps\/(core|app)\.xml$/.test(x.name))) {
    for (const m of (await entryText(e)).matchAll(/<(dc:creator|cp:lastModifiedBy|Manager|Company)>([^<]+)</g)) props.push(`${m[1]}=${m[2]}`);
  }
  const n = hits.length + leaked.length + props.length;
  if (n) { total += n; console.log(`${f}: бланк: ${[...hits, ...props].join('; ')}${leaked.length ? `; образцов ${leaked.length}` : ''}`); }
}
if (!scrub.length) console.log('список образцов бланка ИПК не подключен (data-private) – проверка образцов пропущена');
console.log(`файлов проверено: ${files.length}; находок: ${total}`);
process.exit(0);
