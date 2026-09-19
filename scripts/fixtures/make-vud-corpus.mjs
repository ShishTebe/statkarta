// Тестовый набор Фазы 2 (A2-1, A2-2): вымышленные постановления о возбуждении уголовного дела,
// составленные по строению бланков СК 3.01s, 3.02s, 3.04s. Все лица, адреса и номера вымышлены.
// Запуск: node scripts/fixtures/make-vud-corpus.mjs → tests/fixtures/vud/*.txt|.docx + *.gold.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipFiles } from '../../src/core/zip.mjs';
import { escapeXml } from '../../src/core/ooxml.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'tests/fixtures/vud');

// детерминированный генератор случайных чисел (одинаковый набор при каждом запуске)
let seed = 20260920;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const pad = (n) => String(n).padStart(2, '0');
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const TOWNS = [['г. Энск', 'город Энск'], ['г. Северогорск', 'город Северогорск'], ['пгт Озерный', 'поселок Озерный'], ['г. Приморск', 'город Приморск']];
const ORGANS = [
  ['Следователь', 'следственного отдела по городу Энску следственного управления Следственного комитета Российской Федерации по Условной области', 'лейтенант юстиции', 'Кораблев Д.С.'],
  ['Старший следователь', 'Северогорского межрайонного следственного отдела следственного управления Следственного комитета Российской Федерации по Условной области', 'капитан юстиции', 'Лаптева О.Н.'],
  ['Следователь по особо важным делам', 'следственного отдела по Приморскому району следственного управления Следственного комитета Российской Федерации по Условной области', 'майор юстиции', 'Вершинин К.А.'],
  ['Руководитель', 'следственного отдела по Озерному району следственного управления Следственного комитета Российской Федерации по Условной области', 'подполковник юстиции', 'Громов А.Е.'],
];
// лица: именительный и родительный падеж, дата рождения, есть ли анкета в описательной части
const PERSONS = [
  { nom: ['Сомов', 'Игорь', 'Петрович'], gen: ['Сомова', 'Игоря', 'Петровича'], birth: '1987-03-14' },
  { nom: ['Белкина', 'Анна', 'Викторовна'], gen: ['Белкиной', 'Анны', 'Викторовны'], birth: '1992-11-02' },
  { nom: ['Жуковский', 'Олег', 'Андреевич'], gen: ['Жуковского', 'Олега', 'Андреевича'], birth: '1979-06-30' },
  { nom: ['Тарасюк', 'Николай', 'Юрьевич'], gen: ['Тарасюка', 'Николая', 'Юрьевича'], birth: '2001-01-19' },
  { nom: ['Ремезов', 'Сергей', 'Ильич'], gen: ['Ремезова', 'Сергея', 'Ильича'], birth: '1968-09-08' },
  { nom: ['Цой', 'Виктория', 'Олеговна'], gen: ['Цой', 'Виктории', 'Олеговны'], birth: '1995-04-21' },
  { nom: ['Мельниченко', 'Петр', 'Борисович'], gen: ['Мельниченко', 'Петра', 'Борисовича'], birth: '1983-12-12' },
  { nom: ['Гусейнов', 'Рамиль', 'Алиевич'], gen: ['Гусейнова', 'Рамиля', 'Алиевича'], birth: '1990-07-07' },
];
// потерпевшие: именительный и дательный падеж
const VICTIMS = [
  { nom: ['Зайцев', 'Артем', 'Олегович'], dat: ['Зайцеву', 'Артему', 'Олеговичу'], fem: false, birth: '1975-02-11' },
  { nom: ['Кравцова', 'Елена', 'Игоревна'], dat: ['Кравцовой', 'Елене', 'Игоревне'], fem: true, birth: '1966-08-23' },
  { nom: ['Полянский', 'Григорий', 'Львович'], dat: ['Полянскому', 'Григорию', 'Львовичу'], fem: false, birth: '1958-10-01' },
  { nom: ['Юдина', 'Мария', 'Сергеевна'], dat: ['Юдиной', 'Марии', 'Сергеевне'], fem: true, birth: '2003-05-15' },
];
// состав: запись в постановлении (варианты) и эталон (статья/части/пункты)
const CRIMES = [
  { texts: ['п. «в» ч. 2 ст. 158', 'пункта «в» части 2 статьи 158', 'п."в" ч.2 ст.158'], key: '158/2/в', story: 'тайно похитил имущество потерпевшего', damage: true },
  { texts: ['ч. 1 ст. 105', 'части 1 статьи 105', 'ч.1 ст.105'], key: '105/1/', story: 'на почве личных неприязненных отношений нанес потерпевшему не менее пяти ударов ножом, причинив смерть', damage: false },
  { texts: ['ч. 3 ст. 159', 'части 3 статьи 159'], key: '159/3/', story: 'путем обмана похитил денежные средства потерпевшего', damage: true },
  { texts: ['ч. 3 ст. 30, ч. 1 ст. 105', 'ч. 3 ст. 30, части 1 статьи 105'], key: '30/3/;105/1/', story: 'пытался причинить смерть потерпевшему, однако преступление не было доведено до конца по независящим от него обстоятельствам', damage: false },
  { texts: ['ч. 4 ст. 111', 'части 4 статьи 111'], key: '111/4/', story: 'умышленно причинил тяжкий вред здоровью потерпевшего, повлекший по неосторожности его смерть', damage: false },
  { texts: ['пп. «а», «в» ч. 2 ст. 158', 'пунктов «а», «в» части 2 статьи 158'], key: '158/2/а,в', story: 'группой лиц по предварительному сговору тайно похитил имущество потерпевшего', damage: true },
  { texts: ['ч. 1 ст. 293', 'части 1 статьи 293'], key: '293/1/', story: 'вследствие недобросовестного отношения к службе не исполнил обязанности по контролю за состоянием жилого дома', damage: true },
  { texts: ['ч. 5 ст. 290', 'части 5 статьи 290'], key: '290/5/', story: 'лично получил взятку в виде денег за совершение действий в пользу взяткодателя', damage: false },
  { texts: ['ч. 1 ст. 318', 'части 1 статьи 318'], key: '318/1/', story: 'применил насилие, не опасное для жизни или здоровья, в отношении представителя власти в связи с исполнением им должностных обязанностей', damage: false },
  { texts: ['ч. 2 ст. 228', 'части 2 статьи 228'], key: '228/2/', story: 'незаконно хранил без цели сбыта наркотическое средство в крупном размере', damage: false },
];
const STREETS = ['ул. Садовая, д. 12, кв. 5', 'ул. Лесная, д. 3а', 'пр. Мира, д. 101, корп. 2, кв. 17', 'ул. Портовая, д. 8', 'пер. Тихий, д. 4, кв. 1'];
const SOURCES = [
  ['report', (org) => `рапортом ${org} об обнаружении признаков преступления`],
  ['statement', () => 'заявлением гражданина о преступлении'],
  ['confession', () => 'явкой с повинной'],
  ['prosecutor_materials', () => 'из прокуратуры Условной области с постановлением заместителя прокурора о направлении материалов в следственный орган для решения вопроса об уголовном преследовании'],
];

