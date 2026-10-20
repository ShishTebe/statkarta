// Автотесты Фазы 3.5, работы 2 и 3 (20.10.2026, отчет 26): сверка вариантов с бланками Word заказчика
// (коды бланка blank_code, новые варианты), исправления раскладки (ф. 1 р. 13.1, ф. 4 р. 6, 27.3, 30.2),
// явная отметка реквизитов «от руки» в картах раскладки и ее проверка в check-layout.mjs.
// Сведения в тестах вымышленные. Запуск: node --test tests/blanks-2026-10-20.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importCore } from '../scripts/bundle.mjs';
import { loadPack } from '../scripts/load-pack.mjs';
import { ROOT } from '../scripts/lib-data.mjs';

const core = await importCore();
const pack = loadPack();
const ix = core.indexPack(core.regionalPack(pack, pack.region_packs['30']));
const FILE = { '1': 'forma-1', '1.1': 'forma-1-1', '2': 'forma-2', '2.1': 'forma-2-1', '3': 'forma-3', '4': 'forma-4',
  '5': 'forma-5', '6': 'forma-6', ipk: 'forma-ipk', 'ipk-in': 'forma-ipk-in' };
const layoutOf = (form) => JSON.parse(fs.readFileSync(path.join(ROOT, `data/layout/2026/${FILE[form]}.json`), 'utf8'));
const req = (form, id) => ix.reqs.get(form).get(id);
const codes = (form, id) => req(form, id).options.map((o) => o.code);
const fieldOf = (form, id) => layoutOf(form).fields.find((f) => f.requisite === id);
const row = (form, id, value, extra = {}) => ({ id, number: req(form, id).number, label: req(form, id).label, status: 'fill',
  value, requisite: req(form, id), display: Array.isArray(value) ? core.displayOf(ix, req(form, id), value) : value, ...extra });
const printed = (plan) => plan.edits.map((e) => e.text).join('');

