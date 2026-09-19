// Валидация пакетов данных: схемы, перекрестные ссылки, покрытие, типографика, манифест.
// Код выхода 1 при ошибках. Запуск: node scripts/validate-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, walk, sha256, schemaFor, readJson, validateSchema, toJsRegex } from './lib-data.mjs';
import { compilePattern } from '../src/core/extract.mjs';

const errors = [];
const warnings = [];
const stats = {};
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);
const ED = '2026';

// 1. Схемы
const schemas = {};
for (const f of walk('data/schema').filter((x) => x.endsWith('.json'))) schemas[path.basename(f, '.schema.json')] = readJson(f);
for (const f of walk('data').filter((x) => x.endsWith('.json'))) {
  const s = schemaFor(f);
  const data = readJson(f);
  if (f === 'data/manifest.json') validateSchema(data, schemas.manifest).forEach((e) => err(`${f} ${e}`));
  else if (s) validateSchema(data, schemas[s]).forEach((e) => err(`${f} ${e}`));
}

// 2. Формы и справочники
const forms = {};
for (const f of walk(`data/forms/${ED}`).filter((x) => /\/(forma-|ipk)/.test(x) && x.endsWith('.json'))) {
  const d = readJson(f);
  forms[d.form] = d;
  const ids = new Set();
  for (const r of d.requisites) {
    if (ids.has(r.id)) err(`${f}: повтор идентификатора реквизита ${r.id}`);
    ids.add(r.id);
    const codes = r.options.map((o) => `${o.group ?? ''}|${o.code}`);
    if (r.input?.fills) for (const fl of r.input.fills) for (const c of [fl.for_code, ...(fl.for_codes ?? [])].filter(Boolean)) if (!r.options.some((o) => o.code === c)) err(`ф. ${d.form} р. ${r.id}: доп. поле для несуществующего кода ${c}`);
    const dup = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (dup.length) warn(`ф. ${d.form} р. ${r.id}: повтор кодов вариантов в одной группе: ${[...new Set(dup)].map((x) => x.split('|')[1]).join(', ')}`);
    if (r.label_status === 'needs_review') warn(`ф. ${d.form} р. ${r.id}: наименование требует сверки с бланком`);
  }
  if (d.requisites_count !== d.requisites.length) err(`${f}: requisites_count ${d.requisites_count} ≠ ${d.requisites.length}`);
}
const clsIndex = readJson(`data/classifiers/${ED}/index.json`).classifiers;
const classifiers = {};
for (const c of clsIndex) {
  const rel = path.posix.normalize(path.posix.join(`data/classifiers/${ED}`, c.file));
  if (!fs.existsSync(path.join(ROOT, rel))) { (c.public ? err : warn)(`справочник № ${c.no}: нет файла ${rel}`); continue; }
  const d = readJson(rel);
  classifiers[c.no] = new Set(d.entries.map((e) => e.code ?? e['Код']));
  if (d.count !== d.entries.length) err(`справочник № ${c.no}: count ${d.count} ≠ ${d.entries.length}`);
  if (c.public && classifiers[c.no].size !== d.entries.length) err(`справочник № ${c.no}: повтор кодов`);
}
for (const d of Object.values(forms))
  for (const r of d.requisites)
    if (r.classifier_no && !(r.classifier_no in classifiers)) err(`ф. ${d.form} р. ${r.id}: справочник № ${r.classifier_no} отсутствует`);
stats.forms = Object.fromEntries(Object.values(forms).map((d) => [d.form, d.requisites.length]));
stats.requisites_total = Object.values(stats.forms).reduce((a, b) => a + b, 0);
stats.classifiers = Object.fromEntries(clsIndex.map((c) => [c.no, classifiers[c.no]?.size ?? 0]));
stats.classifier_codes_1_16 = clsIndex.filter((c) => c.no !== 17).reduce((a, c) => a + (classifiers[c.no]?.size ?? 0), 0);

const reqExists = (form, id) => !!forms[form]?.requisites.some((r) => r.id === id || r.number === id);

