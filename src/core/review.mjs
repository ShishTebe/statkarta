// Ревизия правил в программе (ответ В-74, документ 23, ступень 2.1): перечень правил пакета данных
// в читаемом виде и отметки «верно / неверно / уточнить». Отметки выгружаются той же партией, что и замечания.

export const REVIEW_VERDICTS = { ok: 'верно', wrong: 'неверно', unclear: 'уточнить' };
export const REVIEW_GROUPS = {
  events: 'Состав пакета карточек по событию',
  event_facts: 'Сведения, которые ставит событие',
  mapping: 'Какой вопрос заполняет реквизит',
  derived: 'Умолчания и подсказки по квалификации',
  hints: 'Подсказки кодов',
  availability: 'Реквизиты, которые не заполняются',
  checks: 'Проверки карточек и пакета',
  extract: 'Извлечение сведений из документов',
};
export const REVIEW_MARK = 'statkarta-review';

const RV_PER = { crime: 'на каждый эпизод', victim: 'на каждого потерпевшего', person: 'на каждое лицо', person_crime: 'на каждое лицо по каждому его эпизоду',
  crime_without_person: 'на каждый эпизод без установленного лица', foreign_participant: 'на каждого иностранного участника', case: 'одна на дело' };
const RV_PART = { title: 'наименование', header: 'шапка', intro: 'вводная часть', descriptive: 'описательная часть (УСТАНОВИЛ)', resolutive: 'резолютивная часть (ПОСТАНОВИЛ)', body: 'весь текст' };
const RV_CONF = { high: 'высокая', medium: 'средняя', low: 'низкая' };
const rvForm = (form, variant) => (form === 'ipk' ? (variant === 'pr' ? 'ИПК-ПР' : variant === 'lc' ? 'ИПК-ЛЦ' : 'ИПК') : form === 'ipk-in' ? 'карта на иностранца' : `ф. ${form}`);
const rvShort = (s, n = 90) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// Условие правила словами: факты – по наименованию, операции – по-русски
export function reviewExprText(e, name = (x) => x, value = (ref, v) => v) {
  if (e === null || e === undefined) return '';
  if (typeof e !== 'object') return String(e);
  if (Array.isArray(e)) return e.map((x) => reviewExprText(x, name, value)).join(', ');
  const [op, a] = Object.entries(e).find(([k]) => k !== 'fn' && k !== 'args') ?? [];
  if (e.fn) {
    const args = (e.args ?? []).map((x) => (typeof x === 'string' ? name(x) : String(x)));
    if (e.fn === 'uk.in_list') return `${args[0]}: статья входит в перечень № ${args[1]}`;
    if (e.fn === 'uk.category') return `категория по ст. 15 УК РФ из ${args[0]}`;
    if (e.fn === 'case.had_card') return `в деле уже есть карточка ${rvForm(args[0], args[1])}`;
    if (e.fn === 'case.has_form' || e.fn === 'package.has_form') return `${e.fn === 'case.has_form' ? 'в деле' : 'в пакете'} есть карточка ${rvForm(args[0], args[1])}`;
    if (e.fn === 'text.max_len') return `длина ${args[0]} не больше ${args[1]} знаков`;
    return `${e.fn}(${args.join(', ')})`;
  }
  const val = (x) => (typeof x === 'string' && /^(fact|attr|event)\./.test(x) ? name(x) : Array.isArray(x) ? `[${x.join(', ')}]` : `«${x}»`);
  switch (op) {
    case 'any': return `(${a.map((x) => reviewExprText(x, name, value)).join(' или ')})`;
    case 'all': return `(${a.map((x) => reviewExprText(x, name, value)).join(' и ')})`;
    case 'not': return `не ${reviewExprText(a, name, value)}`;
    case 'eq': return `${val(a[0])} = ${a[1] === false ? 'нет' : a[1] === true ? 'да' : val(value(a[0], a[1]))}`;
    case 'ne': return `${val(a[0])} ≠ ${val(value(a[0], a[1]))}`;
    case 'in': return `${val(a[0])} одно из ${val(a[1])}`;
    case 'empty': return `${val(a)} не заполнено`;
    case 'exists': return `${val(a)} заполнено`;
    case 'na': return `${val(a)} – «не применимо»`;
    case 'matches': return `${val(a[0])} содержит /${a[1]}/`;
    case 'always': return 'всегда';
    default: return `${op}: ${JSON.stringify(a)}`;
  }
}