function dateWords(iso, style) {
  const [y, m, d] = iso.split('-').map(Number);
  if (style === 0) return `${pad(d)} ${MONTHS_GEN[m - 1]} ${y} года`;
  if (style === 1) return `«${pad(d)}» ${MONTHS_GEN[m - 1]} ${y} г.`;
  return `${pad(d)}.${pad(m)}.${y}`;
}
const ru = (iso) => iso.split('-').reverse().join('.');
const isoPlus = (iso, days) => new Date(Date.parse(iso) + days * 864e5).toISOString().slice(0, 10);
const money = (n, style) => (style ? `${n.toLocaleString('ru-RU').replace(/\s/g, ' ')} рублей` : `${n} руб.`);

function makeDoc(i) {
  const blank = i % 6 === 5 ? '3.02' : i % 6 === 4 ? '3.04' : '3.01';
  const [town, townLong] = pick(TOWNS);
  const organ = blank === '3.02' ? ORGANS[3] : pick(ORGANS.slice(0, 3));
  const vudDate = `2026-${pad(1 + Math.floor(rnd() * 8))}-${pad(1 + Math.floor(rnd() * 27))}`;
  const hh = Math.floor(rnd() * 24);
  const mm = pick([0, 15, 30, 45, 5]);
  const caseNo = `126${String(Math.floor(rnd() * 1e5)).padStart(5, '0')}000${String(1000 + i * 37).padStart(6, '0')}`.slice(0, 17);
  const kuspNo = pick([`${100 + i * 7}пр-26`, `${20 + i}пр/1-26`, `${3 + i}`, `${55 + i}/12`]);
  const kuspDate = isoPlus(vudDate, -Math.floor(rnd() * 5));
  const source = i % 5 === 4 ? null : SOURCES[i % 4];
  const nEp = i % 7 === 3 ? 3 : i % 3 === 2 ? 2 : 1;
  const plural = nEp > 1 && i % 2 === 0; // несколько статей в одном пункте «преступлений»
  const crimes = [];
  for (let k = 0; k < nEp; k++) crimes.push(CRIMES[(i * 3 + k * 5) % CRIMES.length]);
  const mode = i % 4 === 1 ? 'unknown' : i % 4 === 3 ? 'fact' : 'person';
  const person = mode === 'person' ? PERSONS[i % PERSONS.length] : null;
  const anketa = person && i % 3 !== 1;
  const crimeDate = isoPlus(vudDate, -(3 + Math.floor(rnd() * 200)));
  const crimeTime = `${pad(Math.floor(rnd() * 24))}:${pick(['00', '20', '40'])}`;
  const addr = `${pick(['Условная область', 'Условная обл.'])}, ${town}, ${pick(STREETS)}`;
  const withAddr = i % 5 !== 2;
  const hasDamage = crimes.some((c) => c.damage) && i % 4 !== 2;
  const dmg = 1000 * (5 + Math.floor(rnd() * 900)) + pick([0, 0, 500]);
  const dstyle = i % 3;
  const est = i % 4 === 2 ? 'У С Т А Н О В И Л :' : 'УСТАНОВИЛ:';
  const dec = i % 4 === 2 ? 'П О С Т А Н О В И Л :' : 'ПОСТАНОВИЛ:';
  const [pos, unit, rank, fio] = organ;

  const lines = [];
  if (blank === '3.04') lines.push('ПОСТАНОВЛЕНИЕ', `о возбуждении уголовного дела № ${caseNo}`, 'и направлении его прокурору для направления по подследственности');
  else if (blank === '3.02') lines.push('ПОСТАНОВЛЕНИЕ', 'о возбуждении уголовного дела');
  else lines.push('ПОСТАНОВЛЕНИЕ', `о возбуждении уголовного дела №${i % 2 ? ' ' : ''}${caseNo}`, 'и принятии его к производству');
  lines.push(`${i % 2 ? townLong : town}\t${dateWords(vudDate, dstyle)}`);
  lines.push(pick([`${hh} часов ${pad(mm)} минут`, `${pad(hh)} ч ${pad(mm)} мин`, `«${pad(hh)}» час. «${pad(mm)}» мин.`, `${pad(hh)}:${pad(mm)}`]));
  const quals0 = crimes.map((c) => pick(c.texts));
  const krsp = pick([
    `зарегистрированное в КРСП № ${kuspNo} от ${ru(kuspDate)}`,
    `зарегистрированное в книге регистрации сообщений о преступлениях ${unit.split(' ')[0] === 'следственного' ? 'следственного отдела' : 'отдела'} за № ${kuspNo} от ${ru(kuspDate)}`,
    `(КРСП № ${kuspNo} от ${ru(kuspDate)})`,
  ]);
  const srcText = source ? `, поступившее ${source[1](`${pos.toLowerCase()} ${unit}`)}` : '';
  lines.push(`${pos} ${unit} ${rank} ${fio}, рассмотрев сообщение о преступлении, предусмотренном ${quals0[0]} УК РФ${srcText}, ${krsp}, и материалы проверки,`);
  lines.push(est);
  // описательная часть: отвлекающие даты (закон, дата рождения) идут раньше даты совершения только в анкете
  const who = person ? (anketa ? `${person.nom.join(' ')}, ${ru(person.birth)} года рождения` : `${person.nom[0]} ${person.nom[1][0]}.${person.nom[2][0]}.`) : 'Неустановленное лицо';
  if (i % 6 === 0) lines.push('В соответствии со ст. 14 Федерального закона от 06.10.2003 № 131-ФЗ «Об общих принципах организации местного самоуправления в Российской Федерации» к вопросам местного значения относится обеспечение безопасности жителей.');
  const when = pick([`${ru(crimeDate)} в ${Number(crimeTime.slice(0, 2))} часов ${crimeTime.slice(3)} минут`, `${ru(crimeDate)} около ${crimeTime.slice(0, 2)}:${crimeTime.slice(3)}`, `${dateWords(crimeDate, 0)}, примерно в ${Number(crimeTime.slice(0, 2))} час. ${crimeTime.slice(3)} мин.`]);
  const where = withAddr ? `, находясь по адресу: ${addr},` : ', находясь на территории Условной области,';
  lines.push(`${when} ${who}${where} ${crimes[0].story}${hasDamage ? `, причинив ${pick(['значительный материальный ущерб', 'материальный ущерб', 'ущерб'])} на сумму ${money(dmg, i % 2)}` : ''}`.replace(/\.?$/, '.'));
  for (const c of crimes.slice(1)) lines.push(`Кроме того, ${who.split(',')[0]} ${c.story}.`);
  const victim = i % 3 === 0 ? VICTIMS[(i / 3) % VICTIMS.length] : null;
  if (victim) {
    lines.push(i % 2
      ? `Потерпевш${victim.fem ? 'ая' : 'ий'} ${victim.nom.join(' ')}, ${ru(victim.birth)} года рождения, обратил${victim.fem ? 'ась' : 'ся'} с заявлением о преступлении.`
      : `В результате потерпевш${victim.fem ? 'ей' : 'ему'} ${victim.dat.join(' ')} причинен вред.`);
  }
  if (source?.[0] === 'confession') lines.push('Поводом для возбуждения уголовного дела является явка с повинной, основанием – достаточные данные, указывающие на признаки преступления.');
  lines.push(`Принимая во внимание, что имеются достаточные данные, указывающие на признаки ${nEp > 1 ? 'преступлений' : 'преступления'}, руководствуясь ст. 140, 145, 146 и ч. 1 ст. 156 УПК РФ,`);
  lines.push(dec);
  const whom = mode === 'person' ? `, в отношении ${person.gen.join(' ')}, ${ru(person.birth)} года рождения` : mode === 'unknown' ? ', в отношении неустановленного лица' : '';
  let n = 1;
  const numbered = plural || nEp > 1 || i % 2 === 1;
  const num = () => (numbered ? `${n++}. ` : '');
  if (plural) {
    lines.push(`${num()}Возбудить уголовное дело по признакам преступлений, предусмотренных ${quals0.join(', ')} УК РФ${whom}.`);
  } else {
    for (const q of quals0) lines.push(`${numbered ? `${n++}. ` : ''}Возбудить уголовное дело по признакам преступления, предусмотренного ${q} УК РФ${whom}.`);
  }
  if (blank === '3.02') lines.push(`${num()}Производство предварительного следствия поручить следователю ${ORGANS[0][1]} ${ORGANS[0][2]} ${ORGANS[0][3]}`);
  else lines.push(`${num()}Уголовное дело принять к своему производству и приступить к расследованию.`);
  lines.push(`${num()}Копию настоящего постановления направить прокурору Условной области.`);
  lines.push(pos, unit.split(' ').slice(0, 3).join(' '), `${rank}\t${fio.split(' ').reverse().join(' ')}`);

  const gold = {
    case_number: blank === '3.02' ? null : caseNo,
    vud_date: vudDate,
    kusp: kuspNo, kusp_date: kuspDate,
    report_source: source ? source[0] : null,
    investigator: `${pos} ${unit} ${rank} ${fio}`,
    qualifications: crimes.map((c) => c.key),
    persons: person ? [{ surname: person.nom[0], first_name: person.nom[1], patronymic: person.nom[2], birth: person.birth }] : [],
    suspect_known: Boolean(person),
    crime_date: crimeDate,
    crime_place: withAddr ? addr : null,
    damage_amount: hasDamage ? String(dmg) : null,
    victims: victim ? [{ surname: victim.nom[0], first_name: victim.nom[1], patronymic: victim.nom[2] }] : [],
  };
  return { text: lines.join('\n'), gold, blank };
}

