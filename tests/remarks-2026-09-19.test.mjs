// Автотесты по замечаниям пользователя от 19.09.2026 (проверка на реальном деле).
// Запуск: node --test tests/remarks-2026-09-19.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importCore } from '../scripts/bundle.mjs';
import { loadPack } from '../scripts/load-pack.mjs';
import { ROOT } from '../scripts/lib-data.mjs';

const core = await importCore();
const pack = loadPack();
const ix = core.indexPack(pack);
const LAYOUTS = path.join(ROOT, 'data/layout/2026');
const hasLayouts = fs.existsSync(LAYOUTS);
const layoutOf = (name) => JSON.parse(fs.readFileSync(path.join(LAYOUTS, name), 'utf8'));
const PROFILE = { organ_name: 'Тестовый следственный отдел', organ_code: '02', unit_code: '02300003', investigator_fio: 'В.В.В.' };
const CASE_NO = '12600000001000045';

// Дело: эпизод, лицо (без связи с эпизодом – как на реальном деле), номер дела и КРСП
function baseCase() {
  const c = core.createCase2({ today: '2026-09-19' });
  core.addObject(c, 'crime');
  core.addObject(c, 'person');
  core.setFactVersion(c, c.case, 'fact.case.case_number', 'answered', CASE_NO);
  core.setFactVersion(c, c.case, 'fact.case.kusp', 'answered', '1234');
  core.setFactVersion(c, c.case, 'fact.case.kusp_date', 'answered', '2026-09-10');
  core.setFactVersion(c, c.crimes[0], 'fact.crime.qualification', 'answered', 'п. «в» ч. 2 ст. 158 УК РФ');
  core.setFactVersion(c, c.crimes[0], 'fact.crime.crime_date', 'answered', '2026-09-01');
  return c;
}
function runEvent(c, type, attrs = {}, refs = { crimes: ['crime.1'] }) {
  const ev = core.addEvent(c, { type, date: '2026-09-19', attrs, refs });
  core.applyEventFacts(ix, c, ev);
  core.syncPackage(ix, c, ev);
  return ev;
}
const memosOf = (c, ev) => core.buildPackageMemos(ix, c, ev, PROFILE);

test('Контроль карточки: межкарточные правила не выполняются в памятке отдельной карточки', () => {
  const c = baseCase();
  const ev = runEvent(c, 'ev.to_court', {}, { crimes: ['crime.1'], persons: ['person.1'] });
  for (const memo of memosOf(c, ev).values()) {
    const failed = memo.checks.filter((x) => /Проверка не выполнена/.test(x.message));
    assert.deepEqual(failed.map((x) => x.id), [], memo.cardTitle);
  }
});

test('Раздел 1: номер дела и КРСП, внесенные следователем, идут в памятку и в бланк', { skip: !hasLayouts && 'нет карт раскладки' }, () => {
  const c = baseCase();
  const ev = runEvent(c, 'ev.vud', { vud_mode: 'fact' });
  const f1 = [...memosOf(c, ev).values()].find((m) => m.form === '1');
  const r3 = f1.rows.find((r) => r.id === '3');
  assert.equal(r3.status, 'fill');
  assert.equal(r3.value, CASE_NO);
  const plan = core.planBlank(f1, layoutOf('forma-1.json'), { profile: PROFILE });
  const p3 = plan.fields.find((f) => f.requisite === '3');
  assert.equal(p3.edits.map((e) => e.text).join(''), CASE_NO, 'номер дела – 17 цифр в 17 клеток');
  const p5 = plan.fields.find((f) => f.requisite === '5');
  assert.equal(p5.edits.map((e) => e.text).join(''), '123420260910', 'КРСП: номер и дата «год мес. чис.»');
  // номер с разделителями раскладывается цифрами
  const dashed = core.planField({ ...r3, value: '1-26-00000001-000045' }, { requisite: '3', groups: [[...Array(17).keys()]] });
  assert.equal(dashed.edits.map((e) => e.text).join(''), CASE_NO);
});

test('ОКАТО 11 разрядов раскладывается по группам 2-3-3-3 (ф. 1 р. 19.1)', { skip: !hasLayouts && 'нет карт раскладки' }, () => {
  const field = layoutOf('forma-1.json').fields.find((f) => f.requisite === '19.1');
  const row = { id: '19.1', number: '19.1', status: 'fill', fills_by: 'investigator', value: ['|30401000000'],
    requisite: ix.reqs.get('1').get('19.1') };
  const p = core.planField(row, field);
  assert.ok(!p.blocked, p.notes.join('; '));
  assert.equal(p.edits.length, 11);
  assert.equal(p.edits.map((e) => e.text).join(''), '30401000000');
  assert.deepEqual(p.edits.map((e) => e.shape), field.groups.flat(), 'разряды – подряд по клеткам слева направо');
});

