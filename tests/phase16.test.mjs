// Автотесты Фазы 1.6 «Заполнение бланков» (критерии A1.6-2 – A1.6-6, A1.6-9).
// Запуск: node --test tests/phase16.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importCore } from '../scripts/bundle.mjs';
import { ROOT } from '../scripts/lib-data.mjs';

const core = await importCore();
const BLANKS = path.join(ROOT, 'data/blanks/2026');
const LAYOUTS = path.join(ROOT, 'data/layout/2026');
const hasBlanks = fs.existsSync(BLANKS) && fs.existsSync(LAYOUTS);
const layoutOf = (name) => JSON.parse(fs.readFileSync(path.join(LAYOUTS, name), 'utf8'));
const blankBytes = (file) => new Uint8Array(fs.readFileSync(path.join(BLANKS, file)));

const row = (over = {}) => ({ id: '9', number: '9', label: 'Реквизит', status: 'fill', fills_by: 'investigator',
  value: ['g|1'], requisite: { field_type: 'enum', input: {} }, ...over });

test('A1.6-6: код по разрядам прижимается вправо, лишние разряды – замечанием', () => {
  const one = core.planField(row({ value: ['g|7'] }), { requisite: '9', groups: [[10, 11]] });
  assert.deepEqual(one.edits, [{ shape: 11, text: '7' }], 'однозначный код – в правую клетку');
  const over = core.planField(row({ value: ['g|1234'] }), { requisite: '9', groups: [[10, 11]] });
  assert.equal(over.edits.length, 0, 'код, который не входит в клетки, не вписывается');
  assert.ok(over.blocked, 'печать закрывается до исправления значения');
  assert.match(over.notes.join(' '), /не помещается/);
});

test('A1.6-6: наложение кодов по разрядам', () => {
  const p = core.planField(row({ value: ['g|100000', 'g|000300'], requisite: { field_type: 'enum', input: { select: 'overlay' } } }),
    { requisite: '20', groups: [[1, 2, 3, 4, 5, 6]] });
  assert.equal(p.edits.map((e) => e.text).join(''), '100300');
});

test('A1.6-6: несколько кодов – по одному в каждое поле бланка', () => {
  const p = core.planField(row({ value: ['g|12', 'g|34'] }), { requisite: '14', groups: [[1, 2], [3, 4]] });
  assert.equal(p.kind, 'code_list');
  assert.deepEqual(p.edits.map((e) => e.text), ['1', '2', '3', '4']);
});

test('A1.6-6: дата по клеткам «год / мес. / чис.»', () => {
  const p = core.planField(row({ value: '2026-01-09', requisite: { field_type: 'date', input: {} } }),
    { requisite: '11', groups: [[1, 2], [3, 4], [5, 6]] });
  assert.equal(p.kind, 'date_cells');
  assert.equal(p.edits.map((e) => e.text).join(''), '260109');
});

test('A1.6-6: номер по клеткам заполняется с конца', () => {
  const p = core.planField(row({ value: '12602300000000001', requisite: { field_type: 'text', input: {} } }),
    { requisite: '3', groups: [[1, 2], [3, 4, 5, 6], [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]] });
  assert.equal(p.kind, 'number_cells');
  assert.equal(p.edits.length, 17);
});

test('A1.6-6: текст длиннее допустимого не заполняется и закрывает печать (ответ В-19)', () => {
  const p = core.planField(row({ value: 'а'.repeat(600), requisite: { field_type: 'text', input: {} } }),
    { requisite: '12', max_len: 500, place: { table: 1, row: 2, cell: 3 } });
  assert.equal(p.kind, 'text');
  assert.ok(p.blocked, 'печать закрывается');
  assert.match(p.notes.join(' '), /сократите/);
});

test('A1.6-5: ошибки контроля и неподтвержденные умолчания закрывают печать', () => {
  const memo = { form: '1', rows: [row({ id: '15', number: '15', status: 'default', value: ['g|3'] })],
    checks: [{ severity: 'error', message: 'нет обязательного реквизита' }] };
  const plan = core.planBlank(memo, { form: '1', fields: [{ requisite: '15', groups: [[1]] }] });
  assert.equal(plan.ready, false);
  assert.equal(plan.blockers.length, 2, 'ошибка контроля и неподтвержденное умолчание');
  const ok = core.planBlank({ form: '1', rows: [row()], checks: [] }, { form: '1', fields: [{ requisite: '9', groups: [[1]] }] });
  assert.equal(ok.ready, true);
});