test('проверка карт раскладки: 0 ошибок и 0 замечаний, реквизиты без места отмечены явно (A3.5-5)', () => {
  const out = execFileSync('node', ['scripts/check-layout.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /итого: карт 10, ошибок 0, замечаний 0/);
  for (const form of Object.keys(FILE)) {
    const layout = layoutOf(form);
    const mapped = new Set(layout.fields.map((f) => f.requisite));
    const marked = new Set([...(layout.by_hand ?? []), ...(layout.placed_in ?? [])].map((x) => x.requisite));
    for (const r of ix.forms.get(form).requisites) {
      if (!['investigator', 'head'].includes(r.fills_by)) continue;
      assert.ok(mapped.has(r.id) !== marked.has(r.id), `ф. ${form} р. ${r.id}: либо место в карте, либо отметка`);
    }
    for (const m of layout.by_hand ?? []) assert.ok(m.note?.length > 10, `ф. ${form} р. ${m.requisite}: причина «от руки»`);
    for (const m of layout.placed_in ?? []) for (const x of m.rows) assert.ok(mapped.has(x), `ф. ${form} р. ${m.requisite} → ${x}`);
  }
  assert.deepEqual(layoutOf('2').by_hand.map((x) => x.requisite), ['49']);
  assert.deepEqual(layoutOf('2').placed_in[0].rows, ['21.1', '21.2', '21.3']);
});

test('check-layout: отметка у реквизита с местом и «от руки» без причины – ошибки', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-'));
  const src = path.join(ROOT, 'scripts/check-layout.mjs');
  // копия проверки работает с копией карт: данные репозитория не меняются
  const root = path.join(dir, 'r');
  for (const sub of ['scripts', 'src/core', 'data/layout/2026', 'data/blanks', 'data/forms']) fs.mkdirSync(path.join(root, sub), { recursive: true });
  fs.cpSync(path.join(ROOT, 'scripts/lib-data.mjs'), path.join(root, 'scripts/lib-data.mjs'));
  fs.cpSync(src, path.join(root, 'scripts/check-layout.mjs'));
  fs.cpSync(path.join(ROOT, 'src/core/zip.mjs'), path.join(root, 'src/core/zip.mjs'));
  fs.cpSync(path.join(ROOT, 'data/blanks/2026'), path.join(root, 'data/blanks/2026'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'data/forms/2026'), path.join(root, 'data/forms/2026'), { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'data/layout/2026')).filter((x) => x.endsWith('.json'))) {
    fs.cpSync(path.join(ROOT, 'data/layout/2026', f), path.join(root, 'data/layout/2026', f));
  }
  const p = path.join(root, 'data/layout/2026/forma-2.json');
  const l = JSON.parse(fs.readFileSync(p, 'utf8'));
  l.by_hand.push({ requisite: '50', note: 'есть место' }, { requisite: '21', note: '' });
  fs.writeFileSync(p, JSON.stringify(l));
  let out = '';
  try {
    execFileSync('node', ['scripts/check-layout.mjs'], { cwd: root, encoding: 'utf8' });
  } catch (e) {
    out = e.stdout;
  }
  assert.match(out, /отметка «от руки» у р\. 50, а место в карте у него есть/);
  assert.match(out, /нет причины/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('код бланка (blank_code): ф. 1 р. 9.1 – «04», новые 10 – 13; ф. 5 р. 18.4 – код наложением при общем ответе 1 – 8', () => {
  assert.equal(req('1', '9.1').input.code_digits, 2);
  assert.deepEqual(req('1', '9.1').options.map((o) => o.blank_code ?? o.code), ['01', '02', '04', '05', '06', '09', '13', '10', '11', '12', '08', '07', '03']);
  const p91 = core.planField(row('1', '9.1', ['|4', '|13']), fieldOf('1', '9.1'));
  assert.equal(printed(p91), '0413');
  assert.match(core.displayOf(ix, req('1', '9.1'), ['|4']), /^04 – с применением технических средств/);
  // ф. 1 р. 19.2 и ф. 2 р. 28.2 печатают тот же ответ кодом 5, ф. 5 р. 18.4 – кодом 11 (до принятия, ДНР)
  assert.equal(printed(core.planField(row('5', '18.4', ['|5']), fieldOf('5', '18.4'))), '11');
  assert.equal(printed(core.planField(row('5', '18.4', ['|1']), fieldOf('5', '18.4'))), '21');
  assert.equal(printed(core.planField(row('1', '19.2', ['|5']), fieldOf('1', '19.2'))), '5');
  // обратное чтение: код бланка и прежняя печать без нуля («4») – один и тот же вариант
  const layout = { fields: [{ requisite: '9.1', groups: [[1, 2], [3, 4]] }, { requisite: '19.2', groups: [[5]] }] };
  const cells = new Map([[1, '0'], [2, '4'], [3, '1'], [4, '3'], [5, '5']]);
  const rows = core.cardValues(ix, '1', layout, { cells, texts: {} });
  assert.deepEqual(rows.find((x) => x.id === '9.1').entries[0].value, ['|4', '|13']);
  const old = core.cardValues(ix, '1', { fields: [{ requisite: '9.1', groups: [[1, 2]] }] }, { cells: new Map([[2, '4']]), texts: {} });
  assert.deepEqual(old.find((x) => x.id === '9.1').entries[0].value, ['|4']);
  const f5 = core.cardValues(ix, '5', { fields: [{ requisite: '18.4', groups: [[1, 2]] }] }, { cells: new Map([[1, '1'], [2, '1']]), texts: {} });
  assert.deepEqual(f5.find((x) => x.id === '18.4').entries[0].value, ['|5']);
});

test('варианты бланка Word, которых не было в пакете форм, и смысл кода 8 в р. 13 ф. 1.1 и р. 36 ф. 2', () => {
  for (const c of ['15', '16', '17', '18']) assert.ok(codes('1', '8').includes(c), `ф. 1 р. 8: ${c}`);
  for (const c of ['15', '16', '17', '18']) assert.ok(codes('1.1', '36').includes(c), `ф. 1.1 р. 36: ${c}`);
  for (const c of ['016', '017', '018']) assert.ok(codes('1.1', '15').includes(c), `ф. 1.1 р. 15: ${c}`);
  for (const c of ['16', '17', '18']) assert.ok(codes('2', '55').includes(c), `ф. 2 р. 55: ${c}`);
  assert.ok(codes('1.1', '17').includes('5'));
  assert.ok(codes('1.1', '32.1').includes('13'));
  for (const [form, id, c] of [['1.1', '13', '08'], ['2', '36', '8']]) {
    assert.match(req(form, id).options.find((o) => o.code === c).value, /медицинского освидетельствования/);
  }
  assert.match(req('1', '9.1').raw, /ПАРСИВ \(12\)/, 'текст реквизита – по бланку Word');
});

test('раскладка: ф. 4 р. 6 и ф. 1 р. 13.1 впечатываются, ф. 4 р. 27.3 без клеток 27.4, строка 30.2 своя', () => {
  const q = 'ч. 3 ст. 30, п. «в» ч. 2 ст. 158 УК РФ';
  const p6 = core.planField(row('4', '6', q), fieldOf('4', '6'));
  assert.deepEqual(p6.notes, []);
  assert.equal(printed(p6), '1582в');
  const memo = { form: '1', fills: { '1|13.1': { 0: '2' } }, rows: [], checks: [] };
  const p131 = core.planField(row('1', '13.1', 'ч. 4 ст. 159 УК РФ'), fieldOf('1', '13.1'), memo);
  assert.deepEqual(p131.notes, []);
  assert.equal(printed(p131), '21594');
  assert.equal(req('1', '13.1').input.fills.length, 3);
  const bad = core.planField(row('1', '13.1', 'по статье о мошенничестве'), fieldOf('1', '13.1'), memo);
  assert.match(bad.notes.join(' '), /не разобрана на статью, часть и пункт – в бланк не вписана/);
  const cells273 = fieldOf('4', '27.3').groups.flat();
  for (const s of [1001, 1002, 1007, 1008]) assert.ok(!cells273.includes(s), `клетка ${s} – строка 27.4`);
  assert.deepEqual(fieldOf('4', '30.2').groups.map((g) => g.length), [1, 4, 7]);
  assert.deepEqual(fieldOf('4', '30.1').groups.map((g) => g.length), [1, 4, 7]);
});

test('план печати напоминает, что вписать от руки, с причиной', () => {
  const layout = layoutOf('2');
  const memo = { form: '2', rows: [row('2', '49', ['|2'])], checks: [] };
  const plan = core.planBlank(memo, layout);
  assert.equal(plan.handwritten.length, 1);
  assert.match(plan.warnings.join('\n'), /Реквизит 49 вписывается от руки: 2 – по ст\. 76 УК РФ \(Клетки р\. 49 в бланке – вставленный рисунок/);
});

test('чтение ф. 6: стадия и соучастие из клеток р. 15 возвращаются в квалификацию', () => {
  const field = fieldOf('6', '15');
  const plan = core.planField(row('6', '15', 'ч. 3 ст. 30, п. «в» ч. 2 ст. 158 УК РФ'), field);
  const cells = new Map(plan.edits.map((e) => [e.shape, e.text]));
  const rows = core.cardValues(ix, '6', { fields: [field] }, { cells, texts: {} });
  assert.equal(rows.find((x) => x.id === '15').entries[0].value, 'ч. 3 ст. 30, п. «в» ч. 2 ст. 158 УК РФ');
});