test('ИПК: вид карты в бланке – по варианту карточки (ЛЦ или ПР)', { skip: !hasLayouts && 'нет карт раскладки' }, () => {
  const layout = layoutOf('forma-ipk.json');
  for (const [variant, mark] of [['lc', 'ЛЦ'], ['pr', 'ПР']]) {
    const plan = core.planBlank({ form: 'ipk', variant, rows: [], checks: [], facts: {}, fills: {} }, layout);
    const e = plan.cellEdits.find((x) => x.place.table === 1 && x.place.row === 0 && x.place.cell === 2);
    assert.equal(e?.text, mark, variant);
  }
});

test('ВУД в отношении лица: лицо, связанное с эпизодом, дает ИПК-ЛЦ', () => {
  const c = baseCase();
  core.getObject(c, 'person.1').crimes = ['crime.1'];
  const ev = runEvent(c, 'ev.vud', { vud_mode: 'person' }, { crimes: ['crime.1'], persons: ['person.1'] });
  const ipk = core.activeCards(ev).filter((k) => k.form === 'ipk');
  assert.deepEqual(ipk.map((k) => k.variant), ['lc']);
});

test('Ф. 3: на каждое событие – свой набор реквизитов, остальные не заполняются', () => {
  const c = baseCase();
  const ev = runEvent(c, 'ev.extend');
  const f3 = [...memosOf(c, ev).values()].find((m) => m.form === '3');
  const st = Object.fromEntries(f3.rows.map((r) => [r.id, r.status]));
  for (const id of ['9', '9.1', '10']) assert.equal(st[id], 'unanswered', `р. ${id} относится к продлению`);
  for (const id of ['7', '8', '12', '13', '16', '17']) assert.equal(st[id], 'not_applicable', `р. ${id} не относится к продлению`);
  assert.equal(st['3'], 'fill', 'номер дела – общий реквизит');
  const pq = core.packageQuestions(ix, c, ev, PROFILE);
  const reqs = pq.groups.flatMap((g) => g.items).flatMap((it) => it.requisites).filter((r) => r.form === '3').map((r) => r.id);
  assert.ok(!reqs.includes('13') && !reqs.includes('17'), 'опросник не спрашивает реквизиты других событий');
  assert.ok(reqs.includes('9'), 'опросник спрашивает реквизит события');
});

test('Ф. 3 р. 8: номер дела при соединении и выделении подставляется из события', () => {
  const c = baseCase();
  const ev = runEvent(c, 'ev.join', { joined_to: '12600000001000001' });
  const f3 = ev.cards.find((k) => k.form === '3');
  assert.equal(f3.fills['3|8'][0], '12600000001000001');
  const r8 = ix.reqs.get('3').get('8');
  assert.deepEqual(r8.input.fills[0].for_codes, ['1', '2', '3'], 'поле номера дела – для всех трех кодов');
  const split = core.addEvent(c, { type: 'ev.split', date: '2026-09-19', attrs: { new_case_number: '12600000001000099' }, refs: { crimes: ['crime.1'] } });
  const nc = core.spawnCase(ix, c, split);
  const nf3 = nc.events[0].cards.find((k) => k.form === '3');
  assert.equal(nf3.fills['3|8'][0], CASE_NO, 'выделено из дела – номер исходного дела');
  assert.equal(core.factAt(nc, nf3, 'fact.f3.r8').value[0], '|2');
});

test('Ф. 3: р. 16 – наложение кодов по разрядам (ответ В-30); у вариантов р. 12, 13, 17 – полный смысл кода', () => {
  assert.equal(ix.reqs.get('3').get('16').input.select, 'overlay');
  for (const id of ['12', '13', '17']) {
    for (const o of ix.reqs.get('3').get(id).options) {
      assert.ok(o.hint || o.value.length > 20, `р. ${id} код ${o.code}: «${o.value}» без пояснения`);
    }
  }
  const o52 = ix.reqs.get('3').get('13').options.find((o) => o.code === '52');
  assert.match(o52.value, /п\. 3 ч\. 1 ст\. 24/);
  assert.match(o52.hint, /сроков давности/);
});