// Перечень правил: [{ id, group, form, requisite, title, detail, source }] – порядок устойчивый
export function reviewRules(pack, { formTitle = rvForm } = {}) {
  const out = [];
  const rules = pack.rules ?? {};
  const facts = new Map((rules.facts ?? []).map((f) => [f.id, f.label]));
  const qByFact = new Map();
  for (const q of rules.questions ?? []) for (const f of q.sets ?? []) if (!qByFact.has(f)) qByFact.set(f, q.text);
  const objAttr = new Map((pack.events?.object_attrs ?? []).map((a) => [`attr.${a.object === 'damage' ? 'damage' : 'object'}.${a.id}`, a.label]));
  objAttr.set('attr.object.legal_entity', 'Потерпевший – юридическое лицо');
  let evAttrs = new Map();
  const name = (id) => { if (evAttrs.has(id)) return `«${rvShort(evAttrs.get(id).label, 60)}»`; if (objAttr.has(id)) return `«${rvShort(objAttr.get(id), 60)}»`; if (id === 'event.date') return 'дата события'; const base = String(id).replace(/\.(date|opt[0-9a-f]+)$/, ''); const l = facts.get(id) ?? facts.get(base) ?? qByFact.get(id) ?? qByFact.get(base); return l ? `«${rvShort(l, 60)}»` : id; };
  const reqLabel = new Map();
  for (const f of pack.forms ?? []) for (const r of f.requisites ?? []) reqLabel.set(`${f.form}|${r.number}`, r.label);
  const formsOf = (list) => (list ?? []).filter((x) => x !== '*');
  const value = (ref, v) => evAttrs.get(ref)?.options?.find((o) => o.code === v)?.value ?? v;
  for (const ev of pack.events?.events ?? []) {
    evAttrs = new Map((ev.attrs ?? []).map((a) => [`event.${a.id}`, a]));
    (ev.cards ?? []).forEach((c, i) => out.push({ id: `${ev.id}#card.${i + 1}`, group: 'events', form: c.form, requisite: null,
      title: `${ev.title}: ${formTitle(c.form, c.variant)}${c.per ? ` – ${RV_PER[c.per] ?? c.per}` : ''}`,
      detail: [c.when ? `Если ${reviewExprText(c.when, name, value)}` : '', c.mode ? `режим ${c.mode}` : ''].filter(Boolean).join('; '), source: c.source_note ?? '' }));
    (ev.sets_facts ?? []).forEach((s, i) => out.push({ id: `${ev.id}#fact.${i + 1}`, group: 'event_facts', form: null, requisite: null,
      title: `${ev.title}: ${name(s.fact)} ← ${s.from ? (s.from === 'event.date' ? 'дата события' : s.from) : `код ${(s.value ?? []).join(', ').replace(/\|/g, '')}`}`,
      detail: s.when ? `Если ${reviewExprText(s.when, name, value)}` : '', source: s.note ?? s.source_note ?? '' }));
  }
  evAttrs = new Map();
  for (const m of rules.mapping ?? []) out.push({ id: m.id, group: 'mapping', form: m.form, requisite: m.requisite,
    title: `${formTitle(m.form)} р. ${m.requisite} «${rvShort(reqLabel.get(`${m.form}|${m.requisite}`), 70)}» ← ${name(m.value_from)}`,
    detail: m.match === 'shared' ? 'сведение общее для нескольких карточек' : 'сведение только этого реквизита', source: m.source_note ?? '' });
  for (const d of rules.derived ?? []) out.push({ id: d.id, group: 'derived', form: null, requisite: null,
    title: `${name(d.sets)} ← ${reviewExprText(d.expr, name)}`, detail: d.status_value === 'hint' ? 'подсказка' : 'умолчание', source: d.source_note ?? '' });
  for (const hn of rules.hints ?? []) out.push({ id: hn.id, group: 'hints', form: null, requisite: null,
    title: rvShort(hn.text, 160), detail: `${name(hn.fact)}; если ${reviewExprText(hn.when, name)}; коды: ${(hn.codes ?? []).slice(0, 12).join(', ')}${(hn.codes ?? []).length > 12 ? '…' : ''}`, source: hn.source_note ?? '' });
  for (const a of rules.availability ?? []) out.push({ id: a.id, group: 'availability', form: null, requisite: null,
    title: rvShort(a.reason, 160), detail: `Не заполняются: ${(a.facts ?? []).map(name).join(', ')}; если ${reviewExprText(a.disabled_when, name)}`, source: a.source_note ?? '' });
  for (const c of rules.checks ?? []) out.push({ id: c.id, group: 'checks', form: formsOf(c.forms).join(', ') || null, requisite: null,
    title: rvShort(c.message, 160), detail: `${c.severity === 'error' ? 'ошибка' : 'предупреждение'}; формы: ${(c.forms ?? []).join(', ')}${c.scope === 'package' ? '; по пакету события' : ''}`, source: c.source_note ?? '' });
  for (const x of rules.extract ?? []) out.push({ id: x.id, group: 'extract', form: null, requisite: null,
    title: `${x.label ?? name(x.field)} – ${x.doc_type === '*' ? 'из любого документа' : `из документа «${x.doc_type}»`}`,
    detail: `где искать: ${(x.parts ?? []).map((p) => RV_PART[p] ?? p).join(', ')}; уверенность: ${RV_CONF[x.confidence] ?? x.confidence ?? '–'}`, source: x.source_note ?? '' });
  return out;
}

