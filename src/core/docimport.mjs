// Перенос подтвержденных сведений постановления о ВУД в дело (Фаза 2, FR-09).
// В дело попадает только то, что следователь подтвердил; уже внесенное вручную не затирается без его выбора.

import { addObject, addEvent, factAt, setFactVersion } from './model.mjs';
import { applyEventFacts, syncPackage } from './package.mjs';
import { parseQualification } from './uk.mjs';

const CASE_FIELDS = new Set(['fact.case.case_number', 'fact.case.kusp', 'fact.case.kusp_date', 'fact.case.report_source', 'fact.case.investigator']);
const CRIME_FIELDS = new Set(['fact.crime.crime_date', 'fact.crime.ipk_in_r22', 'fact.crime.ipk_in_r23', 'fact.crime.fabula']);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const qualKey = (q) => parseQualification(q).refs.map((r) => `${r.article}/${r.parts.join(',')}/${r.points.join(',')}`).sort().join(';');

// Решение по умолчанию: высокая и средняя уверенность – подтверждено, низкая – нет (ТЗ разд. 9)
export function defaultDecisions(res) {
  return {
    fields: Object.fromEntries(res.fields.map((f) => [f.key, { accept: f.field !== null && f.confidence !== 'low', value: f.value }])),
    episodes: res.episodes.map((e) => ({ accept: e.confidence !== 'low', qualification: e.qualification, person: Boolean(e.person) })),
    // потерпевшие – подсказка: по умолчанию не переносятся (ответ В-41)
    victims: (res.victims ?? []).map((v) => ({ accept: false, label: v.label })),
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

export function importVud(ix, c, res, decisions) {
  const log = { set: [], kept: [], crimes: [], persons: [], victims: [], event: null, reusedEvent: false };
  const val = (rule) => {
    const f = res.fields.find((x) => x.rule === rule);
    const d = f && decisions.fields[f.key];
    return d?.accept ? d.value : null;
  };
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
  res.episodes.forEach((ep, i) => {
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
    const p = ep.person;
    let person = c.persons.find((x) => {
      const s = factAt(c, x, 'fact.person.surname');
      const b = factAt(c, x, 'fact.person.birth_date');
      return s?.value === p.names.surname && (!p.birth || !b || b.value === p.birth);
    });
    if (!person) {
      person = addObject(c, 'person', { label: p.label, crimes: [] });
      const names = { 'fact.person.surname': p.names.surname, 'fact.person.first_name': p.names.first_name, 'fact.person.patronymic': p.names.patronymic, 'fact.person.birth_date': p.birth };
      for (const [fid, v] of Object.entries(names)) if (v) setFactVersion(c, person, fid, 'answered', v, null);
    }
    if (!person.crimes.includes(crime.id)) person.crimes.push(crime.id);
    if (!log.persons.includes(person.id)) log.persons.push(person.id);
  });
  // потерпевшие: объект «Потерпевший» с Ф.И.О. в подписи, связан с эпизодами этого постановления
  (res.victims ?? []).forEach((v, i) => {
    const d = decisions.victims?.[i];
    if (!d?.accept || !d.label) return;
    let victim = c.victims.find((x) => x.label === d.label);
    if (!victim) victim = addObject(c, 'victim', { label: d.label, crimes: [] });
    for (const id of log.crimes) if (!victim.crimes.includes(id)) victim.crimes.push(id);
    if (!log.victims.includes(victim.id)) log.victims.push(victim.id);
  });
  // событие «Возбуждение уголовного дела»: существующее дополняется, иначе создается
  const date = val('x.vud.date');
  let ev = c.events.find((e) => e.type === 'ev.vud');
  if (ev) {
    log.reusedEvent = true;
    for (const id of log.crimes) if (!ev.refs.crimes.includes(id)) ev.refs.crimes.push(id);
    for (const id of log.persons) if (!ev.refs.persons.includes(id)) ev.refs.persons.push(id);
    for (const id of log.victims) if (!ev.refs.victims.includes(id)) ev.refs.victims.push(id);
    if (log.persons.length) ev.attrs.vud_mode = 'person';
  } else if (date && log.crimes.length) {
    ev = addEvent(c, { type: 'ev.vud', date, attrs: { vud_mode: log.persons.length ? 'person' : 'fact' }, refs: { crimes: log.crimes, persons: log.persons, victims: log.victims } });
  }
  if (ev) {
    applyEventFacts(ix, c, ev);
    syncPackage(ix, c, ev);
    log.event = ev.id;
  }
  return log;
}
