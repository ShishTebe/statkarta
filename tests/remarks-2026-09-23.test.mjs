// Автотесты по замечаниям пользователя от 23.09.2026 (проверка заполненных бланков ф. 3 и ф. 1.1).
// Запуск: node --test tests/remarks-2026-09-23.test.mjs
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
const BLANKS = path.join(ROOT, 'data/blanks/2026');
const hasLayouts = fs.existsSync(LAYOUTS);
const hasBlanks = fs.existsSync(BLANKS);
const layoutOf = (name) => JSON.parse(fs.readFileSync(path.join(LAYOUTS, name), 'utf8'));
const PROFILE = { organ_name: 'Тестовый следственный отдел', organ_code: '02', unit_code: '02300003',
  investigator_position: 'следователь', investigator_rank: 'майор юстиции', investigator_fio: 'И.И. Иванов' };
const CASE_NO = '12600000001000045';

function baseCase() {
  const c = core.createCase2({ today: '2026-09-23' });
  core.addObject(c, 'crime');
  core.addObject(c, 'person');
  core.setFactVersion(c, c.case, 'fact.case.case_number', 'answered', CASE_NO);
  core.setFactVersion(c, c.crimes[0], 'fact.crime.qualification', 'answered', 'пп. «а д» ч. 2 ст. 158 УК РФ');
  core.setFactVersion(c, c.crimes[0], 'fact.crime.crime_date', 'answered', '2026-09-01');
  return c;
}
function runEvent(c, type, attrs = {}, refs = { crimes: ['crime.1'] }) {
  const ev = core.addEvent(c, { type, date: '2026-09-23', attrs, refs });
  core.applyEventFacts(ix, c, ev);
  core.syncPackage(ix, c, ev);
  return ev;
}
// Карточка ф. 1.1 события прекращения и план ее бланка
function f11(fill = () => {}) {
  const c = baseCase();
  const ev = runEvent(c, 'ev.terminate', { ground_type: 'non_rehab' }, { crimes: ['crime.1'], persons: ['person.1'] });
  const card = ev.cards.find((k) => k.form === '1.1');
  fill(c, ev, card);
  const memo = core.buildPackageMemos(ix, c, ev, PROFILE).get(card.key);
  const plan = hasLayouts ? core.planBlank(memo, layoutOf('forma-1-1.json'), { profile: PROFILE }) : null;
  return { c, ev, card, memo, plan };
}
const fieldOf = (plan, id) => plan.fields.find((f) => f.requisite === id);
const charsOf = (plan, id) => (fieldOf(plan, id)?.edits ?? []).map((e) => e.text).join('');

test('Пункты статьи через пробел – два пункта, а не пробел в клетке (ф. 1.1 р. 7)', () => {
  const q = core.parseQualification('пп. «а д» ч. 2 ст. 158 УК РФ');
  assert.deepEqual(q.main[0].points, ['а', 'д']);
  assert.deepEqual(core.parseQualification('пп. а д ч. 2 ст. 158 УК РФ').main[0].points, ['а', 'д']);
  assert.deepEqual(core.parseQualification('п. «в» ч. 2 ст. 158 УК РФ').main[0].points, ['в']);
});

test('Ф. 1.1 р. 7: пункты идут в соседние клетки, пробел клетку не занимает', { skip: !hasLayouts && 'нет карт раскладки' }, () => {
  const { plan } = f11();
  const p7 = fieldOf(plan, '7');
  const points = p7.edits.filter((e) => /^[а-я]$/i.test(e.text)).map((e) => e.shape);
  assert.deepEqual(p7.edits.filter((e) => e.text === ' '), [], 'пробел в клетки не вписывается');
  assert.equal(points.length, 2, 'два пункта – две клетки');
  assert.equal(points[1] - points[0], 1, 'клетки соседние');
});

test('Ф. 1.1 р. 7.1: квалификация по правилам р. 7 и количество преступлений', { skip: !hasLayouts && 'нет карт раскладки' }, () => {
  const { plan } = f11((c, ev, card) => {
    core.setFactVersion(c, c.crimes[0], 'fact.crime.laundering_predicate', 'answered', 'п. «а» ч. 2 ст. 158 УК РФ; ч. 4 ст. 159 УК РФ');
    core.setCardFill(ev, card.key, '7.1', 0, '2');
    core.setCardFill(ev, card.key, '7.1', 1, '1');
  });
  const text = charsOf(plan, '7.1');
  assert.equal(text, '2' + '158' + '2' + 'а' + '1' + '159' + '4', 'кол-во, статья, часть и пункт каждой строки');
  const field = layoutOf('forma-1-1.json').fields.find((f) => f.requisite === '7.1');
  assert.deepEqual([...new Set(field.parts.map((p) => p.role))], ['fill', 'qual'], 'р. 7.1 заполняется как р. 7');
});

