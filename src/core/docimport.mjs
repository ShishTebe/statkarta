// Перенос подтвержденных сведений постановления о ВУД в дело (Фаза 2, FR-09).
// В дело попадает только то, что следователь подтвердил; уже внесенное вручную не затирается без его выбора.

import { addObject, addEvent, factAt, setFactVersion } from './model.mjs';
import { parseUpkRef } from './extract.mjs';
import { applyEventFacts, syncPackage } from './package.mjs';
import { parseQualification } from './uk.mjs';

const CASE_FIELDS = new Set(['fact.case.case_number', 'fact.case.kusp', 'fact.case.kusp_date', 'fact.case.report_source', 'fact.case.investigator']);
const CRIME_FIELDS = new Set(['fact.crime.crime_date', 'fact.crime.ipk_in_r22', 'fact.crime.ipk_in_r23', 'fact.crime.fabula']);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const qualKey = (q) => parseQualification(q).refs.map((r) => `${r.article}/${r.parts.join(',')}/${r.points.join(',')}`).sort().join(';');

// Решение по умолчанию: высокая и средняя уверенность – подтверждено, низкая – нет (ТЗ разд. 9)
export function defaultDecisions(res) {
  return {
    fields: Object.fromEntries(res.fields.map((f) => [f.key, { accept: !f.info && f.confidence !== 'low', value: f.value }])),
    episodes: res.episodes.map((e) => ({ accept: e.confidence !== 'low', qualification: e.qualification, person: Boolean(e.person) })),
    // потерпевшие – подсказка: по умолчанию не переносятся (ответ В-41)
    victims: (res.victims ?? []).map((v) => ({ accept: false, label: v.label })),
    persons: (res.persons ?? []).map((p) => ({ accept: p.confidence !== 'low', label: p.label })),
    replace: {},
  };
}

// Расхождения с уже внесенными сведениями дела: { field, was, now }
export function importConflicts(c, res, decisions) {
  const out = [];
  for (const f of res.fields) {
    const d = decisions.fields[f.key];
    if (!d?.accept || !CASE_FIELDS.has(f.field) && f.field !== 'fact.damage.amount') continue;
    const cont = f.field === 'fact.damage.amount' ? c.damage : c.case;
    const cur = factAt(c, cont, f.field);
    if (cur && cur.status === 'answered' && !same(cur.value, d.value)) out.push({ field: f.field, label: f.label, was: cur.value, now: d.value });
  }
  return out;
}

function setIfFree(c, cont, field, value, replace, log) {
  const cur = factAt(c, cont, field);
  if (cur && cur.status === 'answered' && !same(cur.value, value) && !replace[field]) { log.kept.push(field); return; }
  setFactVersion(c, cont, field, 'answered', value, null);
  log.set.push(field);
}

// Лицо дела: по фамилии и дате рождения; иначе создается
function personOfCase(c, p) {
  const found = c.persons.find((x) => {
    const surname = factAt(c, x, 'fact.person.surname');
    const birth = factAt(c, x, 'fact.person.birth_date');
    return surname?.value === p.names.surname && (!p.birth || !birth || birth.value === p.birth);
  });
  if (found) return found;
  const person = addObject(c, 'person', { label: p.label, crimes: [] });
  const names = { 'fact.person.surname': p.names.surname, 'fact.person.first_name': p.names.first_name, 'fact.person.patronymic': p.names.patronymic, 'fact.person.birth_date': p.birth };
  for (const [fid, v] of Object.entries(names)) if (v) setFactVersion(c, person, fid, 'answered', v, null);
  return person;
}

// Реабилитирующие основания прекращения (ст. 133 УПК РФ): отсутствие события, состава, непричастность
const REHAB = [{ article: '24', part: '1', point: '1' }, { article: '24', part: '1', point: '2' }, { article: '27', part: '1', point: '1' }];