// 3. Правила
const facts = new Set(readJson(`data/rules/${ED}/facts.json`).facts.map((x) => x.id));
const mapping = readJson(`data/rules/${ED}/mapping.json`).mapping;
const covered = new Map();
for (const m of mapping) {
  if (!reqExists(m.form, m.requisite)) err(`mapping ${m.id}: нет реквизита ф. ${m.form} р. ${m.requisite}`);
  for (const k of ['value_from', 'value_hint_from']) if (m[k] && !facts.has(m[k])) err(`mapping ${m.id}: нет факта ${m[k]}`);
  const key = `${m.form}|${m.requisite}`;
  covered.set(key, (covered.get(key) ?? 0) + 1);
}
for (const d of Object.values(forms))
  for (const r of d.requisites) {
    const n = covered.get(`${d.form}|${r.id}`) ?? 0;
    if (n !== 1) err(`ф. ${d.form} р. ${r.id}: сопоставлений ${n} (нужно ровно 1)`);
  }
const questions = readJson(`data/rules/${ED}/questions.json`).questions;
for (const q of questions) {
  for (const s of q.sets) if (!facts.has(s)) err(`вопрос ${q.id}: нет факта ${s}`);
  if (q.answer.classifier_no && !(q.answer.classifier_no in classifiers)) err(`вопрос ${q.id}: нет справочника № ${q.answer.classifier_no}`);
  if (q.answer.options_from && !reqExists(q.answer.options_from.form, q.answer.options_from.requisite)) err(`вопрос ${q.id}: нет источника вариантов`);
}
const FNS = new Set(['uk.category', 'uk.category_code', 'uk.stage', 'uk.in_list', 'uk.article_in', 'uk.article_in_note', 'classifier.has_code', 'form.has_option', 'case.has_form', 'form.select_ok', 'text.max_len',
  'package.has_form', 'package.count_cards', 'package.count_cards_case', 'package.count_objects', 'package.req', 'case.had_card']);
