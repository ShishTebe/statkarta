// Тестовый набор Фазы 3 (A3-2): вымышленные постановления других видов по строению бланков СК
// (16.1s, 15.04s, 21.01s, 21.14s, 22.01s, 4.01s). Все лица, адреса и номера вымышлены.
// Запуск: node scripts/fixtures/make-docs-corpus.mjs → tests/fixtures/docs/*.txt + *.gold.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'tests/fixtures/docs');

let seed = 20260921;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const ru = (iso) => iso.split('-').reverse().join('.');
const words = (iso) => { const [y, m, d] = iso.split('-'); return `${d} ${MONTHS[Number(m) - 1]} ${y} года`; };

const ORGAN = 'следственного отдела по городу Энску следственного управления Следственного комитета Российской Федерации по Условной области';
const WHO = [['Следователь', 'лейтенант юстиции', 'Кораблев Д.С.'], ['Старший следователь', 'капитан юстиции', 'Лаптева О.Н.'], ['Следователь по особо важным делам', 'майор юстиции', 'Вершинин К.А.']];
const PERSONS = [
  { nom: ['Сомов', 'Игорь', 'Петрович'], gen: ['Сомова', 'Игоря', 'Петровича'], acc: ['Сомова', 'Игоря', 'Петровича'], birth: '1987-03-14' },
  { nom: ['Белкина', 'Анна', 'Викторовна'], gen: ['Белкиной', 'Анны', 'Викторовны'], acc: ['Белкину', 'Анну', 'Викторовну'], birth: '1992-11-02' },
  { nom: ['Жуковский', 'Олег', 'Андреевич'], gen: ['Жуковского', 'Олега', 'Андреевича'], acc: ['Жуковского', 'Олега', 'Андреевича'], birth: '1979-06-30' },
  { nom: ['Тарасюк', 'Николай', 'Юрьевич'], gen: ['Тарасюка', 'Николая', 'Юрьевича'], acc: ['Тарасюка', 'Николая', 'Юрьевича'], birth: '2001-01-19' },
];
const VICTIMS = [
  { nom: ['Зайцев', 'Артем', 'Олегович'], acc: ['Зайцева', 'Артема', 'Олеговича'], birth: '1975-02-11' },
  { nom: ['Кравцова', 'Елена', 'Игоревна'], acc: ['Кравцову', 'Елену', 'Игоревну'], birth: '1966-08-23' },
];
const QUALS = [
  { text: 'п. «в» ч. 2 ст. 158', key: '158/2/в' },
  { text: 'ч. 4 ст. 111', key: '111/4/' },
  { text: 'ч. 3 ст. 159', key: '159/3/' },
  { text: 'ч. 1 ст. 293', key: '293/1/' },
];
// основания приостановления: пункт ч. 1 ст. 208 УПК РФ → код реквизита 12 ф. 3
const SUSPEND = [
  { pt: '1', code: '3', text: 'лицо, подлежащее привлечению в качестве обвиняемого, не установлено' },
  { pt: '2', code: '1', text: 'обвиняемый скрылся от следствия, место его нахождения не установлено' },
  { pt: '3', code: '4', text: 'место нахождения обвиняемого известно, однако реальная возможность его участия в деле отсутствует' },
  { pt: '4', code: '2', text: 'обвиняемый временно тяжело болен, что удостоверено медицинским заключением' },
];
// основания прекращения → код реквизита 13 ф. 3 и вид основания
const TERMINATE = [
  { cite: 'п. 1 ч. 1 ст. 24 УПК РФ', code: '12', kind: 'rehab', text: 'отсутствие события преступления' },
  { cite: 'п. 2 ч. 1 ст. 24 УПК РФ', code: '13', kind: 'rehab', text: 'отсутствие в деянии состава преступления' },
  { cite: 'п. 3 ч. 1 ст. 24 УПК РФ', code: '52', kind: 'non_rehab', text: 'истечение сроков давности уголовного преследования' },
  { cite: 'ст. 25 УПК РФ', code: '09', kind: 'non_rehab', text: 'примирение сторон' },
  { cite: 'ст. 28 УПК РФ', code: '07', kind: 'non_rehab', text: 'деятельное раскаяние' },
];
// возобновление: по ранее приостановленному (пункт ст. 208) или по ранее прекращенному делу
const RESUME = [
  { pt: '1', code: '04' }, { pt: '2', code: '02' }, { pt: '3', code: '05' }, { pt: '4', code: '03' }, { pt: null, code: '01' },
];