// Отметка ревизии: правило, оценка, основание (для «неверно» и «уточнить»), версия данных
export function createReviewMark({ rule, verdict, comment = '', today, data } = {}) {
  return { rule: String(rule), verdict: REVIEW_VERDICTS[verdict] ? verdict : 'unclear', comment: String(comment ?? '').trim().slice(0, 2000), date: today, data: data ?? null, status: 'draft' };
}

export function reviewCoverage(rules, marks) {
  const byRule = new Map((marks ?? []).map((m) => [m.rule, m]));
  const out = {};
  for (const r of rules) {
    const g = out[r.group] ?? (out[r.group] = { total: 0, ok: 0, wrong: 0, unclear: 0 });
    g.total++;
    const m = byRule.get(r.id);
    if (m) g[m.verdict]++;
  }
  return out;
}

// Раздел партии: таблица для чтения и служебная отметка для сценария приема
export function reviewMarkdown(marks, rules = []) {
  if (!marks.length) return '';
  const byId = new Map(rules.map((r) => [r.id, r]));
  const cell = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/');
  const d = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; };
  const lines = ['## Ревизия правил', '', `Отметок: ${marks.length} (верно – ${marks.filter((m) => m.verdict === 'ok').length}, неверно – ${marks.filter((m) => m.verdict === 'wrong').length}, уточнить – ${marks.filter((m) => m.verdict === 'unclear').length}).`, '',
    '| Правило | Вид | Что проверено | Оценка | Основание или что не так | Дата |', '|---|---|---|---|---|---|'];
  for (const m of marks) {
    const r = byId.get(m.rule);
    lines.push(`| ${cell(m.rule)} | ${cell(REVIEW_GROUPS[r?.group] ?? '')} | ${cell(rvShort(r?.title ?? '', 120))} | ${REVIEW_VERDICTS[m.verdict]} | ${cell(m.comment)} | ${d(m.date)} |`);
  }
  const meta = marks.map(({ rule, verdict, comment, date, data }) => ({ rule, verdict, comment, date, data }));
  lines.push('', `<!-- ${REVIEW_MARK} ${JSON.stringify(meta).replace(/--/g, '- -')} -->`);
  return lines.join('\n');
}

export function parseReviewFile(text) {
  const m = new RegExp(`<!-- ${REVIEW_MARK} (\\[.*\\]) -->`).exec(String(text ?? ''));
  if (!m) return [];
  try { return JSON.parse(m[1]); } catch { return []; }
}
