// Модель дела case/2 (Фаза 1.5): объекты учета, события, версии фактов, миграция, срок хранения, журнал.

export const CASE_SCHEMA = 'case/2';
export const OBJECT_KINDS = { crime: 'crimes', person: 'persons', victim: 'victims' };
export const OBJECT_TITLE = { crime: 'Эпизод', person: 'Лицо', victim: 'Потерпевший' };
export const MODE_RU = { new: 'учесть', change: 'изменить', remove: 'снять' };
export const ORIGIN_RU = { rule: 'по правилу', manual_add: 'добавлена вручную', change: 'на основании выставленной' };

export function randomId(prefix) {
  const b = new Uint8Array(6);
  globalThis.crypto.getRandomValues(b);
  return `${prefix}-${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export function createCase2({ title = '', edition = '2026', today = todayIso() } = {}) {
  return {
    schema: CASE_SCHEMA, edition, id: randomId('c'), title, created: today, updated: today,
    case: { facts: {} }, crimes: [], persons: [], victims: [], damage: { attrs: {}, facts: {} },
    events: [], journal: [], seq: { crime: 0, person: 0, victim: 0, event: 0 }, retention: { confirmed: today },
  };
}

// ---- объекты учета ----

export function addObject(c, kind, { id, label = '', crimes = [], attrs = {} } = {}) {
  const list = c[OBJECT_KINDS[kind]];
  c.seq[kind] = Math.max(c.seq[kind] ?? 0, list.length);
  const n = ++c.seq[kind];
  const obj = { id: id ?? `${kind}.${n}`, n, label, attrs: { ...attrs }, facts: {} };
  if (kind !== 'crime') obj.crimes = [...crimes];
  list.push(obj);
  return obj;
}

export function getObject(c, id) {
  if (!id) return null;
  const kind = id.split('.')[0];
  return c[OBJECT_KINDS[kind]]?.find((o) => o.id === id) ?? null;
}

export function objectTitle(c, id) {
  const o = getObject(c, id);
  if (!o) return id;
  const kind = id.split('.')[0];
  return `${OBJECT_TITLE[kind]} ${o.n}${o.label ? ` (${o.label})` : ''}`;
}

// Объект нельзя удалить, пока на него есть выставленная карточка
export function removeObject(c, id) {
  const used = c.events.some((ev) => ev.cards.some((k) => k.issued && Object.values(k.of).includes(id)));
  if (used) return false;
  const kind = id.split('.')[0];
  c[OBJECT_KINDS[kind]] = c[OBJECT_KINDS[kind]].filter((o) => o.id !== id);
  for (const o of [...c.persons, ...c.victims]) o.crimes = o.crimes.filter((x) => x !== id);
  for (const ev of c.events) {
    for (const k of Object.keys(ev.refs)) ev.refs[k] = ev.refs[k].filter((x) => x !== id);
    ev.cards = ev.cards.filter((k) => !Object.values(k.of).includes(id));
  }
  return true;
}

// ---- события ----

export function sortEvents(c) {
  c.events.sort((a, b) => (a.date === b.date ? a.n - b.n : a.date < b.date ? -1 : 1));
}

export function addEvent(c, { type, date, attrs = {}, refs = {} }) {
  const n = ++c.seq.event;
  const ev = { id: `ev.${n}`, n, type, date, attrs: { ...attrs },
    refs: { crimes: [...(refs.crimes ?? [])], persons: [...(refs.persons ?? [])], victims: [...(refs.victims ?? [])] }, cards: [] };
  c.events.push(ev);
  sortEvents(c);
  return ev;
}

export function getEvent(c, id) {
  return c.events.find((e) => e.id === id) ?? null;
}

// Порядок событий: дата, затем порядок создания
export function eventRank(c, evId) {
  if (!evId) return -1;
  return c.events.findIndex((e) => e.id === evId);
}

// ---- факты с версиями (FR-33) ----

// Контейнер фактов: case, экземпляр объекта, ущерб или карточка события
export function container(c, ref) {
  if (ref.kind === 'case') return c.case;
  if (ref.kind === 'damage') return c.damage;
  if (ref.kind === 'card') {
    for (const ev of c.events) { const k = ev.cards.find((x) => x.key === ref.id); if (k) return k; }
    return null;
  }
  return getObject(c, ref.id);
}

function versions(cont, factId) {
  const v = cont?.facts?.[factId];
  if (!v) return [];
  return Array.isArray(v) ? v : [{ event: null, ...v }];
}

// Значение факта на событие: последняя версия, чье событие не позже заданного
export function factAt(c, cont, factId, evId = null) {
  const limit = evId ? eventRank(c, evId) : Infinity;
  let best = null;
  let bestRank = -2;
  for (const v of versions(cont, factId)) {
    const r = eventRank(c, v.event);
    if (v.event && r < 0) continue; // событие удалено
    if (r <= limit && r >= bestRank) { best = v; bestRank = r; }
  }
  return best ? { status: best.status, value: best.value, event: best.event } : null;
}

export function setFactVersion(c, cont, factId, status, value, evId = null) {
  cont.facts ??= {};
  const list = versions(cont, factId).filter((v) => v.event !== evId);
  if (status) {
    const prev = factAt(c, { facts: { [factId]: list } }, factId, evId);
    if (!(prev && evId && prev.status === status && JSON.stringify(prev.value) === JSON.stringify(value))) list.push({ event: evId, status, value });
  }
  if (list.length) cont.facts[factId] = list; else delete cont.facts[factId];
  c.updated = todayIso();
}

// ---- финальное событие и срок хранения (FR-37) ----

export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export function retentionInfo(c, { months = 6, remindDays = 14, today = todayIso(), isFinal, reopens = () => false }) {
  // событие, которое возвращает дело в работу (возвращение на доп. расследование, отмена прекращения,
  // возобновление), отменяет срок хранения от предшествующего финального события
  const lastReopen = c.events.reduce((at, ev, i) => (reopens(ev) ? i : at), -1);
  const finals = c.events.filter((ev, i) => i > lastReopen && isFinal(ev));
  if (!finals.length) {
    const askAt = addMonths(c.retention?.confirmed ?? c.created, months);
    return { final: null, deleteAfter: null, remindAt: askAt, status: today >= askAt ? 'ask_active' : 'active' };
  }
  const final = finals[finals.length - 1];
  const deleteAfter = addMonths(final.date, months);
  const remindAt = addDays(deleteAfter, -remindDays);
  const status = today >= deleteAfter ? 'expired' : today >= remindAt ? 'remind' : 'active';
  return { final: final.id, finalDate: final.date, deleteAfter, remindAt, status };
}

export function confirmActive(c, today = todayIso()) {
  c.retention = { ...(c.retention ?? {}), confirmed: today };
}

// ---- журнал пакета (FR-38) ----

export function journalAdd(c, entry) {
  c.journal.push({ at: todayIso(), ...entry });
}

// Экспорт журнала без сведений о лицах: только условные обозначения экземпляров
export function journalText(c, { formTitle = (f) => `ф. ${f}`, eventTitle = (t) => t } = {}) {
  const obj = (of) => Object.entries(of).map(([k, id]) => `${OBJECT_TITLE[k]} ${getObject(c, id)?.n ?? '?'}`).join(', ');
  const lines = ['Журнал пакета карточек по делу', ''];
  for (const j of c.journal) {
    lines.push(`${isoToRu(j.at)} – ${j.action === 'issued' ? 'выставлена' : j.action === 'unissued' ? 'отметка снята' : j.action}: ${formTitle(j.form, j.variant)}${j.of && Object.keys(j.of).length ? ` (${obj(j.of)})` : ''}, режим «${MODE_RU[j.mode] ?? j.mode}», событие «${eventTitle(j.event_type)}» от ${isoToRu(j.event_date)}`);
  }
  return lines.join('\n');
}

// ---- миграция файлов дела (NFR-12) ----

// case/1 – формат Фазы 1 (приложение 0.2): { answers, fills, forms, created } без поля schema
export function migrateCase(obj, { scopeOf } = {}) {
  if (obj?.schema === CASE_SCHEMA) return obj;
  if (obj && (obj.schema === 'case/1' || (!obj.schema && obj.answers))) {
    const c = createCase2({ today: obj.created ?? todayIso() });
    c.title = 'Перенесено из версии 0.2';
    const crime = addObject(c, 'crime');
    const person = addObject(c, 'person', { crimes: [crime.id] });
    const victim = addObject(c, 'victim', { crimes: [crime.id] });
    const ev = addEvent(c, { type: 'ev.manual', date: obj.created ?? todayIso(), refs: { crimes: [crime.id], persons: [person.id], victims: [victim.id] } });
    const target = { case: c.case, crime, person, victim, damage: c.damage };
    const cardFacts = {};
    for (const [fid, a] of Object.entries(obj.answers ?? {})) {
      const scope = scopeOf ? scopeOf(fid) : fid.split('.')[1];
      if (target[scope]) setFactVersion(c, target[scope], fid, a.status, a.value, null);
      else cardFacts[fid] = a;
    }
    const byForm = {};
    for (const [k, vals] of Object.entries(obj.fills ?? {})) {
      const [form, req] = k.split('|');
      (byForm[form] ??= {})[k] = vals;
      void req;
    }
    const FORM_OBJECT = { 1: 'crime', 1.1: 'crime', 2: 'person', 2.1: 'person', 5: 'victim', 6: 'person' };
    for (const form of new Set([...(obj.forms ?? []), ...Object.keys(byForm)])) {
      const kind = FORM_OBJECT[form];
      const of = kind ? { [kind]: target[kind].id } : {};
      const card = { key: `${ev.id}|${form}|${Object.values(of).join('+')}`, form, variant: null, of, mode: 'new', origin: 'manual_add', facts: {}, fills: byForm[form] ?? {}, issued: null };
      for (const [fid, a] of Object.entries(cardFacts)) card.facts[fid] = [{ event: null, status: a.status, value: a.value }];
      ev.cards.push(card);
    }
    if (!ev.cards.length && Object.keys(cardFacts).length) {
      ev.cards.push({ key: `${ev.id}|1|${crime.id}`, form: '1', variant: null, of: { crime: crime.id }, mode: 'new', origin: 'manual_add',
        facts: Object.fromEntries(Object.entries(cardFacts).map(([fid, a]) => [fid, [{ event: null, status: a.status, value: a.value }]])), fills: {}, issued: null });
    }
    c.migrated_from = 'case/1';
    return c;
  }
  throw new Error('Файл дела неизвестной версии схемы');
}
