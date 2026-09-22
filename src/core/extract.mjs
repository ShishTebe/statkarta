// Извлечение сведений из постановления о возбуждении уголовного дела (Фаза 2, FR-08, ТЗ разд. 9).
// Детерминированно: шаблоны из пакета правил (extract.json) ищутся каждый в своей части документа.
// Каждая находка несет фрагмент-источник (позиции в тексте) и уровень уверенности.

import { normalizeForScan } from './doctext.mjs';
import { parseQualification, refToText } from './uk.mjs';
import { optKey } from './pack.mjs';

const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const MACROS = {
  DATE: '(?:«\\s*)?(?<d>\\d{1,2})(?:\\s*»)?\\s+(?<mon>январ[яьеи]|феврал[яьеи]|марта?|апрел[яьеи]|ма[яй]|июн[яьеи]|июл[яьеи]|августа?|сентябр[яьеи]|октябр[яьеи]|ноябр[яьеи]|декабр[яьеи])\\s+(?<y>\\d{4}|20\\s{1,6}\\d{2}(?!\\d))|(?<![\\d.])(?<d2>\\d{1,2})\\.(?<m2>\\d{1,2})\\.(?<y2>\\d{4}|\\d{2})(?![\\d])',
  MONEY: '(?<![\\d.,])(?<rub>\\d{1,3}(?:[ .]\\d{3})+|\\d+)(?:,(?<kop>\\d{1,2}))?\\s*(?:\\(\\s*[^)]{0,120}\\)\\s*)?(?:руб|р\\.|₽)',
};

export const CONFIDENCE_RU = { high: 'высокая', medium: 'средняя', low: 'низкая' };
const DROP = { high: 'medium', medium: 'low', low: 'low' };

export function compilePattern(pattern, flags = 'giu') {
  return rx(pattern, flags);
}

