// Обратная связь (ступень 1, документ 23): замечание собирается из белого списка сведений о месте
// в программе и текста пользователя. Программа ничего не отправляет сама: пользователь сохраняет
// партию замечаний файлом, копирует текстом или открывает заготовку заявки на GitHub.
// Перед сохранением текст проверяется: сведений уголовных дел в замечании быть не должно.

export const FEEDBACK_KINDS = {
  error: { title: 'Ошибка: код, правило, проверка или бланк', label: 'ошибка',
    fields: [['shown', 'Что показывает программа'], ['expected', 'Что должно быть'], ['basis', 'Основание: документ и пункт (разъяснение, справочник, бланк, приказ)']] },
  program: { title: 'Сбой или неудобство программы', label: 'программа',
    fields: [['shown', 'Что произошло или что неудобно'], ['expected', 'Как должно быть']] },
  addition: { title: 'Дополнение: документ, правило, справочник, коды региона', label: 'заявка',
    fields: [['what', 'Что добавить'], ['basis', 'Источник: наименование, дата, номер, где опубликован']] },
  idea: { title: 'Предложение', label: 'предложение', fields: [['what', 'Что предлагаете и зачем']] },
};
export const FEEDBACK_SOURCES = { self: 'сам (при работе с программой)', ic: 'информационный центр', prosecutor: 'прокурор', head: 'руководитель', colleague: 'коллега' };
export const FEEDBACK_MARK = 'statkarta-feedback';
const FB_WHERE_KEYS = ['screen', 'event', 'form', 'variant', 'formTitle', 'requisites', 'requisiteLabel', 'factId', 'codes', 'mode'];

// ---- проверка текста на сведения дела ----

const FB_UP = `А-Я${String.fromCharCode(0x401)}`;
const FB_LO = `а-я${String.fromCharCode(0x451)}`;
const FB_CAP = new RegExp(`(?<![${FB_UP}${FB_LO}])[${FB_UP}][${FB_LO}]{2,}(?:-[${FB_UP}][${FB_LO}]+)?`, 'gu');
const FB_WORD = new RegExp(`[${FB_UP}${FB_LO}a-zA-Z0-9]+`, 'gu');
const FB_PATTERNS = [
  { level: 'block', why: 'длинный номер (номер уголовного дела, счета, документа)', re: /\d{15,}/g },
  { level: 'block', why: 'адрес электронной почты', re: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  { level: 'block', why: 'номер телефона', re: /(?:\+7|(?<!\d)8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/g },
  { level: 'block', why: 'фамилия, имя и отчество',
    re: new RegExp(`[${FB_UP}][${FB_LO}]+\\s+[${FB_UP}][${FB_LO}]+\\s+[${FB_UP}][${FB_LO}]+(?:вич|вна|ична|вича|вны|ичны|вичу|вне|ичне|вичем|вной|ичной|оглы|кызы)(?![${FB_LO}])`, 'gu') },
  { level: 'warn', why: 'фамилия с инициалами',
    re: new RegExp(`[${FB_UP}][${FB_LO}]{2,}\\s+[${FB_UP}]\\.\\s?[${FB_UP}]\\.|[${FB_UP}]\\.\\s?[${FB_UP}]\\.\\s?[${FB_UP}][${FB_LO}]{2,}`, 'gu') },
  { level: 'warn', why: 'похоже на адрес', re: new RegExp(`(?<![${FB_LO}])(?:ул|пр-т|просп|пер|мкр|кв|д)\\.\\s*[${FB_UP}\\d]`, 'giu') },
  { level: 'warn', why: 'длинное число – номер документа или счета?', re: /(?<!\d)\d{6,14}(?!\d)/g },
];

const fbLower = (s) => String(s ?? '').toLowerCase().replace(new RegExp(String.fromCharCode(0x451), 'g'), 'е');
const fbWords = (s) => (fbLower(s).match(FB_WORD) ?? []);
const FB_CYR = new RegExp(`[${FB_UP}${FB_LO}]`, 'u');

// Сведения открытого дела и профиля, которых в замечании быть не должно.
// block – фамилии лиц и потерпевших, подпись дела, числа из текстов дела, фамилии из профиля;
// warn – прочие слова с прописной буквы из текстов дела; shingles – пятерки слов длинных текстов (фабула).
// common – слова пакета данных (наименования форм, реквизитов, справочников): их не считаем сведениями дела.
export function feedbackTokens(cases = [], profile = {}, common = new Set()) {
  const out = { block: new Set(), warn: new Set(), digits: new Set(), shingles: new Set() };
  const addWords = (s, level) => {
    for (const m of String(s).matchAll(FB_CAP)) {
      const w = fbLower(m[0]);
      if (!common.has(w)) out[level].add(w);
    }
  };
  const walk = (v, level) => {
    if (typeof v === 'string') {
      if (!FB_CYR.test(v)) return;
      addWords(v, level);
      for (const d of v.match(/\d{5,}/g) ?? []) out.digits.add(d);
      const ws = fbWords(v);
      if (ws.length >= 8) for (let i = 0; i + 5 <= ws.length; i++) out.shingles.add(ws.slice(i, i + 5).join(' '));
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, level));
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x, level);
  };
  for (const c of cases.filter(Boolean)) {
    for (const o of [...(c.persons ?? []), ...(c.victims ?? [])]) walk(o.label ?? '', 'block');
    walk(c.title ?? '', 'block');
    walk(c.label ?? '', 'block');
    walk(c, 'warn');
  }
  for (const [k, v] of Object.entries(profile ?? {})) if (/_fio$/.test(k)) walk(v ?? '', 'block');
  for (const w of out.block) out.warn.delete(w);
  return out;
}