test('Ф. 1.1 р. 25 и 25.1: дата принятия решения проставляется в клетки', { skip: !hasLayouts && 'нет карт раскладки' }, () => {
  const { plan } = f11((c, ev, card) => {
    core.setFactVersion(c, card, 'fact.f1_1.r25', 'answered', ['|52']);
    core.setCardFill(ev, card.key, '25', 0, '23.09.2026');
    core.setFactVersion(c, card, 'fact.f1_1.r25_1', 'answered', ['|52']);
    core.setCardFill(ev, card.key, '25.1', 0, '01.10.2026');
  });
  assert.equal(charsOf(plan, '25'), '52' + '20260923', 'код решения и дата «год мес. чис.»');
  assert.equal(charsOf(plan, '25.1'), '52' + '20261001', 'код судебного решения и его дата');
});

test('Ф. 1.1 р. 25.1: решение одно, как в р. 25', () => {
  const r25 = ix.reqs.get('1.1').get('25');
  const r251 = ix.reqs.get('1.1').get('25.1');
  assert.equal(r251.input.select, r25.input.select);
  assert.equal(r251.input.max_codes, 1);
  assert.equal(core.selectionProblem(r251, ['52', '25']), 'выбрано 2 кодов, а в бланке одно поле');
});

test('Ф. 1.1 р. 25: дата не в виде ДД.ММ.ГГГГ закрывает печать', { skip: !hasLayouts && 'нет карт раскладки' }, () => {
  const { plan } = f11((c, ev, card) => {
    core.setFactVersion(c, card, 'fact.f1_1.r25', 'answered', ['|52']);
    core.setCardFill(ev, card.key, '25', 0, '23 сентября');
  });
  assert.match(fieldOf(plan, '25').notes.join(' '), /дата «23 сентября» не разобрана/);
  assert.equal(plan.ready, false);
});

test('Ф. 1.1 р. 28: сумма ущерба идет в клетки того ряда, где стоит ее код', { skip: !hasLayouts && 'нет карт раскладки' }, () => {
  const { plan } = f11((c, ev, card) => {
    core.setFactVersion(c, card, 'fact.f1_1.r28', 'answered', ['|01', '|03']);
    core.setCardFill(ev, card.key, '28', 0, '150000');
    core.setCardFill(ev, card.key, '28', 2, '2500,50');
  });
  const field = layoutOf('forma-1-1.json').fields.find((f) => f.requisite === '28');
  const rows = field.parts[0].groups;
  const sums = field.parts[0].fills;
  assert.deepEqual(sums.map((g) => g.length), [11, 11, 11, 11, 11], 'сумма – одиннадцать клеток (замечание 23.09.2026)');
  const chars = new Map(fieldOf(plan, '28').edits.map((e) => [e.shape, e.text]));
  const read = (cells) => cells.map((s) => chars.get(s) ?? '').join('');
  assert.equal(read(rows[0]), '01');
  assert.equal(read(sums[0]), '150000', 'сумма «всего» – в первом ряду, по правому краю');
  assert.equal(read(rows[1]), '03');
  assert.equal(read(sums[1]), '2500', 'сумма в рублях, копейки в клетки не идут');
});

test('Ф. 1.1 р. 31: код ставится наложением двух чисел, кодов может быть несколько', { skip: !hasLayouts && 'нет карт раскладки' }, () => {
  const r31 = ix.reqs.get('1.1').get('31');
  assert.equal(r31.input.select, 'overlay_slots');
  assert.equal(core.selectionProblem(r31, ['30']), 'код 30 не дополнен вторым числом: в бланк ставится сумма двух чисел (например 30 + 01 = 31)');
  assert.equal(core.selectionProblem(r31, ['30', '10']), 'коды 30 и 10 занимают один разряд – сложить их нельзя');
  assert.equal(core.selectionProblem(r31, ['30', '01', '40', '01', '10', '04']), null, 'три кода наложением – по числу полей бланка');
  const { plan, memo } = f11((c, ev, card) => {
    core.setFactVersion(c, card, 'fact.f1_1.r31', 'answered', ['|30', '|01', '|40', '|01', '|10', '|04']);
  });
  assert.equal(charsOf(plan, '31'), '314114', 'в бланке три кода: 31, 41, 14');
  assert.match(memo.rows.find((r) => r.id === '31').display, /^31 = 30 \(.+\) \+ 01 \(.+\); 41 = /);
});