test('Подсказка по ссылке на УПК РФ в тексте варианта', () => {
  assert.equal(core.legalRefHint('п. 2 ч. 1 ст. 24 УПК РФ'), 'п. 2 ч. 1 ст. 24 УПК РФ – отсутствие в деянии состава преступления');
  assert.match(core.legalRefHint('по п. 4 ч. 1 ст. 208 УПК РФ'), /тяжелое заболевание/);
  assert.equal(core.legalRefHint('ст. 25 УК РФ'), '', 'статьи УК РФ не толкуются как УПК');
});

test('Типографика новых данных: без «ё» и «—»', () => {
  for (const f of ['scripts/import/form-labels-2026.json', 'data/forms/2026/forma-3.json', 'data/events/2026/events.json', 'src/core/text.mjs', 'src/core/blank.mjs', 'src/ui/app.mjs']) {
    assert.ok(!/[ёЁ—]/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f);
  }
});

test('Раздел 1: номер дела в реквизите «вид номера» не считается неверным кодом', () => {
  const c = baseCase();
  const ev = runEvent(c, 'ev.vud', { vud_mode: 'fact' });
  for (const memo of memosOf(c, ev).values()) {
    const bad = memo.checks.filter((x) => x.id === 'c.enum_code_valid' && x.requisites.includes('3'));
    assert.deepEqual(bad, [], memo.cardTitle);
  }
});

test('В-31, В-32: наборы реквизитов ф. 3 по событиям и новые события', () => {
  const scopeOf = (type, attrs = {}, refs = { crimes: ['crime.1'] }) => {
    const c = baseCase();
    const ev = runEvent(c, type, attrs, refs);
    const f3 = [...memosOf(c, ev).values()].find((m) => m.form === '3');
    return { st: Object.fromEntries(f3.rows.map((r) => [r.id, r.status])), f3 };
  };
  const req = (type, ids, attrs, refs) => { const { st } = scopeOf(type, attrs, refs); for (const id of ids) assert.notEqual(st[id], 'not_applicable', `${type}: р. ${id}`); };
  req('ev.to_court', ['13', '13.1'], {}, { crimes: ['crime.1'], persons: ['person.1'] });
  req('ev.refusal', ['13', '13.1'], { ground_type: 'rehab' });
  req('ev.terminate', ['13', '13.1'], { ground_type: 'rehab' });
  req('ev.to_prosecutor', ['12.2', '12.3'], {}, {});
  req('ev.return', ['16', '16.1'], {}, {});
  req('ev.cancel', ['18', '18.1'], {}, {});
  req('ev.transfer', ['7', '7.1'], { deregister: false });
  const { f3 } = scopeOf('ev.court_fine', {}, { crimes: ['crime.1'], persons: ['person.1'] });
  assert.equal(f3.rows.find((r) => r.id === '13').display.slice(0, 2), '62', 'судебный штраф – код 62 в р. 13');
});

test('Возвращение на доп. расследование после финального события снимает срок хранения', () => {
  const c = baseCase();
  const def = (ev) => core.eventsIndex(ix).byId.get(ev.type);
  const isFinal = (ev) => core.isFinalEvent(ix, c, ev);
  const reopens = (ev) => def(ev)?.reopens === true;
  const court = core.addEvent(c, { type: 'ev.to_court', date: '2026-03-01', refs: { crimes: ['crime.1'] } });
  assert.equal(core.retentionInfo(c, { today: '2026-09-19', isFinal, reopens }).final, court.id);
  core.addEvent(c, { type: 'ev.return', date: '2026-04-01' });
  assert.equal(core.retentionInfo(c, { today: '2026-09-19', isFinal, reopens }).final, null);
});

test('В-33: судебный штраф – комплект как при направлении в суд (ф. 1.1, 2, 3, 4, ИПК-ЛЦ); отмена прекращения – только ф. 3', () => {
  const c = baseCase();
  core.getObject(c, 'person.1').crimes = ['crime.1'];
  c.damage.attrs = { material: true };
  const fine = runEvent(c, 'ev.court_fine', {}, { crimes: ['crime.1'], persons: ['person.1'] });
  assert.deepEqual(core.activeCards(fine).map((k) => `${k.form}${k.variant ? `:${k.variant}` : ''}`).sort(), ['1.1', '2', '3', '4', 'ipk:lc']);
  const cancel = runEvent(c, 'ev.cancel', {}, {});
  assert.deepEqual(core.activeCards(cancel).map((k) => k.form), ['3']);
});