function rx(pattern, flags = 'giu') {
  return new RegExp(pattern.replace(/\{(DATE|MONEY)\}/g, (_, k) => `(?:${MACROS[k]})`), flags);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateOf(g) {
  let d;
  let m;
  let y;
  if (g.mon) {
    d = Number(g.d);
    m = MONTHS.findIndex((p) => g.mon.toLowerCase().startsWith(p)) + 1;
    y = Number(g.y.replace(/\s+/g, '')); // в бланке-таблице год бывает разбит: «20» и «23»
  } else if (g.d2) {
    d = Number(g.d2);
    m = Number(g.m2);
    y = Number(g.y2.length === 2 ? `20${g.y2}` : g.y2);
  } else return null;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1950 && y <= 2100)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function timeOf(g) {
  const hh = Number(g.hh);
  const mm = g.mm === undefined ? 0 : Number(g.mm);
  if (!(hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)) return null;
  return `${pad(hh)}:${pad(mm)}`;
}

function moneyOf(g) {
  const rub = Number(String(g.rub).replace(/[ .]/g, ''));
  if (!Number.isFinite(rub)) return null;
  const kop = g.kop ? Number(g.kop.padEnd(2, '0')) : 0;
  return kop ? `${rub}.${pad(kop)}` : String(rub);
}

// ---------- части постановления ----------

const RX_ESTABLISHED = /У\s?С\s?Т\s?А\s?Н\s?О\s?В\s?И\s?Л\s?:?/g;
const RX_DECIDED = /П\s?О\s?С\s?Т\s?А\s?Н\s?О\s?В\s?И\s?Л\s?:?/g;
const RX_TITLE = /постановлени[ея]\s+о\s+возбуждении\s+уголовного\s+дела/iu;
const RX_ANY_TITLE = /(?:постановлени[ея]|протокол|рапорт|обвинительное\s+заключение|приговор)[^\n]{0,160}/iu;

// Деление на части по якорям «УСТАНОВИЛ» и «ПОСТАНОВИЛ» (заглавными, в том числе вразрядку)
export function splitParts(text, { titleAt = null } = {}) {
  const t = text;
  const title = titleAt === null ? RX_TITLE.exec(t) : { index: t.lastIndexOf('\n', titleAt) + 1, 0: t.slice(titleAt, t.indexOf('\n', titleAt) < 0 ? t.length : t.indexOf('\n', titleAt)) };
  const titleStart = title ? title.index : 0;
  // заголовок: строка с «о возбуждении уголовного дела» и строка «и принятии его к производству»
  let titleEnd = title ? t.indexOf('\n', title.index + title[0].length) : 0;
  if (title) {
    const next = /^\s*(?:№\s*[\d ]+\s*\n\s*)?и\s+принятии[^\n]*/iu.exec(t.slice(titleEnd + 1));
    if (next) titleEnd = titleEnd + 1 + next[0].length;
    if (titleEnd < 0) titleEnd = t.length;
  }
  RX_ESTABLISHED.lastIndex = titleEnd;
  const est = RX_ESTABLISHED.exec(t);
  const estAt = est ? est.index : -1;
  let dec = null;
  if (est) {
    RX_DECIDED.lastIndex = est.index + est[0].length;
    dec = RX_DECIDED.exec(t);
  }
  // вводная часть начинается с первого длинного абзаца после заголовка (должность, «рассмотрев …»)
  const afterTitle = titleEnd;
  const introEnd = est ? est.index : t.length;
  let introStart = afterTitle;
  const paras = [...t.slice(afterTitle, introEnd).matchAll(/[^\n]+/g)];
  const first = paras.find((p) => p[0].length > 120 || /рассмотрев|руководствуясь/iu.test(p[0]));
  if (first) introStart = afterTitle + first.index;
  return {
    title: [titleStart, Math.max(titleStart, titleEnd)],
    header: [Math.max(titleStart, titleEnd), introStart],
    intro: [introStart, introEnd],
    descriptive: est ? [est.index + est[0].length, dec ? dec.index : t.length] : [introEnd, introEnd],
    resolutive: dec ? [dec.index + dec[0].length, t.length] : [t.length, t.length],
    found: { title: Boolean(title), established: estAt >= 0, decided: Boolean(dec) },
  };
}

// ---------- находки ----------

function fragmentOf(text, start, end, pad = 60) {
  const a = Math.max(0, start - pad);
  const b = Math.min(text.length, end + pad);
  return { start, end, before: text.slice(a, start).replace(/\s+/g, ' ').trimStart(), match: text.slice(start, end).replace(/\s+/g, ' '), after: text.slice(end, b).replace(/\s+/g, ' ').trimEnd() };
}

// Конец предложения – точка перед заглавной буквой, если перед ней не сокращение («ст.», «ч.», «г.», «А.В.»)
function sentenceEnd(text, i) {
  if (text[i] !== '.') return false;
  const next = /^\s+(\S)/u.exec(text.slice(i + 1, i + 6));
  if (!next || !/[А-ЯA-Z0-9«"]/u.test(next[1])) return false;
  const word = /[\p{L}\d]+$/u.exec(text.slice(Math.max(0, i - 12), i));
  return Boolean(word) && word[0].length > 3 && !/^\d+$/u.test(word[0]);
}

function sentenceBounds(text, at, [lo, hi]) {
  let s = at;
  while (s > lo && text[s - 1] !== '\n' && !sentenceEnd(text, s - 1)) s--;
  let e = at;
  while (e < hi && text[e] !== '\n' && !sentenceEnd(text, e)) e++;
  return [s, e];
}

function valueOf(rule, g, m) {
  switch (rule.kind) {
    case 'date': return dateOf(g);
    case 'time': return timeOf(g);
    case 'number': return moneyOf(g);
    case 'case_number': return g.v ? g.v.replace(/\s+/g, '') : null;
    case 'enum': return null;
    default: {
      const v = (g.v ?? m[0]).replace(/\s+/g, ' ').trim().replace(/[,;:]$/, '');
      return v ? v.slice(0, rule.max_len ?? 300) : null;
    }
  }
}

function excluded(rule, text, m, [lo]) {
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
  const before = text.slice(Math.max(lo, m.index - 120), m.index);
  return (rule.exclude_after ?? []).some((p) => new RegExp(p, 'iu').test(after))
    || (rule.exclude_before ?? []).some((p) => new RegExp(p, 'iu').test(before));
}

// Все совпадения правила в части текста (с учетом фильтра предложений и исключений)
function scan(rule, text, range) {
  const [lo, hi] = range;
  const out = [];
  rule.patterns.forEach((p, pi) => {
    const r = rx(p, 'gimu');
    r.lastIndex = lo;
    let m;
    while ((m = r.exec(text)) && m.index < hi) {
      if (m[0] === '') { r.lastIndex++; if (rule.kind !== 'fabula') continue; }
      if (m.index + m[0].length > hi) break;
      if (excluded(rule, text, m, range)) continue;
      if (rule.sentence) {
        const [s, e] = sentenceBounds(text, m.index, range);
        if (!new RegExp(rule.sentence, 'iu').test(text.slice(s, e))) continue;
      }
      out.push({ m, pi, g: m.groups ?? {} });
    }
  });
  return out.sort((a, b) => a.m.index - b.m.index || a.pi - b.pi);
}

function finding(rule, text, start, end, value, { confidence = rule.confidence, note = null, display = null, key = rule.id } = {}) {
  return { key, rule: rule.id, label: rule.label, field: rule.field, info: rule.info === true, value, display: display ?? String(value), confidence, note: note ?? rule.note ?? null, fragment: fragmentOf(text, start, end) };
}

function simpleField(rule, text, parts, byRule) {
  const ranges = rule.parts.map((p) => parts[p]);
  if (rule.after_field) {
    const base = byRule.get(rule.after_field);
    if (!base) return null;
    const from = base.fragment.end;
    ranges.splice(0, ranges.length, [from, Math.min(from + (rule.window ?? 60), parts[rule.parts[0]][1])]);
  }
  for (const range of ranges) {
    const hits = scan(rule, text, range);
    if (rule.kind === 'enum') {
      const h = hits[0];
      if (h) {
        const code = rule.values[h.pi];
        return finding(rule, text, h.m.index, h.m.index + h.m[0].length, [`|${code}`], { display: h.m[0].replace(/\s+/g, ' ') });
      }
      continue;
    }
    for (const h of hits) {
      const v = valueOf(rule, h.g, h.m);
      const conf = rule.pattern_confidence?.[h.pi] ?? rule.confidence;
      if (v === null || v === undefined || v === '') continue;
      const vStart = h.g.v ? text.indexOf(h.g.v, h.m.index) : h.m.index;
      const vEnd = h.g.v ? vStart + h.g.v.length : h.m.index + h.m[0].length;
      if (rule.kind === 'case_number') {
        const ok = v.length === (rule.digits ?? 17);
        return finding(rule, text, vStart, vEnd, v, ok ? {} : { confidence: 'low', note: `В номере ${v.length} цифр, а номер дела – ${rule.digits ?? 17} цифр: проверьте` });
      }
      if (rule.kind === 'date') return finding(rule, text, vStart, vEnd, v, { confidence: conf, display: v.split('-').reverse().join('.') });
      if (rule.kind === 'number') return finding(rule, text, vStart, vEnd, v, { confidence: conf, display: `${Number(v).toLocaleString('ru-RU')} руб.` });
      return finding(rule, text, vStart, vEnd, v, { confidence: conf });
    }
  }
  return null;
}

function fabulaField(rule, text, parts) {
  const [lo, hi] = parts[rule.parts[0]];
  const raw = text.slice(lo, hi).replace(/\s+/g, ' ').trim();
  if (raw.length < 20) return null;
  const max = rule.max_len ?? 500;
  let v = raw;
  if (raw.length > max) {
    const cut = raw.slice(0, max - 1);
    const sp = cut.lastIndexOf(' ');
    v = `${(sp > max * 0.7 ? cut.slice(0, sp) : cut).replace(/[,;:–-]$/, '')}…`;
  }
  const start = lo + (text.slice(lo, hi).length - text.slice(lo, hi).trimStart().length);
  return finding(rule, text, start, Math.min(hi, start + 120), v, { display: v, note: raw.length > max ? `Описательная часть сокращена до ${max} знаков (было ${raw.length}) – проверьте` : rule.note });
}

// ---------- эпизоды и лица ----------

const FIO = '[А-Я][а-я]+(?:-[А-Я][а-я]+)?';
const RX_FIO_FULL = new RegExp(`(${FIO})\\s+(${FIO})\\s+(${FIO})`, 'u');
const RX_FIO_INIT = new RegExp(`(${FIO})\\s+([А-Я])\\.\\s*([А-Я])\\.`, 'u');
const RX_BIRTH = /^[\s,]*(?:(\d{2})\.(\d{2})\.(\d{4})|(\d{4}))\s*(?:г\.|года)?\s*(?:рождения|г\.\s*р\.?|гр\b)/u;

// Именительный падеж по дате рождения: то же лицо в тексте, но в другой форме («Сомов Игорь Петрович, 14.03.1987 г.р.»)
function nominative(text, genitive, birth) {
  if (!birth) return null;
  const [y, m, d] = birth.split('-');
  const rxAll = new RegExp(`(${FIO})\\s+(${FIO})\\s+(${FIO})\\s*,?\\s*(?:${d}\\.${m}\\.${y}|${y})\\s*(?:г\\.|года)?\\s*(?:рождения|г\\.\\s*р)`, 'gu');
  // та же фамилия в другом падеже: общее начало без последних трех букв (Дубинецкий – Дубинецкого)
  const same = (a, b) => { const n = Math.max(3, Math.min(a.length, b.length) - 3); return a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase(); };
  const cands = [...text.matchAll(rxAll)].filter((x) => same(x[1], genitive[0]) && same(x[2], genitive[1]));
  // именительный падеж узнается по отчеству: «-ич», «-на» (в родительном «-ича», «-ны»)
  const nomin = cands.find((x) => /(?:ич|на|оглы|кызы)$/u.test(x[3]));
  return nomin ? { surname: nomin[1], first_name: nomin[2], patronymic: nomin[3], at: nomin.index } : null;
}

// Запасной путь: именительный падеж из родительного по окончаниям (только для ФИО полностью)
export function genitiveToNominative([surname, first, patr]) {
  const male = /ича$/u.test(patr);
  const female = /ны$/u.test(patr);
  if (!male && !female) return null;
  const sub = (w, pairs) => {
    if (male && /[аеиоуыэюя]я$/u.test(w)) return `${w.slice(0, -1)}й`; // Чернобая – Чернобай, Сергея – Сергей
    for (const [a, b] of pairs) if (w.endsWith(a)) return w.slice(0, w.length - a.length) + b;
    return w;
  };
  if (male) {
    return {
      surname: sub(surname, [['ского', 'ский'], ['цкого', 'цкий'], ['ого', 'ый'], ['его', 'ий'], ['ова', 'ов'], ['ева', 'ев'], ['ина', 'ин'], ['ына', 'ын'], ['а', ''], ['я', 'ь']]),
      first_name: sub(first, [['Павла', 'Павел'], ['Льва', 'Лев'], ['ьи', 'ья'], ['а', ''], ['я', 'ь']]),
      patronymic: patr.slice(0, -1),
    };
  }
  return {
    surname: sub(surname, [['ской', 'ская'], ['цкой', 'цкая'], ['ой', 'а'], ['ей', 'я']]),
    first_name: sub(first, [['ии', 'ия'], ['ьи', 'ья'], ['и', 'а'], ['ы', 'а']]),
    patronymic: `${patr.slice(0, -1)}а`,
  };
}

function personOf(rule, text, clause, clauseStart) {
  const pm = new RegExp(rule.person, 'iu').exec(clause);
  if (!pm) return null;
  const tail = clause.slice(pm.index + pm[0].length - pm.groups.v.length);
  if (new RegExp(rule.unknown_person, 'iu').test(pm.groups.v)) return { unknown: true };
  const full = RX_FIO_FULL.exec(tail);
  const init = RX_FIO_INIT.exec(tail);
  const hit = full && full.index === 0 ? full : init && init.index === 0 ? init : null;
  if (!hit) return null;
  const afterName = tail.slice(hit[0].length);
  const b = RX_BIRTH.exec(afterName);
  const birth = b && b[1] ? `${b[3]}-${b[2]}-${b[1]}` : null;
  const start = clauseStart + pm.index + pm[0].length - pm.groups.v.length;
  const genitive = hit.slice(1, 4);
  const nom = full ? nominative(text, genitive, birth) : null;
  const guessed = full && !nom ? genitiveToNominative(genitive) : null;
  const names = nom ?? guessed ?? { surname: genitive[0], first_name: full ? genitive[1] : '', patronymic: full ? genitive[2] : '' };
  const initials = full ? `${names.first_name[0]}.${names.patronymic[0]}.` : `${hit[2]}.${hit[3]}.`;
  return {
    genitive: hit[0], label: `${names.surname} ${initials}`, names: full ? names : { surname: names.surname, first_name: '', patronymic: '' },
    birth, nominativeFound: Boolean(nom), nominativeGuessed: Boolean(guessed), start, end: start + hit[0].length + (b ? b[0].length : 0),
  };
}

const ACCESSORY = new Set(['30', '33', '35']);

// Один пункт «возбудить»: при слове «преступлений» и нескольких основных статьях – по эпизоду на статью
function splitQualification(qual, plural) {
  const parsed = parseQualification(qual);
  const main = parsed.refs.filter((r) => !ACCESSORY.has(r.article));
  if (!plural || main.length < 2) return [qual];
  // «ч. 3 ст. 30, ч. 1 ст. 105, п. «а» ч. 2 ст. 158» – ст. 30 и 33 относятся к следующей основной статье
  const out = [];
  let prefix = [];
  for (const r of parsed.refs) {
    if (ACCESSORY.has(r.article)) { prefix.push(r); continue; }
    out.push([...prefix, r].map((x) => refToText(x).replace(/ УК РФ$/, '')).join(', ') + ' УК РФ');
    prefix = [];
  }
  return out;
}

function episodesField(rule, text, parts) {
  const out = { episodes: [], warnings: [] };
  const search = (range, confidence) => {
    const [lo, hi] = range;
    const body = text.slice(lo, hi);
    const starts = [...body.matchAll(new RegExp(rule.clause, 'giu'))].map((m) => m.index);
    const clauses = starts.length ? starts.map((s, i) => [s, starts[i + 1] ?? body.length]) : (range === parts.intro ? [[0, body.length]] : []);
    for (const [s, e] of clauses) {
      let clause = body.slice(s, e);
      // пункт заканчивается на первом абзаце после квалификации, чтобы не захватить следующие пункты
      const q = new RegExp(rule.patterns[0], 'iu').exec(clause);
      if (!q) continue;
      const qStart = lo + s + q.index + q[0].indexOf(q.groups.v);
      const qual = q.groups.v.replace(/\s+/g, ' ').replace(/^(?:преступлени[а-я]*,?\s*)/iu, '').trim();
      const parsed = parseQualification(qual);
      if (!parsed.recognized) { out.warnings.push(`Не разобрана квалификация: «${qual.slice(0, 80)}»`); continue; }
      // единый вид «п. «а» ч. 2 ст. 158 УК РФ» вместо «пунктом а части 2 статьи 158»
      const canon = parsed.refs.map((r) => refToText(r).replace(/ УК РФ$/, '')).join(', ') + ' УК РФ';
      const plural = /преступлений|предусмотренных/iu.test(clause.slice(0, q.index + q[0].length));
      const lineEnd = clause.indexOf('\n', q.index + q[0].length);
      if (lineEnd > 0) clause = clause.slice(0, lineEnd);
      const person = personOf(rule, text, clause, lo + s);
      for (const one of splitQualification(canon, plural)) {
        out.episodes.push({
          qualification: one, confidence, start: qStart, end: qStart + q.groups.v.length,
          fragment: fragmentOf(text, qStart, qStart + q.groups.v.length),
          person: person && !person.unknown ? person : null, unknownPerson: Boolean(person?.unknown),
        });
      }
    }
  };
  search(parts[rule.parts[0]], rule.confidence);
  if (!out.episodes.length) {
    for (const p of rule.fallback_parts ?? []) search(parts[p], DROP[rule.confidence]);
    if (out.episodes.length) out.warnings.push('Квалификация взята из вводной части (сообщение о преступлении): резолютивная часть не разобрана – проверьте');
  }
  return out;
}

// Дательный падеж («потерпевшему Зайцеву Артему Олеговичу») – в именительный по окончаниям
export function dativeToNominative([surname, first, patr]) {
  const male = /ичу$/u.test(patr);
  const female = /не$/u.test(patr);
  if (!male && !female) return null;
  const sub = (w, pairs) => { for (const [a, b] of pairs) if (w.endsWith(a)) return w.slice(0, w.length - a.length) + b; return w; };
  if (male) {
    return {
      surname: sub(surname, [['скому', 'ский'], ['цкому', 'цкий'], ['ому', 'ый'], ['ему', 'ий'], ['ову', 'ов'], ['еву', 'ев'], ['ину', 'ин'], ['ыну', 'ын'], ['у', ''], ['ю', 'ь']]),
      first_name: sub(first, [['Павлу', 'Павел'], ['Льву', 'Лев'], ['ею', 'ей'], ['ию', 'ий'], ['аю', 'ай'], ['у', ''], ['ю', 'ь']]),
      patronymic: patr.slice(0, -1),
    };
  }
  return {
    surname: sub(surname, [['ской', 'ская'], ['цкой', 'цкая'], ['ой', 'а'], ['ей', 'я']]),
    first_name: sub(first, [['ии', 'ия'], ['ье', 'ья'], ['е', 'а']]),
    patronymic: `${patr.slice(0, -1)}а`,
  };
}

// Винительный падеж женского имени («Кравцову Елену Игоревну») – в именительный
export function accusativeToNominative([surname, first, patr]) {
  if (!/ну$/u.test(patr)) return null;
  const sub = (w, pairs) => { for (const [a, b] of pairs) if (w.endsWith(a)) return w.slice(0, w.length - a.length) + b; return w; };
  return {
    surname: sub(surname, [['скую', 'ская'], ['цкую', 'цкая'], ['ую', 'ая'], ['ову', 'ова'], ['еву', 'ева'], ['ину', 'ина'], ['ыну', 'ына'], ['у', 'а'], ['ю', 'я']]),
    first_name: sub(first, [['ью', 'ья'], ['ию', 'ия'], ['у', 'а'], ['ю', 'я']]),
    patronymic: `${patr.slice(0, -2)}на`,
  };
}

// Потерпевшие-организации (ответ В-51): наименование до адреса, ИНН, скобок и оборота «расположенное»
function orgsField(rule, text, parts) {
  const out = [];
  for (const range of rule.parts.map((x) => parts[x])) {
    for (const h of scan(rule, text, range)) {
      let name = h.g.v.replace(/\s+/g, ' ').trim();
      name = name.split(/\s*\(|,\s*(?:расположенн|юридическ|ИНН|ОГРН|адрес|в лице|в размере|на сумму)|,\s*\d{6}|\s+потерпевш|\s+о чем/iu)[0].replace(/[,;.]+$/, '').trim();
      if (name.length < 3 || out.some((v) => v.label === name)) continue;
      const start = text.indexOf(h.g.v, h.m.index);
      out.push({ key: `org.${out.length + 1}`, label: name.slice(0, 150), legal: true, names: null, how: 'организация', text: name,
        confidence: rule.confidence, fragment: fragmentOf(text, start, start + Math.min(h.g.v.length, name.length)) });
    }
  }
  return out;
}

// Потерпевшие – только подсказка (низкая уверенность, ответ В-41): «потерпевшему …», «потерпевшая …»
// Фамилия при инициалах в косвенном падеже – только однозначные окончания; иначе как в тексте
export function surnameToNominative(w) {
  const pairs = [['скому', 'ский'], ['цкому', 'цкий'], ['ской', 'ская'], ['цкой', 'цкая'], ['ову', 'ов'], ['еву', 'ев'], ['ину', 'ин'], ['ыну', 'ын'],
    ['овой', 'ова'], ['евой', 'ева'], ['иной', 'ина'], ['ыной', 'ына'], ['ому', 'ый'], ['ему', 'ий']];
  for (const [a, b] of pairs) if (w.endsWith(a) && w.length > a.length + 2) return w.slice(0, w.length - a.length) + b;
  return null;
}

function victimsField(rule, text, parts, suspects) {
  const out = [];
  const same = (a, b) => { const n = Math.max(3, Math.min(a.length, b.length) - 3); return a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase(); };
  for (const h of scan(rule, text, parts[rule.parts[0]])) {
    const raw = h.g.v.replace(/\s+/g, ' ').replace(/\.\s+/g, '.');
    const w = raw.split(' ');
    const full = w.length === 3;
    if (!w.every((x) => /^[А-Я]/u.test(x))) continue; // шаблон без учета регистра – Ф.И.О. только с заглавных
    if (full && !/(?:ич|на|ича|ны|ичу|не|ичем|ной|ну)$/u.test(w[2])) continue; // не Ф.И.О.
    const init = full ? `${w[1][0]}.${w[2][0]}.` : w[1];
    if (suspects.some((p) => same(p.surname, w[0]) && p.initials === init)) continue;
    if (out.some((v) => same(v.names.surname, w[0]) && v.initials === init)) continue;
    const birthM = RX_BIRTH.exec(text.slice(h.m.index + h.m[0].length, h.m.index + h.m[0].length + 40));
    const birth = birthM && birthM[1] ? `${birthM[3]}-${birthM[2]}-${birthM[1]}` : null;
    let names = null;
    let how = 'как в тексте';
    if (full && /(?:ич|на)$/u.test(w[2])) { names = { surname: w[0], first_name: w[1], patronymic: w[2] }; how = 'именительный'; }
    else if (full) {
      names = (full && nominative(text, w, birth)) || genitiveToNominative(w) || dativeToNominative(w) || accusativeToNominative(w);
      if (names) how = 'восстановлен';
    }
    if (!names && !full) {
      const nom = surnameToNominative(w[0]);
      if (nom) { names = { surname: nom, first_name: '', patronymic: '' }; how = 'восстановлен'; }
    }
    names ??= { surname: w[0], first_name: full ? w[1] : '', patronymic: full ? w[2] : '' };
    const initials = full ? `${names.first_name[0]}.${names.patronymic[0]}.` : w[1];
    const start = h.m.index + h.m[0].length - h.g.v.length;
    out.push({ key: `victim.${out.length + 1}`, label: `${names.surname} ${initials}`, names, initials: init, birth, how, text: raw, confidence: rule.confidence,
      fragment: fragmentOf(text, start, start + h.g.v.length) });
  }
  return out;
}



// Лицо из резолютивной части («Привлечь Иванова Ивана Ивановича, 01.02.1980 года рождения, …»)
function personsField(rule, text, parts) {
  const out = [];
  for (const range of rule.parts.map((x) => parts[x])) {
    for (const h of scan(rule, text, range)) {
      const raw = h.g.v.replace(/\s+/g, ' ');
      const w = raw.split(' ');
      if (!w.every((x) => /^[А-Я]/u.test(x))) continue;
      const full = w.length === 3;
      const start = h.m.index + h.m[0].length - h.g.v.length;
      const b = RX_BIRTH.exec(text.slice(start + h.g.v.length, start + h.g.v.length + 40));
      const birth = b && b[1] ? `${b[3]}-${b[2]}-${b[1]}` : null;
      const nom = full ? nominative(text, w, birth) : null;
      const guessed = full && !nom ? (genitiveToNominative(w) ?? dativeToNominative(w) ?? accusativeToNominative(w)) : null;
      const names = nom ?? guessed ?? { surname: full ? w[0] : (surnameToNominative(w[0]) ?? w[0]), first_name: full ? w[1] : '', patronymic: full ? w[2] : '' };
      const initials = full ? `${names.first_name[0]}.${names.patronymic[0]}.` : w[1];
      if (out.some((p) => p.label === `${names.surname} ${initials}`)) continue;
      out.push({ key: `person.${out.length + 1}`, label: `${names.surname} ${initials}`, names, birth, genitive: raw,
        nominativeFound: Boolean(nom), nominativeGuessed: Boolean(guessed), confidence: rule.confidence,
        fragment: fragmentOf(text, start, start + h.g.v.length + (b ? b[0].length : 0)) });
    }
    if (out.length) break;
  }
  return out;
}

// Код реквизита по ссылке на УПК в тексте (основание приостановления, прекращения, возобновления)
function citationField(rule, text, parts, optionsOf) {
  for (const range of rule.parts.map((x) => parts[x])) {
    for (const h of scan(rule, text, range)) {
      const citation = h.g.v.replace(/\s+/g, ' ');
      const options = optionsOf(rule.target.form, rule.target.requisite) ?? [];
      // «по ранее прекращенному делу» – ссылки нет, ищем вариант по словам
      const hit = /прекращ/iu.test(citation)
        ? (() => { const o = options.find((x) => !x.group && /ранее\s+прекращенному/iu.test(x.value)); return o ? { code: o.code, title: o.value, key: optKey(o) } : null; })()
        : codeByCitation(options, citation);
      const start = text.indexOf(h.g.v, h.m.index);
      if (!hit) {
        return finding(rule, text, start, start + h.g.v.length, null, { confidence: 'low', display: citation,
          note: `Код реквизита ${rule.target.requisite} ф. ${rule.target.form} по ссылке «${citation}» не подобран – выберите код сами` });
      }
      const ref = parseUpkRef(citation);
      return { ...finding(rule, text, start, start + h.g.v.length, [hit.key], { display: `${hit.code} – ${hit.title}` }),
        target: rule.target, attr: rule.attr ?? null, citation, point: ref?.point ?? null, code: hit.code };
    }
  }
  return null;
}

// Срок продления: «до 03 месяцев 00 суток», «на 1 месяц» → код реквизита 9 ф. 3
function termField(rule, text, parts) {
  for (const range of rule.parts.map((x) => parts[x])) {
    for (const h of scan(rule, text, range)) {
      const months = Number(h.g.mon ?? 0);
      const days = Number(h.g.day ?? 0);
      if (!months && !days) continue;
      const code = extensionCode({ months, days });
      const start = h.m.index;
      return { ...finding(rule, text, start, start + h.m[0].length, [`|${code}`], { display: `${code} – ${months ? `${months} мес.` : ''}${days ? ` ${days} сут.` : ''}`.trim() }),
        target: rule.target, code };
    }
  }
  return null;
}

// ---------- ссылки на УПК и коды реквизитов ----------

// «п. 3 ч. 1 ст. 24 УПК РФ», «пунктом 2 части 1 статьи 208», «ст. 25 УПК РФ» → { article, part, point }
export function parseUpkRef(text) {
  const rx = /(?:п(?:\.|ункт[а-я]*)\s*(?<pt>\d+(?:\.\d+)?)\s*)?(?:ч(?:\.|аст[а-я]+)\s*(?<pr>\d+(?:\.\d+)?)\s*)?ст(?:\.|ат[а-я]+)\s*(?<art>\d+(?:\.\d+)?)/iu;
  const m = rx.exec(String(text ?? ''));
  if (!m) return null;
  return { article: m.groups.art, part: m.groups.pr ?? null, point: m.groups.pt ?? null };
}

const sameRef = (a, b) => Boolean(a && b) && a.article === b.article
  && (a.part === null || b.part === null || a.part === b.part)
  && (a.point === null || b.point === null || a.point === b.point);

// Код реквизита по ссылке на УПК: у вариантов реквизита ссылка записана в самом наименовании
export function codeByCitation(options, citation) {
  const ref = parseUpkRef(citation);
  if (!ref) return null;
  const exact = options.filter((o) => !o.group).map((o) => ({ o, r: parseUpkRef(o.value) })).filter((x) => x.r && x.r.article === ref.article);
  const hit = exact.find((x) => sameRef(x.r, ref) && x.r.part === ref.part && x.r.point === ref.point)
    ?? exact.find((x) => sameRef(x.r, ref))
    ?? null;
  return hit ? { code: hit.o.code, title: hit.o.value, key: optKey(hit.o) } : null;
}

// Код срока продления (реквизит 9 ф. 3): считаем общий срок в сутках
export function extensionCode({ months = 0, days = 0 }) {
  const total = months * 30 + days;
  if (total <= 20) return '6';
  if (total <= 60) return '5';
  if (total <= 92) return '1';
  if (total <= 183) return '2';
  if (total <= 366) return '3';
  return '4';
}

// ---------- постановление целиком ----------

// Вид документа – по признакам из пакета документов (documents.json), в заголовке
export function detectDoc(text, documents = []) {
  // заголовок – короткая строка в начале документа; в длинных фразах признаки не ищутся
  const head = text.slice(0, 4000);
  const lines = [];
  let at = 0;
  for (const line of head.split('\n').slice(0, 40)) {
    const t = line.trim();
    if (t && t.length <= 150) lines.push({ text: t.toLowerCase(), at: at + line.indexOf(t) });
    at += line.length + 1;
  }
  let best = null;
  for (const d of documents) {
    if ((d.not_detect ?? []).some((x) => lines.some((l) => l.text.includes(x.toLowerCase())))) continue;
    for (const mark of d.detect ?? []) {
      for (const line of lines) {
        const i = line.text.indexOf(mark.toLowerCase());
        if (i < 0 || i > 80) continue;
        if (!best || mark.length > best.mark.length) best = { doc: d, mark, at: line.at + i };
      }
    }
  }
  if (best) return { ok: true, doc: best.doc, at: best.at };
  const t = RX_ANY_TITLE.exec(text.slice(0, 700));
  return { ok: false, reason: t ? `Этот документ программе пока не знаком: «${t[0].trim().slice(0, 100)}»` : 'Заголовок документа не распознан' };
}

export function detectVud(text) {

  const head = text.slice(0, 600);
  if (!RX_TITLE.test(head)) {
    const t = /постановлени[ея][^\n]{0,120}/iu.exec(head);
    return { ok: false, reason: t ? `Это не постановление о возбуждении уголовного дела: «${t[0].trim().slice(0, 100)}»` : 'Не найден заголовок «Постановление о возбуждении уголовного дела»' };
  }
  if (/об\s+отказе\s+в\s+возбуждении|об\s+отмене\s+постановления\s+о\s+возбуждении/iu.test(head)) {
    return { ok: false, reason: 'Это постановление об отказе в возбуждении или об отмене постановления о возбуждении' };
  }
  return { ok: true };
}

// Разбор документа дела: правила из пакета (extract.json) ищутся каждое в своей части.
// optionsOf(form, requisite) – варианты реквизита, нужны для подстановки кодов по ссылке на УПК.
export function extractDoc(sourceText, { rules = [], documents = [], optionsOf = () => [] } = {}) {
  const t0 = Date.now();
  const text = normalizeForScan(sourceText);
  const det = detectDoc(text, documents);
  const res = { ok: det.ok, doc: det.doc ?? null, docType: det.doc?.doc_type ?? null, reason: det.reason ?? null,
    text, fields: [], episodes: [], persons: [], victims: [], warnings: [], parts: null, ms: 0 };
  if (!det.ok) { res.ms = Date.now() - t0; return res; }
  const parts = splitParts(text, { titleAt: det.at ?? null });
  res.parts = parts;
  if (!parts.found.established) res.warnings.push('Не найдено слово «УСТАНОВИЛ» – описательная часть не выделена');
  if (!parts.found.decided) res.warnings.push('Не найдено слово «ПОСТАНОВИЛ» – резолютивная часть не выделена');
  const byRule = new Map();
  const mine = rules.filter((r) => r.doc_type === res.docType || r.doc_type === '*');
  for (const rule of mine) {
    if (rule.kind === 'episodes') {
      const ep = episodesField(rule, text, parts);
      res.episodes.push(...ep.episodes);
      res.warnings.push(...ep.warnings);
      continue;
    }
    if (rule.kind === 'victims') {
      res.victims.push(...victimsField(rule, text, parts, res.episodes.filter((e) => e.person).flatMap((e) => {
        const p = e.person;
        const initials = p.names.first_name ? `${p.names.first_name[0]}.${p.names.patronymic[0]}.` : p.label.split(' ')[1];
        return [{ surname: p.names.surname, initials }, { surname: p.genitive.split(' ')[0], initials }];
      })));
      continue;
    }
    if (rule.kind === 'person') {
      res.persons.push(...personsField(rule, text, parts));
      continue;
    }
    if (rule.kind === 'orgs') {
      res.victims.push(...orgsField(rule, text, parts));
      continue;
    }
    const f = rule.kind === 'fabula' ? fabulaField(rule, text, parts)
      : rule.kind === 'citation' ? citationField(rule, text, parts, optionsOf)
        : rule.kind === 'term' ? termField(rule, text, parts)
          : simpleField(rule, text, parts, byRule);
    if (f) { byRule.set(rule.id, f); res.fields.push(f); }
  }
  if (res.docType === 'vud' && !res.episodes.length) res.warnings.push('Квалификация не найдена – эпизоды добавьте вручную');
  res.suspectKnown = res.episodes.some((e) => e.person);
  res.ms = Date.now() - t0;
  return res;
}

// Постановление о ВУД (Фаза 2): оставлено для совместимости с прежним вызовом
export function extractVud(sourceText, rules) {
  return extractDoc(sourceText, { rules, documents: [{ doc_type: 'vud', detect: ['о возбуждении уголовного дела'] }] });
}