// Документы другого вида – программа должна отказать
const OTHER = [
  'ПОСТАНОВЛЕНИЕ\nо назначении судебно-медицинской экспертизы\nг. Энск\t12 марта 2026 года\nСледователь следственного отдела по городу Энску, рассмотрев материалы уголовного дела № 12600000000000001,\nУСТАНОВИЛ:\nВ производстве находится уголовное дело.\nПОСТАНОВИЛ:\nНазначить экспертизу.',
  'ПОСТАНОВЛЕНИЕ\nоб отказе в возбуждении уголовного дела\nг. Северогорск\t03 апреля 2026 года\nСтарший следователь, рассмотрев сообщение о преступлении, зарегистрированное в КРСП № 77пр-26 от 01.04.2026,\nУСТАНОВИЛ:\nПризнаков преступления не усматривается.\nПОСТАНОВИЛ:\nОтказать в возбуждении уголовного дела по признакам преступления, предусмотренного ч. 1 ст. 158 УК РФ.',
  'ПОСТАНОВЛЕНИЕ\nо признании потерпевшим\nг. Приморск\t20 мая 2026 года\nСледователь, рассмотрев материалы уголовного дела,\nУСТАНОВИЛ:\nПреступлением причинен вред.\nПОСТАНОВИЛ:\nПризнать потерпевшим.',
];