test('A1.6-4: подмена бланка отменяет заполнение', { skip: !hasBlanks }, async () => {
  const layout = layoutOf('forma-5.json');
  await assert.rejects(() => core.fillDocx(blankBytes(layout.blank), { ...layout, blank_sha256: 'нет такой суммы' }, []),
    /отличается от того/);
});

test('A1.6-2: в заполненном файле меняется только word/document.xml', { skip: !hasBlanks }, async () => {
  const layout = layoutOf('forma-5.json');
  const src = blankBytes(layout.blank);
  const field = layout.fields.find((f) => f.groups.some((g) => g.length >= 2));
  const edits = field.groups[0].slice(0, 2).map((shape, i) => ({ shape, text: String(i + 1) }));
  const out = await core.fillDocx(src, layout, edits);
  const a = core.readZip(src);
  const b = core.readZip(out);
  assert.deepEqual(b.map((e) => e.name), a.map((e) => e.name), 'состав частей файла не изменился');
  for (const entry of a) {
    const other = b.find((e) => e.name === entry.name);
    const same = Buffer.compare(Buffer.from(await core.entryBytes(entry)), Buffer.from(await core.entryBytes(other))) === 0;
    assert.equal(same, entry.name !== layout.part, `часть ${entry.name}`);
  }
  const xml = await core.entryText(b.find((e) => e.name === layout.part));
  assert.equal(core.shapeText(xml, edits[0].shape), '1');
  assert.equal(core.shapeText(xml, edits[1].shape), '2');
});

test('A1.6-3: у каждого места карты раскладки есть реквизит формы', { skip: !hasBlanks }, () => {
  for (const file of fs.readdirSync(LAYOUTS).filter((f) => f.endsWith('.json'))) {
    const layout = layoutOf(file);
    assert.ok(layout.blank_sha256, `${file}: нет контрольной суммы бланка`);
    for (const field of layout.fields) {
      const places = field.groups.length + (field.parts ?? []).filter((x) => x.place).length;
      assert.ok(places, `${file}: у реквизита ${field.requisite} нет мест`);
      const ok = layout.kind === 'xlsx' ? (s) => /^[A-Z]+\d+$/.test(s) : Number.isInteger;
      assert.ok(field.groups.every((g) => g.every(ok)), `${file}: место задано не номером фигуры или адресом ячейки`);
    }
  }
});

test('A1.6-7: пакетная выгрузка собирает архив из готовых бланков', { skip: !hasBlanks }, async () => {
  const layout = layoutOf('forma-5.json');
  const one = await core.fillDocx(blankBytes(layout.blank), layout, []);
  const zip = await core.zipFiles([{ name: core.blankFileName('5', { title: 'Потерпевший 1' }), bytes: one }]);
  const entries = core.readZip(zip);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'Форма 5 Потерпевший 1.docx');
  assert.equal(Buffer.compare(Buffer.from(await core.entryBytes(entries[0])), Buffer.from(one)), 0);
});

test('A1.6-6: составной реквизит – код, дата с часом, дополнительное поле, квалификация по ячейкам', () => {
  const memo = { form: '1', facts: { 'fact.crime.crime_date': { status: 'answered', value: '2026-02-20' } },
    fills: { '1|12': { 0: '14:30' }, '1|40': { 0: '99TEST01' } }, rows: [], checks: [] };
  const date = core.planField(null, { requisite: '12', parts: [
    { role: 'date', facts: ['fact.crime.crime_date'], time_fill: 0, format: 'YYYYMMDDHH', groups: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]] }] }, memo);
  assert.equal(date.edits.map((e) => e.text).join(''), '2026022014');
  const fill = core.planField(null, { requisite: '40', parts: [{ role: 'fill', index: 0, groups: [[1, 2, 3, 4, 5, 6, 7, 8]] }] }, memo);
  assert.equal(fill.edits.map((e) => e.text).join(''), '99TEST01');
  const q = row({ id: '13', value: 'п. «в» ч. 2 ст. 158.1 УК РФ', requisite: { field_type: 'text', input: {} } });
  const qual = core.planField(q, { requisite: '13', parts: [
    { role: 'qual', slot: 'article', groups: [[1, 2, 3]] }, { role: 'qual', slot: 'asign', groups: [[4, 5]] },
    { role: 'qual', slot: 'part', groups: [[6]] }, { role: 'qual', slot: 'points', groups: [[7, 8, 9, 10, 11]] }] }, memo);
  assert.deepEqual(qual.edits.map((e) => [e.shape, e.text]), [[1, '1'], [2, '5'], [3, '8'], [5, '1'], [6, '2'], [7, 'в']]);
});