// Находки проверки: [{ level: 'block' | 'warn', text, why }]; block закрывает сохранение замечания
export function feedbackScan(text, tokens = null) {
  const s = String(text ?? '');
  const found = [];
  const seen = new Set();
  const add = (level, t, why) => {
    const key = `${level}|${fbLower(t)}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ level, text: t, why });
  };
  for (const p of FB_PATTERNS) for (const m of s.matchAll(p.re)) add(p.level, m[0].trim(), p.why);
  if (tokens) {
    const words = new Set(fbWords(s));
    for (const w of words) {
      if (tokens.block.has(w)) add('block', w, 'есть в открытом деле или профиле (фамилия, подпись дела)');
      else if (tokens.warn.has(w)) add('warn', w, 'есть в тексте открытого дела');
      else if (w.length >= 5) {
        const stem = [...tokens.block].find((t) => t.length >= 5 && t !== w && (w.startsWith(t.slice(0, -1)) || t.startsWith(w.slice(0, -1))) && Math.abs(t.length - w.length) <= 3);
        if (stem) add('warn', w, `похоже на фамилию из открытого дела или профиля (${stem})`);
      }
    }
    for (const d of s.match(/\d{5,}/g) ?? []) if (tokens.digits.has(d)) add('block', d, 'число из открытого дела');
    const ws = fbWords(s);
    for (let i = 0; i + 5 <= ws.length; i++) {
      const sh = ws.slice(i, i + 5).join(' ');
      if (tokens.shingles.has(sh)) { add('warn', sh, 'совпадает с текстом открытого дела (фабула?)'); break; }
    }
  }
  return found.sort((a, b) => (a.level === b.level ? 0 : a.level === 'block' ? -1 : 1));
}

// ---- замечание и его место в программе ----

export function feedbackWhere(w = {}) {
  const out = {};
  for (const k of FB_WHERE_KEYS) {
    const v = w[k];
    if (Array.isArray(v)) { const a = v.map((x) => String(x).slice(0, 40)).filter(Boolean).slice(0, 30); if (a.length) out[k] = a; }
    else if (v !== null && v !== undefined && v !== '') out[k] = String(v).slice(0, 160);
  }
  return out;
}

export function feedbackWhereText(w = {}) {
  const parts = [];
  if (w.screen) parts.push(`экран «${w.screen}»`);
  if (w.event) parts.push(`событие «${w.event}»`);
  if (w.form) {
    let f = `ф. ${w.form}${w.variant ? ` (${w.variant})` : ''}`;
    if (w.formTitle) f += ` – ${w.formTitle}`;
    parts.push(f);
  }
  if (w.mode) parts.push(`режим «${w.mode}»`);
  if (w.requisites?.length) parts.push(`р. ${w.requisites.join(', ')}${w.requisiteLabel ? ` – «${w.requisiteLabel}»` : ''}`);
  if (w.codes?.length) parts.push(`выбранные коды: ${w.codes.join(', ')}`);
  if (w.factId) parts.push(`вопрос ${w.factId}`);
  return parts.join('; ');
}

export function createFeedback({ kind = 'error', source = 'self', where = {}, fields = {}, today, id } = {}) {
  const k = FEEDBACK_KINDS[kind] ? kind : 'error';
  const keep = Object.fromEntries(FEEDBACK_KINDS[k].fields.map(([f]) => [f, String(fields[f] ?? '').trim().slice(0, 4000)]).filter(([, v]) => v));
  return { id: id ?? `fb-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, created: today, kind: k, source: FEEDBACK_SOURCES[source] ? source : 'self',
    where: feedbackWhere(where), fields: keep, status: 'draft' };
}

export function feedbackText(entry) {
  return Object.values(entry.fields ?? {}).join('\n');
}