test('Ф. 1.1 р. 34.1 заполняется по правилам р. 34 (справочник № 14, код наложением)', () => {
  const r34 = ix.reqs.get('1.1').get('34');
  const r341 = ix.reqs.get('1.1').get('34.1');
  assert.equal(r341.field_type, 'classifier');
  assert.equal(r341.classifier_no, r34.classifier_no);
  assert.equal(r341.input.select, r34.input.select);
  assert.equal(r341.input.code_digits, r34.input.code_digits);
  const m = ix.mapping.get('1.1');
  assert.notEqual(m.get('34.1').value_from, m.get('34').value_from, 'служба, способствовавшая раскрытию, – отдельное сведение');
});

test('Ф. 3 р. 8: номер дела короче 17 цифр – ошибка, бланк не выгружается', { skip: !hasLayouts && 'нет карт раскладки' }, () => {
  const plan = (ref) => {
    const c = baseCase();
    const ev = runEvent(c, 'ev.join', { joined_to: ref });
    const card = ev.cards.find((k) => k.form === '3');
    const memo = core.buildPackageMemos(ix, c, ev, PROFILE).get(card.key);
    return core.planBlank(memo, layoutOf('forma-3.json'), { profile: PROFILE });
  };
  const ok = plan(CASE_NO);
  assert.equal(charsOf(ok, '8').slice(-17), CASE_NO, 'полный номер – 17 цифр в 17 клеток');
  assert.equal(ok.ready, true);
  const bad = plan('126000000010');
  assert.match(fieldOf(bad, '8').notes.join(' '), /в номере 12 цифр, а номер уголовного дела состоит из 17 цифр/);
  assert.equal(bad.ready, false, 'печать закрыта, пока номер не исправлен');
});

test('Номер уголовного дела не из 17 цифр – ошибка контроля во всех формах', () => {
  const chk = pack.rules.checks.find((x) => x.id === 'c.case_number_17');
  assert.equal(chk.severity, 'error');
  const c = baseCase();
  core.setFactVersion(c, c.case, 'fact.case.case_number', 'answered', '1260000000100');
  const ev = runEvent(c, 'ev.terminate', { ground_type: 'non_rehab' }, { crimes: ['crime.1'], persons: ['person.1'] });
  const memo = core.buildPackageMemos(ix, c, ev, PROFILE).get(ev.cards.find((k) => k.form === '1.1').key);
  assert.ok(memo.checks.some((x) => x.id === 'c.case_number_17'), 'неполный номер – ошибка');
});

test('Строка подписи ф. 1.1: печатная надпись заменяется значением целиком', { skip: !(hasLayouts && hasBlanks) && 'нет бланков' }, async () => {
  const { plan } = f11();
  const layout = layoutOf('forma-1-1.json');
  const bytes = new Uint8Array(fs.readFileSync(path.join(BLANKS, layout.blank)));
  const out = await core.fillDocx(bytes, layout, plan.edits, plan.cellEdits);
  const entries = core.readZip(out);
  const xml = await core.entryText(entries.find((e) => e.name === 'word/document.xml'));
  const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((x) => x[1]).join('');
  assert.ok(text.includes('следователь майор юстиции И.И. Иванов'), 'подпись впечатана');
  assert.ok(!text.includes('Фамилия, подпись лица, ведущего расследование'), 'первая часть надписи убрана');
  assert.ok(!text.includes('уголовного дела или разрешившего материал'), 'вторая часть надписи убрана');
  assert.ok(text.includes('(должность, звание, подпись, фамилия)'), 'пояснение бланка остается');
});

test('Строка подписи ф. 3: печатная надпись в книге Excel заменяется значением', { skip: !(hasLayouts && hasBlanks) && 'нет бланков' }, async () => {
  const c = baseCase();
  const ev = runEvent(c, 'ev.join', { joined_to: CASE_NO });
  const card = ev.cards.find((k) => k.form === '3');
  const memo = core.buildPackageMemos(ix, c, ev, PROFILE).get(card.key);
  const layout = layoutOf('forma-3.json');
  const plan = core.planBlank(memo, layout, { profile: PROFILE });
  const bytes = new Uint8Array(fs.readFileSync(path.join(BLANKS, layout.blank)));
  const out = await core.fillDocx(bytes, layout, plan.edits, plan.cellEdits);
  const entries = core.readZip(out);
  const sheet = await core.entryText(entries.find((e) => e.name === 'xl/worksheets/sheet1.xml'));
  const cell = /<c r="B92"[^>]*>([\s\S]*?)<\/c>/.exec(sheet)[1];
  assert.ok(cell.includes('следователь майор юстиции И.И. Иванов'), 'подпись впечатана');
  assert.ok(!cell.includes('Фамилия'), 'надпись бланка по умолчанию убрана');
});