test('A1.6-2: текст на линейке бланка не сдвигает разметку – подчеркивания заменяются по числу знаков', () => {
  const xml = '<w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Фабула __________</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body>';
  const short = core.setUnderscoreText(xml, { table: 0, row: 0, cell: 0 }, 'кража');
  assert.match(short, /кража/);
  assert.equal((short.match(/_/g) ?? []).length, 5, 'остаток линейки сохранен');
  const long = core.setUnderscoreText(xml, { table: 0, row: 0, cell: 0 }, 'очень длинное значение');
  assert.equal((long.match(/_/g) ?? []).length, 0);
  assert.match(long, /<w:sz w:val="(\d+)"\/><\/w:rPr><w:t xml:space="preserve">очень/);
  assert.ok(Number(/<w:sz w:val="(\d+)"\/><\/w:rPr><w:t xml:space="preserve">очень/.exec(long)[1]) < 20, 'длинный текст – мельче');
});

test('A1.6-6: пункт с примечанием и дата рождения ДД.ММ.ГГ (ответы В-24, В-25)', () => {
  const q = row({ id: '13', value: 'п. «е.1» ч. 2 ст. 105 УК РФ', requisite: { field_type: 'text', input: {} } });
  const plan = core.planField(q, { requisite: '13', parts: [
    { role: 'qual', slot: 'points', groups: [[1, 2, 3, 4, 5]] }, { role: 'qual', slot: 'point_sign', groups: [[6]] }] }, null);
  assert.deepEqual(plan.edits.map((e) => [e.shape, e.text]), [[1, 'е'], [6, '1']]);
  const memo = { form: '2', facts: { 'fact.person.birth_date': { status: 'answered', value: '1990-05-17' } }, fills: {}, rows: [], checks: [] };
  const d = core.planField(null, { requisite: '11', parts: [
    { role: 'date', facts: ['fact.person.birth_date'], format: 'DDMMYY', groups: [[1, 2, 3, 4, 5, 6]] }] }, memo);
  assert.equal(d.edits.map((e) => e.text).join(''), '170590');
});

test('A1.6-6: ф. 6 раздел 3 – эпизоды: стадия и форма соучастия по квалификации (ответ В-27)', () => {
  const row0 = row({ id: '15', value: 'ч. 3 ст. 30, п. «в» ч. 2 ст. 158 УК РФ; ч. 3 ст. 33, ч. 1 ст. 105 УК РФ', requisite: { field_type: 'text', input: {} } });
  const part = (slot, line, n) => ({ role: 'qual', slot, line, episodes: true, groups: [Array.from({ length: n }, (_, i) => `${slot}${line}-${i}`)] });
  const f = { requisite: '15', parts: [part('stage', 0, 2), part('complicity', 0, 2), part('article', 0, 3),
    part('stage', 1, 2), part('complicity', 1, 2), part('article', 1, 3)] };
  const text = (p, prefix) => p.edits.filter((e) => e.shape.startsWith(prefix)).map((e) => e.text).join('');
  const p = core.planField(row0, f, { form: '6', facts: {}, fills: {} });
  assert.equal(text(p, 'stage0'), '02', 'покушение');
  assert.equal(text(p, 'complicity0'), '', 'соучастия нет – клетки пустые');
  assert.equal(text(p, 'article0'), '158');
  assert.equal(text(p, 'stage1'), '03', 'оконченное');
  assert.equal(text(p, 'complicity1'), '02', 'организатор – ч. 3 ст. 33 УК РФ');
  assert.equal(text(p, 'article1'), '105');
});