// Сведения о среде: только название браузера, его основная версия и система (не вся строка агента)
export function browserName(ua = '', { brave = false } = {}) {
  const os = /Windows NT/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'другая система';
  const pick = [[/YaBrowser\/(\d+)/, 'Яндекс Браузер'], [/Edg\/(\d+)/, 'Edge'], [/OPR\/(\d+)/, 'Opera'], [/Firefox\/(\d+)/, 'Firefox'],
    [/Chrome\/(\d+)/, brave ? 'Brave' : 'Chrome'], [/Version\/(\d+)[\d.]* .*Safari/, 'Safari']];
  for (const [re, name] of pick) { const m = re.exec(ua); if (m) return `${name} ${m[1]}, ${os}`; }
  return `браузер не определен, ${os}`;
}

const fbDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; };

function feedbackSection(e, n) {
  const k = FEEDBACK_KINDS[e.kind] ?? FEEDBACK_KINDS.error;
  const lines = [`## З-${n}. ${k.title}`, ''];
  const where = feedbackWhereText(e.where);
  if (where) lines.push(`- Где: ${where}`);
  lines.push(`- От кого: ${FEEDBACK_SOURCES[e.source] ?? FEEDBACK_SOURCES.self}`);
  if (e.created) lines.push(`- Записано: ${fbDate(e.created)}`);
  if (e.env) lines.push(`- Версия: приложение ${e.env.app}, данные ${e.env.data}, сборка ${e.env.kind}; ${e.env.browser}`);
  for (const [f, label] of k.fields) if (e.fields?.[f]) lines.push('', `**${label}.** ${e.fields[f]}`);
  const meta = { v: 1, id: e.id, kind: e.kind, source: e.source, created: e.created, where: e.where, env: e.env ?? null };
  lines.push('', `<!-- ${FEEDBACK_MARK} ${JSON.stringify(meta).replace(/--/g, '- -')} -->`);
  return lines.join('\n');
}

// Партия замечаний одним файлом .md: читается человеком, разбирается сценарием scripts/feedback/intake.mjs
export function feedbackMarkdown(entries, env = {}, { today } = {}) {
  const head = ['# Замечания к СтатКарте', '',
    `Выгружено ${fbDate(today)}. Приложение ${env.app ?? '?'}, данные ${env.data ?? '?'}, сборка ${env.kind ?? '?'}; ${env.browser ?? ''}.`.replace(/; \.$/, '.'),
    `Замечаний: ${entries.length}. Текст проверен программой на сведения уголовных дел и подтвержден автором.`, ''];
  return `${[...head, ...entries.map((e, i) => feedbackSection({ ...e, env: e.env ?? env }, i + 1))].join('\n\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

// Заготовка заявки на GitHub для одного замечания: адрес открывает сам пользователь в браузере
export function feedbackIssueUrl(repo, entry, env = {}, max = 7000) {
  const k = FEEDBACK_KINDS[entry.kind] ?? FEEDBACK_KINDS.error;
  const where = feedbackWhereText(entry.where);
  const first = Object.values(entry.fields ?? {})[0] ?? '';
  const title = `${k.label[0].toUpperCase()}${k.label.slice(1)}: ${where ? `${where.split('; ').filter((p) => /^ф\.|^р\./.test(p)).join(', ') || where.split('; ')[0]} – ` : ''}${first.replace(/\s+/g, ' ').slice(0, 60)}`;
  const body = feedbackSection({ ...entry, env: entry.env ?? env }, 1).replace(/^## З-1\. .*\n\n/, '');
  const url = `${repo.replace(/\/$/, '')}/issues/new?labels=${encodeURIComponent(`${k.label},из программы`)}&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  return url.length <= max ? url : null;
}

// Разбор файла партии: служебные отметки + текст полей из разделов
export function parseFeedbackFile(text) {
  const out = [];
  const sections = String(text ?? '').split(/^## З-\d+\. /m).slice(1);
  for (const sec of sections) {
    const m = new RegExp(`<!-- ${FEEDBACK_MARK} (\\{.*\\}) -->`).exec(sec);
    if (!m) continue;
    let meta;
    try { meta = JSON.parse(m[1]); } catch { continue; }
    const k = FEEDBACK_KINDS[meta.kind] ?? FEEDBACK_KINDS.error;
    const fields = {};
    for (const [f, label] of k.fields) {
      const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const fm = new RegExp(`\\*\\*${esc}\\.\\*\\* ([\\s\\S]*?)(?=\\n\\n\\*\\*|\\n\\n<!-- )`).exec(sec);
      if (fm) fields[f] = fm[1].trim();
    }
    out.push({ ...meta, fields });
  }
  return out;
}

// Слова пакета данных (наименования форм, реквизитов, справочников, событий): их не считаем сведениями дела
export function feedbackCommonWords(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(new RegExp(`[${FB_UP}${FB_LO}]{3,}`, 'gu'))) out.add(fbLower(m[0]));
  return out;
}