// .docx: каждый абзац делится на несколько прогонов, как это делает Word
function docxBytes(text) {
  const paras = text.split('\n').map((line) => {
    const parts = line.split('\t').map((seg) => {
      const runs = seg.match(/.{1,37}(\s|$)|.{1,37}/g) ?? [''];
      return runs.map((r) => `<w:r><w:rPr><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">${escapeXml(r)}</w:t></w:r>`).join('');
    });
    return `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${parts.join('<w:r><w:tab/></w:r>')}</w:p>`;
  }).join('');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}<w:sectPr/></w:body></w:document>`;
  const enc = (s) => new TextEncoder().encode(s);
  return zipFiles([
    { name: '[Content_Types].xml', bytes: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: '_rels/.rels', bytes: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { name: 'word/document.xml', bytes: enc(doc) },
  ]);
}

// Windows-1251 для кириллицы (проверка определения кодировки .txt)
function cp1251(text) {
  const out = [];
  for (const chr of text) {
    const c = chr.codePointAt(0);
    if (c < 128) out.push(c);
    else if (c >= 0x410 && c <= 0x44f) out.push(c - 0x410 + 0xc0);
    else if (c === 0x401) out.push(0xa8);
    else if (c === 0x451) out.push(0xb8);
    else if (c === 0xab) out.push(0xab);
    else if (c === 0xbb) out.push(0xbb);
    else if (c === 0x2116) out.push(0xb9);
    else if (c === 0x2013) out.push(0x96);
    else out.push(0x3f);
  }
  return Uint8Array.from(out);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const index = [];
for (let i = 0; i < 24; i++) {
  const { text, gold, blank } = makeDoc(i);
  const id = `vud-${pad(i + 1)}`;
  const format = i % 3 === 0 ? 'docx' : i % 3 === 1 ? 'txt' : 'txt1251';
  const file = `${id}.${format === 'docx' ? 'docx' : 'txt'}`;
  const bytes = format === 'docx' ? await docxBytes(text) : format === 'txt' ? new TextEncoder().encode(text) : cp1251(text);
  fs.writeFileSync(path.join(OUT, file), bytes);
  fs.writeFileSync(path.join(OUT, `${id}.gold.json`), `${JSON.stringify({ file, blank, format, ...gold }, null, 1)}\n`);
  index.push(file);
}
OTHER.forEach((t, k) => {
  const file = `other-${pad(k + 1)}.txt`;
  fs.writeFileSync(path.join(OUT, file), t);
  index.push(file);
});
// вставка текста – тот же текст, что в первом постановлении, без файла
fs.writeFileSync(path.join(OUT, 'README.md'), '# Тестовый набор Фазы 2\n\nВымышленные постановления о возбуждении уголовного дела по строению бланков СК 3.01s, 3.02s, 3.04s. Все лица, адреса, номера вымышлены. Файлы создает `node scripts/fixtures/make-vud-corpus.mjs`; руками не править. `*.gold.json` – эталон ответов; `other-*` – документы другого вида.\n');
console.log(`набор: ${index.length} файлов в ${path.relative(ROOT, OUT)}`);