const notes = readJson(`data/legal/${ED}/explanations.json`).notes;
for (const hnt of readJson(`data/rules/${ED}/hints.json`).hints) {
  if (!facts.has(hnt.fact)) err(`подсказка ${hnt.id}: нет факта ${hnt.fact}`);
  const q = pack_classifier_of_fact(hnt.fact);
  if (q && classifiers[q]) for (const c of hnt.codes) if (!classifiers[q].has(c)) err(`подсказка ${hnt.id}: кода ${c} нет в справочнике № ${q}`);
}
for (const a of readJson(`data/rules/${ED}/availability.json`).availability) for (const f of a.facts) if (!facts.has(f)) err(`неактивность ${a.id}: нет факта ${f}`);
function pack_classifier_of_fact(fid) {
  const fact = readJson(`data/rules/${ED}/facts.json`).facts.find((x) => x.id === fid);
  return fact?.classifier_no ?? null;
}
const noteIds = new Set(notes.map((n) => n.id));
function refs(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((x) => refs(x, out));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) { if (k === 'fn') { if (!FNS.has(v)) out.push(`!fn:${v}`); } else refs(v, out); }
  return out;
}
function checkRefs(where, node, formsList) {
  for (const s of refs(node)) {
    if (s.startsWith('!fn:')) err(`${where}: неизвестная функция ${s.slice(4)}`);
    else if (/^fact\./.test(s) && !facts.has(s)) err(`${where}: нет факта ${s}`);
    else if (/^req\.[\d.~]+$/.test(s)) for (const f of formsList.filter((x) => x !== '*')) if (!reqExists(f, s.slice(4))) err(`${where}: нет реквизита ф. ${f} р. ${s.slice(4)}`);
    else if (/^gp-razj-/.test(s) && !noteIds.has(s)) err(`${where}: нет разъяснения ${s}`);
  }
}
for (const c of readJson(`data/rules/${ED}/checks.json`).checks) {
  for (const f of c.forms) if (f !== '*' && !forms[f]) err(`проверка ${c.id}: нет формы ${f}`);
  if (c.scope === 'package' && !c.per) err(`проверка ${c.id}: у проверки пакета нет per`);
  checkRefs(`проверка ${c.id}`, { when: c.when, assert: c.assert }, c.scope === 'package' ? [] : c.forms);
  for (const [, fm, rq] of JSON.stringify(c).matchAll(/"fn":"package\.req","args":\["([^"]+)","([^"]+)"\]/g)) if (!reqExists(fm, rq)) err(`проверка ${c.id}: нет реквизита ф. ${fm} р. ${rq}`);
}
// События и состав пакета (Фаза 1.5)
const evPack = readJson(`data/events/${ED}/events.json`);
const evIds = new Set();
const attrIds = new Set(evPack.object_attrs.map((a) => `attr.${a.object === 'damage' ? 'damage' : 'object'}.${a.id}`));
for (const ev of evPack.events) {
  if (evIds.has(ev.id)) err(`событие ${ev.id}: повтор идентификатора`);
  evIds.add(ev.id);
  const own = new Set(['event.date', ...(ev.attrs ?? []).map((a) => `event.${a.id}`)]);
  const refStrings = refs({ final: ev.final, cards: ev.cards.map((c) => c.when ?? null), sets: ev.sets_facts ?? [] });
  for (const s of refStrings) {
    if (s.startsWith('!fn:')) err(`событие ${ev.id}: неизвестная функция ${s.slice(4)}`);
    else if (/^event\./.test(s) && !own.has(s)) err(`событие ${ev.id}: нет атрибута ${s}`);
    else if (/^attr\./.test(s) && !attrIds.has(s)) err(`событие ${ev.id}: нет признака объекта ${s}`);
    else if (/^fact\./.test(s) && !facts.has(s)) err(`событие ${ev.id}: нет факта ${s}`);
  }
  for (const c of [...ev.cards, ...(ev.optional_cards ?? [])]) {
    if (!forms[c.form]) err(`событие ${ev.id}: нет формы ${c.form}`);
    else if (c.variant && !(forms[c.form].variants ?? []).some((v) => v.id === c.variant)) err(`событие ${ev.id}: у формы ${c.form} нет варианта ${c.variant}`);
    if (!c.source_note && !c.note && ev.cards.includes(c)) err(`событие ${ev.id}: у карточки ф. ${c.form} нет источника`);
    for (const rq of [...(c.requisites ?? []), ...(c.optional_requisites ?? []), ...(c.card_fills ?? []).map((x) => x.requisite)]) {
      if (forms[c.form] && !reqExists(c.form, rq)) err(`событие ${ev.id}: у формы ${c.form} нет реквизита ${rq}`);
    }
    for (const cf of c.card_facts ?? []) if (!facts.has(cf.fact)) err(`событие ${ev.id}: нет факта ${cf.fact}`);
    for (const x of c.card_fills ?? []) if (/^event\./.test(x.from) && !own.has(x.from) && x.from !== 'event.source_case_number') err(`событие ${ev.id}: нет атрибута ${x.from}`);
  }
}
for (const f of evPack.transfer_priority) if (!forms[f]) err(`порядок первичности: нет формы ${f}`);
for (const [f, list] of Object.entries(evPack.card_common_requisites ?? {})) {
  if (f === 'note') continue;
  for (const rq of list) if (!reqExists(f, rq)) err(`общие реквизиты карточки: у формы ${f} нет реквизита ${rq}`);
}
for (const pf of evPack.profile_facts ?? []) if (!facts.has(pf.fact)) err(`профиль: нет факта ${pf.fact}`);
const fillKeys = new Set(Object.values(forms).flatMap((f) => f.requisites.flatMap((r) => (r.input?.fills ?? []).map((x) => x.key).filter(Boolean))));
for (const pf of evPack.profile_fills ?? []) if (!fillKeys.has(pf.key)) err(`профиль: нет дополнительного поля с ключом ${pf.key}`);
stats.events = evPack.events.length;
for (const d of readJson(`data/rules/${ED}/derived.json`).derived) {
  if (!facts.has(d.sets)) err(`производное ${d.id}: нет факта ${d.sets}`);
  checkRefs(`производное ${d.id}`, d.expr, []);
}
for (const x of readJson(`data/rules/${ED}/extract.json`).extract) {
  if (x.field !== null && !facts.has(x.field)) err(`извлечение ${x.id}: нет факта ${x.field}`);
  const pats = [...x.patterns, ...[x.clause, x.person, x.unknown_person, x.sentence].filter(Boolean), ...(x.exclude_after ?? []), ...(x.exclude_before ?? [])];
  for (const p of pats) { try { compilePattern(p); } catch (e) { err(`извлечение ${x.id}: шаблон не компилируется: ${e.message}`); } }
  if (x.kind === 'enum' && x.values?.length !== x.patterns.length) err(`извлечение ${x.id}: число значений не равно числу шаблонов`);
}
for (const d of readJson(`data/documents/${ED}/documents.json`).documents) {
  for (const p of d.provides) if (!facts.has(p)) err(`документ ${d.doc_type}: нет факта ${p}`);
  for (const f of d.required_for) if (!forms[f]) err(`документ ${d.doc_type}: нет формы ${f}`);
}
stats.rules = { facts: facts.size, questions: questions.length, mapping: mapping.length, checks: readJson(`data/rules/${ED}/checks.json`).checks.length };