const caseNo = (i) => `126${String(10000 + i * 137).slice(0, 5)}000${String(100000 + i * 7).slice(0, 6)}`.slice(0, 17);
const isoPlus = (iso, days) => new Date(Date.parse(iso) + days * 864e5).toISOString().slice(0, 10);

function head(lines, title, sub, town, date, who) {
  lines.push('ПОСТАНОВЛЕНИЕ', title);
  if (sub) lines.push(sub);
  lines.push(`${town}\t${date}`);
  lines.push(`${who[0]} ${ORGAN} ${who[1]} ${who[2]}, рассмотрев материалы уголовного дела`);
}

function makeDoc(type, i) {
  const who = WHO[i % WHO.length];
  const town = pick(['г. Энск', 'г. Северогорск', 'пгт Озерный']);
  const date = `2026-${pad(1 + (i % 9))}-${pad(2 + (i % 26))}`;
  const no = caseNo(i);
  const dateStr = i % 2 ? words(date) : ru(date);
  const lines = [];
  const gold = { doc_type: type, case_number: no, doc_date: date, persons: [], victims: [], qualifications: [] };
  if (type === 'charge') {
    const p = PERSONS[i % PERSONS.length];
    const q = QUALS[i % QUALS.length];
    head(lines, 'о привлечении в качестве обвиняемого', null, town, dateStr, who);
    lines[lines.length - 1] += ` № ${no},`;
    lines.push('УСТАНОВИЛ:');
    lines.push(`${p.nom.join(' ')}, ${ru(p.birth)} года рождения, совершил преступление при следующих обстоятельствах.`);
    lines.push('На основании изложенного, руководствуясь ст. 171, 172 УПК РФ,');
    lines.push('ПОСТАНОВИЛ:');
    lines.push(`Привлечь ${p.acc.join(' ')}, ${ru(p.birth)} года рождения, уроженца Условной области, в качестве обвиняемого по данному уголовному делу, предъявив ему обвинение в совершении преступления, предусмотренного ${q.text} УК РФ, о чем ему объявить.`);
    gold.persons = [{ surname: p.nom[0], first_name: p.nom[1], patronymic: p.nom[2], birth: p.birth }];
    gold.qualifications = [q.key];
    gold.event = 'ev.person_identified';
  } else if (type === 'extend') {
    const months = pick([3, 4, 6, 9, 12]);
    const until = isoPlus(date, months * 30);
    head(lines, 'о возбуждении ходатайства о продлении срока предварительного следствия', null, town, dateStr, who);
    lines[lines.length - 1] += ` № ${no},`;
    lines.push('УСТАНОВИЛ:');
    lines.push('Закончить расследование к установленному сроку не представляется возможным: необходимо выполнить ряд следственных действий.');
    lines.push('На основании изложенного, руководствуясь ст. 162 УПК РФ,');
    lines.push('ПОСТАНОВИЛ:');
    lines.push(`Возбудить ходатайство перед руководителем следственного органа о продлении срока предварительного следствия по уголовному делу № ${no} до ${pad(months)} месяцев 00 суток, то есть по ${words(until)}.`);
    gold.extend = { months, until, code: months <= 3 ? '1' : months <= 6 ? '2' : months <= 12 ? '3' : '4' };
    gold.event = 'ev.extend';
  } else if (type === 'suspend') {
    const g = SUSPEND[i % SUSPEND.length];
    head(lines, 'о приостановлении предварительного следствия', `(по основанию, предусмотренному п. ${g.pt} ч. 1 ст. 208 УПК РФ)`, town, dateStr, who);
    lines[lines.length - 1] += ` № ${no},`;
    lines.push('УСТАНОВИЛ:');
    lines.push(`По уголовному делу установлено, что ${g.text}.`);
    lines.push(`Принимая во внимание, что срок предварительного следствия истек, а все следственные действия выполнены, руководствуясь ст. 38, п. ${g.pt} ч. 1 ст. 208 и ч. 1 ст. 210 УПК РФ,`);
    lines.push('ПОСТАНОВИЛ:');
    lines.push(`1. Предварительное следствие по уголовному делу № ${no} приостановить по основанию, предусмотренному п. ${g.pt} ч. 1 ст. 208 УПК РФ.`);
    lines.push('2. Копию настоящего постановления направить прокурору Условной области.');
    gold.suspend = { point: g.pt, code: g.code };
    gold.event = 'ev.suspend';
  } else if (type === 'resume') {
    const g = RESUME[i % RESUME.length];
    head(lines, 'о возобновлении предварительного следствия', null, town, dateStr, who);
    lines[lines.length - 1] += ` № ${no},`;
    lines.push('УСТАНОВИЛ:');
    lines.push(g.pt
      ? `Предварительное следствие по уголовному делу приостановлено по п. ${g.pt} ч. 1 ст. 208 УПК РФ. Основания приостановления отпали.`
      : 'Производство по ранее прекращенному уголовному делу подлежит возобновлению: постановление о прекращении отменено.');
    lines.push('На основании изложенного, руководствуясь ст. 211 УПК РФ,');
    lines.push('ПОСТАНОВИЛ:');
    lines.push(`1. Предварительное следствие по уголовному делу № ${no} возобновить.`);
    gold.resume = { point: g.pt, code: g.code };
    gold.event = 'ev.resume';
  } else if (type === 'terminate') {
    const g = TERMINATE[i % TERMINATE.length];
    const p = PERSONS[(i + 1) % PERSONS.length];
    head(lines, 'о прекращении уголовного дела', null, town, dateStr, who);
    lines[lines.length - 1] += ` № ${no},`;
    lines.push('УСТАНОВИЛ:');
    lines.push(`В ходе предварительного следствия установлено: ${g.text}.`);
    lines.push(`На основании изложенного, руководствуясь ст. 212, 213 УПК РФ,`);
    lines.push('ПОСТАНОВИЛ:');
    lines.push(`1. Уголовное дело № ${no} прекратить по основанию, предусмотренному ${g.cite}, в отношении ${p.gen.join(' ')}, ${ru(p.birth)} года рождения.`);
    lines.push('2. Копию настоящего постановления направить прокурору Условной области.');
    gold.terminate = { cite: g.cite, code: g.code, ground_type: g.kind };
    gold.persons = [{ surname: p.nom[0], first_name: p.nom[1], patronymic: p.nom[2], birth: p.birth }];
    gold.event = 'ev.terminate';
  } else if (type === 'victim_decision') {
    const v = VICTIMS[i % VICTIMS.length];
    head(lines, 'о признании потерпевшим', null, town, dateStr, who);
    lines[lines.length - 1] += ` № ${no},`;
    lines.push('УСТАНОВИЛ:');
    lines.push('Преступлением причинен вред.');
    lines.push('На основании изложенного, руководствуясь ст. 42 УПК РФ,');
    lines.push('ПОСТАНОВИЛ:');
    lines.push(`1. Признать потерпевшим ${v.acc.join(' ')}, ${ru(v.birth)} года рождения, о чем ему объявить.`);
    gold.victims = [{ surname: v.nom[0], first_name: v.nom[1], patronymic: v.nom[2] }];
    gold.event = 'ev.victim_new';
  }
  lines.push(who[0], ORGAN.split(' ').slice(0, 3).join(' '), `${who[1]}\t${who[2].split(' ').reverse().join(' ')}`);
  return { text: lines.join('\n'), gold };
}

const TYPES = ['charge', 'extend', 'suspend', 'resume', 'terminate', 'victim_decision'];
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
for (const type of TYPES) {
  for (let k = 0; k < 4; k++) {
    const { text, gold } = makeDoc(type, k + TYPES.indexOf(type) * 4);
    const id = `${type}-${pad(k + 1)}`;
    fs.writeFileSync(path.join(OUT, `${id}.txt`), text);
    fs.writeFileSync(path.join(OUT, `${id}.gold.json`), `${JSON.stringify({ file: `${id}.txt`, ...gold }, null, 1)}\n`);
    n++;
  }
}
fs.writeFileSync(path.join(OUT, 'README.md'), '# Тестовый набор Фазы 3\n\nВымышленные постановления других видов (привлечение в качестве обвиняемого, продление, приостановление, возобновление, прекращение, признание потерпевшим) по строению бланков СК. Все лица и номера вымышлены. Файлы создает `node scripts/fixtures/make-docs-corpus.mjs`; руками не править.\n');
console.log(`набор: ${n} документов в ${path.relative(ROOT, OUT)}`);