export function importDoc(ix, c, res, decisions) {
  const log = { set: [], kept: [], crimes: [], persons: [], victims: [], event: null, reusedEvent: false, cardFacts: [] };
  const field = (rule) => res.fields.find((x) => x.rule === rule) ?? null;
  const accepted = (f) => (f && decisions.fields[f.key]?.accept ? decisions.fields[f.key] : null);
  const val = (rule) => accepted(field(rule))?.value ?? null;
  for (const f of res.fields) {
    const d = decisions.fields[f.key];
    if (!d?.accept || f.field === null) continue;
    if (CASE_FIELDS.has(f.field)) setIfFree(c, c.case, f.field, d.value, decisions.replace, log);
    if (f.field === 'fact.damage.amount') {
      setIfFree(c, c.damage, f.field, d.value, decisions.replace, log);
      c.damage.attrs = { ...c.damage.attrs, material: true };
    }
  }
  // эпизоды: тот же состав квалификации – тот же эпизод дела
  (res.episodes ?? []).forEach((ep, i) => {
    const d = decisions.episodes[i];
    if (!d?.accept) return;
    const key = qualKey(d.qualification);
    let crime = c.crimes.find((x) => { const q = factAt(c, x, 'fact.crime.qualification'); return q && qualKey(q.value) === key; });
    if (!crime) {
      // пустой эпизод нового дела (без сведений и без событий) занимается первым
      crime = c.crimes.find((x) => !Object.keys(x.facts ?? {}).length && !c.events.some((e) => e.refs.crimes.includes(x.id))) ?? addObject(c, 'crime');
      setFactVersion(c, crime, 'fact.crime.qualification', 'answered', d.qualification, null);
      for (const f of res.fields) {
        const fd = decisions.fields[f.key];
        if (fd?.accept && CRIME_FIELDS.has(f.field)) setFactVersion(c, crime, f.field, 'answered', fd.value, null);
      }
    }
    if (!log.crimes.includes(crime.id)) log.crimes.push(crime.id);
    if (!d.person || !ep.person) return;
    const person = personOfCase(c, ep.person);
    if (!person.crimes.includes(crime.id)) person.crimes.push(crime.id);
    if (!log.persons.includes(person.id)) log.persons.push(person.id);
  });
  // лица из резолютивной части (обвинение, прекращение преследования)
  (res.persons ?? []).forEach((p, i) => {
    if (!decisions.persons?.[i]?.accept) return;
    const person = personOfCase(c, p);
    for (const id of log.crimes) if (!person.crimes.includes(id)) person.crimes.push(id);
    if (!log.persons.includes(person.id)) log.persons.push(person.id);
  });
  // потерпевшие: объект «Потерпевший» с Ф.И.О. в подписи
  (res.victims ?? []).forEach((v, i) => {
    const d = decisions.victims?.[i];
    if (!d?.accept || !d.label) return;
    let victim = c.victims.find((x) => x.label === d.label);
    if (!victim) victim = addObject(c, 'victim', { label: d.label, crimes: [] });
    for (const id of log.crimes.length ? log.crimes : c.crimes.map((x) => x.id)) if (!victim.crimes.includes(id)) victim.crimes.push(id);
    if (!log.victims.includes(victim.id)) log.victims.push(victim.id);
  });
  // событие документа: состав ссылок и признаки – по описанию документа в пакете (documents.json)
  const evDef = res.doc?.event;
  if (!evDef) return log;
  const date = val(evDef.date_from) ?? val('x.vud.date') ?? val('x.doc.date');
  const refsOf = (what, list) => (what === 'all' ? c.crimes.map((x) => x.id) : what ? list : []);
  const refs = {
    crimes: refsOf(evDef.refs?.crimes, log.crimes),
    persons: refsOf(evDef.refs?.persons, log.persons),
    victims: refsOf(evDef.refs?.victims, log.victims),
  };
  const attrs = {};
  for (const a of evDef.attrs ?? []) {
    if (a.from === 'suspect_known') attrs[a.id] = a.map[String(Boolean(log.persons.length))];
    else {
      const f = field(a.from);
      const d = accepted(f);
      if (!d) continue;
      if (a.use === 'point') attrs[a.id] = f.point ?? null;
      else if (a.use === 'ground_type') {
        const ref = parseUpkRef(f.citation ?? '');
        attrs[a.id] = REHAB.some((x) => ref && x.article === ref.article && x.part === ref.part && x.point === ref.point) ? 'rehab' : 'non_rehab';
      } else attrs[a.id] = d.value;
    }
    if (attrs[a.id] === null || attrs[a.id] === undefined) delete attrs[a.id];
  }
  let ev = evDef.type === 'ev.vud' ? c.events.find((e) => e.type === 'ev.vud') : null;
  if (ev) {
    log.reusedEvent = true;
    for (const kind of ['crimes', 'persons', 'victims']) for (const id of refs[kind]) if (!ev.refs[kind].includes(id)) ev.refs[kind].push(id);
    Object.assign(ev.attrs, attrs);
  } else if (date) {
    ev = addEvent(c, { type: evDef.type, date, attrs, refs });
  }
  if (!ev) return log;
  applyEventFacts(ix, c, ev);
  syncPackage(ix, c, ev);
  log.event = ev.id;
  // реквизиты карточки, которые дает документ (например, ф. 3: основание и дата решения)
  for (const cf of evDef.card_facts ?? []) {
    const f = field(cf.from);
    const d = accepted(f);
    if (!d?.value) continue;
    const card = ev.cards.find((k) => k.form === cf.form && !k.removed);
    if (!card) continue;
    setFactVersion(c, card, cf.fact, 'answered', d.value, ev.id);
    log.cardFacts.push(`${cf.form}: ${cf.fact}`);
  }
  return log;
}

// Постановление о ВУД (Фаза 2): прежнее имя
export function importVud(ix, c, res, decisions) {
  return importDoc(ix, c, res, decisions);
}