// 4. Нормативная база и разъяснения
const acts = new Set(readJson(`data/legal/${ED}/acts.json`).acts.map((a) => a.id));
let bound = 0;
for (const n of notes) {
  if (!acts.has(n.act)) err(`разъяснение ${n.id}: нет акта ${n.act}`);
  if (n.bindings.length) bound++;
  for (const b of n.bindings) if (!reqExists(b.form, b.requisite)) warn(`разъяснение ${n.id}: привязка к ф. ${b.form} р. ${b.requisite} – реквизита нет в пакете форм`);
}
stats.explanations = { total: notes.length, bound, share: Math.round((bound * 100) / notes.length) };

// 5. УК
const arts = readJson(`data/uk/${ED}/articles.json`).articles;
const parts = arts.filter((a) => !a.repealed).flatMap((a) => a.parts);
stats.uk = {
  articles: arts.length, parts: parts.length,
  by_lists: parts.filter((p) => p.category_source === 'lists').length,
  computed_only: parts.filter((p) => p.category_source === 'computed_only').length,
  conflict: parts.filter((p) => p.category_source === 'conflict').length,
};
const lists = readJson(`data/uk/${ED}/lists.json`).lists;
const items = lists.flatMap((l) => l.sections.flatMap((s) => s.items));
const flagged = items.filter((i) => ['article_not_found', 'part_not_found', 'date_missing'].includes(i.check)).length;
if (flagged) warn(`перечни УК: ${flagged} ссылок с дефектами распознавания (см. docs/import-log-uk-2026.md)`);
stats.uk_lists = { refs: items.length, historical: items.filter((i) => i.check === 'historical').length, stale_in_source: items.filter((i) => i.check === 'stale_in_source').length, defects: flagged };

// 6. Типографика
for (const f of [...walk('data'), ...walk('data-private').filter((x) => !x.includes('/sources/') && !x.includes('/blanks/'))]) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const yo = (t.match(/[ёЁ]/g) ?? []).length;
  const dash = (t.match(/—/g) ?? []).length;
  if (yo || dash) err(`${f}: типографика – «ё» ${yo}, «—» ${dash}`);
}

// 7. Манифест
const man = readJson('data/manifest.json');
const listed = new Map(man.files.map((x) => [x.path, x]));
for (const f of [...walk('data').filter((x) => x !== 'data/manifest.json'), ...walk('data-private').filter((x) => !x.includes('/sources/') && !x.includes('/blanks/work/'))]) {
  const m = listed.get(f);
  if (!m) err(`манифест: файл не учтен ${f}`);
  else if (m.sha256 !== sha256(f)) err(`манифест: контрольная сумма не совпадает ${f}`);
  listed.delete(f);
}
for (const f of listed.keys()) if (!f.startsWith('data-private/') || fs.existsSync(path.join(ROOT, f))) err(`манифест: лишняя запись ${f}`);

// Итог
const summary = { errors: errors.length, warnings: warnings.length, stats };
console.log(JSON.stringify(summary, null, 1));
if (process.argv.includes('--warnings')) warnings.forEach((w) => console.log('  предупреждение:', w));
else if (warnings.length) console.log(`предупреждений: ${warnings.length} (подробно: --warnings)`);
errors.slice(0, 60).forEach((e) => console.log('  ОШИБКА:', e));
process.exit(errors.length ? 1 : 0);
