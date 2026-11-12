// Автотесты по замечанию от 12.11.2026: в ф. 6 между р. 8 и разделом 2 есть строка без номера
// «Статистическую карточку формы № 6 направить по адресу ___ (наименование органа, проводившего
// расследование, индекс, почтовый адрес)» – ее тоже заполняет следователь.
// Все сведения в тестах вымышленные. Запуск: node --test tests/remarks-2026-11-12.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importCore } from '../scripts/bundle.mjs';
import { loadPack } from '../scripts/load-pack.mjs';
import { ROOT } from '../scripts/lib-data.mjs';

const core = await importCore();
const pack = loadPack();
const ix = core.indexPack(core.regionalPack(pack, pack.region_packs['30']));
const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/layout/2026/forma-6.json'), 'utf8'));
const blank = new Uint8Array(fs.readFileSync(path.join(ROOT, 'data/blanks/2026', layout.blank)));
const ORGAN = 'Следственный отдел по г. Энску следственного управления СК России по Условной области';
const ADDRESS = '000000, г. Энск, ул. Условная, д. 1';
const PROFILE = { organ_name: ORGAN, organ_address: ADDRESS, investigator_position: 'следователь', investigator_fio: 'И.И. Иванов', region: '30' };
const ROW = { table: 2, row: 8, cell: 0 };

const docXml = async (bytes) => core.entryText(core.readZip(bytes).find((e) => e.name === 'word/document.xml'));
// абзацы строки бланка: текст и размер шрифта вписанного прогона
function rowParas(xml) {
  const tc = core.findTableCell(xml, ROW);
  return [...xml.slice(tc.inner[0], tc.inner[1]).matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => ({
    text: [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((x) => x[1]).join(''), xml: m[0] }));
}

function court6(profile) {
  const c = core.createCase2({ today: '2026-11-12' });
  const cr = core.addObject(c, 'crime');
  core.setFactVersion(c, cr, 'fact.crime.qualification', 'answered', 'ч. 1 ст. 158 УК РФ', null);
  const p = core.addObject(c, 'person', { crimes: [cr.id] });
  const ev = core.addEvent(c, { type: 'ev.manual', date: '2026-11-12', refs: { crimes: [cr.id], persons: [p.id] } });
  const card = core.addCardManually(ix, c, ev, { form: '6', of: { crime: cr.id, person: p.id } });
  return { c, ev, card, memo: core.buildCardMemo(ix, c, ev, card, profile) };
}

test('пакет ф. 6: строка «направить по адресу» – реквизит б/н сразу после р. 8, заполняет следователь', () => {
  const reqs = ix.forms.get('6').requisites;
  const i = reqs.findIndex((r) => r.id === 'send_to');
  assert.equal(reqs[i - 1].id, '8');
  const r = reqs[i];
  assert.equal(r.number, 'б/н');
  assert.equal(r.fills_by, 'investigator');
  assert.equal(r.label_status, 'verified');
  assert.match(r.label, /^Статистическую карточку формы № 6 направить по адресу/);
  assert.equal(r.input.fills, undefined, '«№ 6» в тексте строки – не отдельное поле');
  assert.equal(r.input.max_chars, 220);
  assert.ok(!/направить по адресу/.test(reqs[i - 1].raw), 'текст строки больше не числится в р. 8');
  assert.equal(ix.mapping.get('6').get('send_to').value_from, 'fact.case.card6_address');
  assert.equal(ix.facts.get('fact.case.card6_address').scope, 'case', 'одно значение на все ф. 6 дела');
});

test('профиль: адрес = «наименование органа, индекс, почтовый адрес»; без адреса значения нет', () => {
  assert.equal(core.profileValue(PROFILE, 'card6_address_line'), `${ORGAN}, ${ADDRESS}`);
  assert.equal(core.profileValue({ organ_name: `${ORGAN},`, organ_address: ADDRESS }, 'card6_address_line'), `${ORGAN}, ${ADDRESS}`, 'запятая не двоится');
  assert.equal(core.profileValue({ organ_address: ADDRESS }, 'card6_address_line'), ADDRESS);
  assert.equal(core.profileValue({ organ_name: ORGAN }, 'card6_address_line'), null, 'без почтового адреса – вопрос в опроснике');
  assert.equal(core.sanitizeProfile({ organ_address: ADDRESS, x: 1 }).organ_address, ADDRESS, 'адрес сохраняется в профиле');
});

test('опросник ф. 6: без адреса в профиле вопрос задается, с адресом – подставлен из профиля', () => {
  const ask = court6({ organ_name: ORGAN });
  const it = core.packageQuestions(ix, ask.c, ask.ev, { organ_name: ORGAN }).groups.flatMap((g) => g.items)
    .find((x) => x.factId === 'fact.case.card6_address');
  assert.ok(it, 'вопрос есть');
  assert.match(it.q.text, /^По какому адресу направить статистическую карточку ф\. 6/);
  assert.ok(!it.answer, 'без ответа');
  const { memo } = court6(PROFILE);
  const row = memo.rows.find((r) => r.id === 'send_to');
  assert.equal(row.value, `${ORGAN}, ${ADDRESS}`);
  assert.equal(row.source, 'Профиль органа');
  assert.equal(row.status, 'fill');
});

test('перенос по словам: каждая линейка, кроме последней, заполняется не больше чем на 90 %', () => {
  const lines = core.flowWords('один два три четыре пять шесть', [12, 100]);
  assert.deepEqual(lines, ['один два', 'три четыре пять шесть'], '«один два три» = 13 знаков > 10');
  assert.deepEqual(core.flowWords('коротко', [76, 199]), ['коротко', '']);
  assert.deepEqual(core.flowWords('сверхдлинноеслово хвост', [10, 50]), ['сверхдлинноеслово', 'хвост'], 'слово длиннее линейки – целиком');
});

test('бланк ф. 6: значение на двух линейках, кегль каждой линейки и длина строк – как в бланке', async () => {
  const { memo } = court6(PROFILE);
  const plan = core.planBlank(memo, layout, { profile: PROFILE });
  const f = plan.fields.find((x) => x.requisite === 'send_to');
  assert.equal(f.cellEdits[0].mode, 'flow');
  const before = rowParas(await docXml(blank));
  const after = rowParas(await docXml(await core.fillDocx(blank, layout, plan.edits, plan.cellEdits)));
  assert.equal(after.length, before.length, 'абзацев в строке столько же');
  const full = `${ORGAN}, ${ADDRESS}`;
  const [l1, l2] = core.flowWords(full, [76, 196]);
  assert.ok(l1 && l2, 'текст длиннее первой линейки – переносится на вторую');
  assert.ok(after[0].text.includes(`направить по адресу ${l1}_`), after[0].text);
  // вторая линейка начинается левее рамки таблицы – перед текстом три неразрывных пробела
  assert.ok(after[2].text.startsWith(`${String.fromCharCode(160).repeat(3)}${l2}_`), after[2].text);
  assert.equal(after[1].text, before[1].text, 'надпись «(заполняется органом…)» не тронута');
  assert.equal(after[3].text, before[3].text, 'надпись «индекс, почтовый адрес)» не тронута');
  // знаков в строке столько же: сколько вписано, столько подчеркиваний убрано – строка не переносится
  assert.equal(after[0].text.length, before[0].text.length);
  assert.equal(after[2].text.length, before[2].text.length);
  const sizeOf = (p, t) => Number(new RegExp(`<w:sz w:val="(\\d+)"/>(?:(?!<w:r>|<w:r ).)*?${t.slice(0, 12)}`, 's').exec(p.xml)?.[1]);
  assert.equal(sizeOf(after[0], l1), 16, 'первая линейка – 8 пт');
  assert.equal(sizeOf(after[2], l2), 12, 'вторая линейка – 6 пт');
});

test('бланк ф. 6: короткий адрес – только первая линейка; длиннее 220 знаков – печать закрыта', async () => {
  const short = { organ_address: '000000, г. Энск' };
  const { memo } = court6(short);
  const plan = core.planBlank(memo, layout, { profile: short });
  const after = rowParas(await docXml(await core.fillDocx(blank, layout, plan.edits, plan.cellEdits)));
  const before = rowParas(await docXml(blank));
  assert.ok(after[0].text.includes('по адресу 000000, г. Энск_'));
  assert.equal(after[2].text, before[2].text, 'вторая линейка пустая');
  const long = { organ_name: 'а'.repeat(200), organ_address: ADDRESS };
  const lp = core.planBlank(court6(long).memo, layout, { profile: long });
  assert.equal(lp.ready, false);
  assert.ok(lp.blockers.some((b) => /реквизит send_to: текст длиннее 220 знаков/.test(b)), lp.blockers.join('; '));
});

test('по другой карточке: адрес читается из заполненного .docx ф. 6 целиком, без надписей бланка', async () => {
  const { memo } = court6(PROFILE);
  const plan = core.planBlank(memo, layout, { profile: PROFILE });
  const bytes = await core.fillDocx(blank, layout, plan.edits, plan.cellEdits);
  const blanks = [{ form: '6', layout, xml: await docXml(blank) }];
  const res = await core.readCardFile(ix, 'ф6.docx', bytes, { blanks });
  assert.equal(res.form, '6');
  const got = res.rows.flatMap((r) => r.entries).find((e) => e.fact === 'fact.case.card6_address')?.value;
  assert.equal(got, `${ORGAN}, ${ADDRESS}`);
  assert.equal(core.insertedWords('по адресу ____ (заполняется органом) ____ индекс)', 'по адресу А, Б_ (заполняется органом) В Г__ индекс)'), 'А, Б В Г');
});

test('координаты PDF ф. 6: область строки «направить по адресу» захватывает обе линейки', () => {
  const pos = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/layout/2026/pdf/forma-6.json'), 'utf8'));
  const r = pos.regions.find((x) => x.requisite === 'send_to');
  assert.ok(r, 'область есть');
  assert.ok(r.blank_text.startsWith('Статистическую карточку формы № 6 направить по адресу'));
  assert.ok((r.blank_words ?? []).filter(([, , , t]) => /^_{20,}$/.test(t)).length >= 2, 'обе линейки внутри области');
});

// ---------- Второе замечание 12.11.2026: ф. 6 р. 15 – форма соучастия из опросника не попадала в бланк ----------

const SHAPES = { stage: [[200, 201], [202, 203]], complicity: [[212, 213], [214, 215]] };
function court6qual(qual) {
  const c = core.createCase2({ today: '2026-11-12' });
  const cr = core.addObject(c, 'crime');
  core.setFactVersion(c, cr, 'fact.crime.qualification', 'answered', qual, null);
  const p = core.addObject(c, 'person', { crimes: [cr.id] });
  const ev = core.addEvent(c, { type: 'ev.manual', date: '2026-11-12', refs: { crimes: [cr.id], persons: [p.id] } });
  const card = core.addCardManually(ix, c, ev, { form: '6', of: { crime: cr.id, person: p.id } });
  const items = () => core.packageQuestions(ix, c, ev, {}).groups.flatMap((g) => g.items).filter((x) => x.cards.includes(card.key));
  const answer = (line, codes) => {
    const it = items().find((x) => x.factId === `fact.court.complicity_l${line}`);
    core.setPackageAnswer(c, ev, it, 'answered', codes.map((code) => core.optKey(it.options.find((o) => o.code === code))));
  };
  const cells = () => {
    const memo = core.buildCardMemo(ix, c, ev, card, {});
    const plan = core.planBlank(memo, layout, {});
    const f = plan.fields.find((x) => x.requisite === '15');
    const m = new Map(f.edits.map((e) => [e.shape, e.text]));
    const of = (g) => g.map((s) => m.get(s) ?? '').join('');
    return { memo, plan, line: (i) => ({ stage: of(SHAPES.stage[i]), complicity: of(SHAPES.complicity[i]) }) };
  };
  return { c, ev, card, items, answer, cells };
}

test('ф. 6 р. 15.1 – 15.6: у каждой строки свое сведение, в вариантах только форма и категория соучастия', () => {
  for (let i = 1; i <= 6; i += 1) {
    const r = ix.reqs.get('6').get(`15.${i}`);
    assert.equal(ix.mapping.get('6').get(`15.${i}`).value_from, `fact.court.complicity_l${i}`);
    assert.equal(r.input.episode_line, i);
    assert.deepEqual(r.options.map((o) => o.code), ['10', '20', '30', '40', '01', '02', '03', '04'], 'стадий нет – они из ст. 30');
    assert.match(r.label, /форма соучастия, категория соучастника/);
  }
  assert.equal(ix.facts.has('fact.court.qualification'), false);
});

test('опросник ф. 6: соучастие спрашивается по строкам, которые есть в квалификации; первая – всегда', () => {
  const one = court6qual('п. «а» ч. 2 ст. 158 УК РФ');
  assert.deepEqual(one.items().filter((x) => /complicity/.test(x.factId)).map((x) => x.factId), ['fact.court.complicity_l1']);
  const two = court6qual('п. «а» ч. 2 ст. 158; ч. 3 ст. 30, ч. 1 ст. 161 УК РФ');
  assert.deepEqual(two.items().filter((x) => /complicity/.test(x.factId)).map((x) => x.factId), ['fact.court.complicity_l1', 'fact.court.complicity_l2']);
  const rows = two.cells().memo.rows;
  assert.equal(rows.find((r) => r.id === '15.3').status, 'not_applicable');
  assert.match(rows.find((r) => r.id === '15.3').source, /В квалификации 2 статьи – строка 3 не заполняется/);
});

test('бланк ф. 6: форма соучастия из опросника – в клетки своей строки, с категорией – наложением (20 + 01 = 21)', () => {
  const k = court6qual('п. «а» ч. 2 ст. 158; ч. 3 ст. 30, ч. 1 ст. 161 УК РФ');
  assert.deepEqual(k.cells().line(0), { stage: '03', complicity: '' }, 'без ответа клетки соучастия пустые');
  k.answer(1, ['20']);
  assert.deepEqual(k.cells().line(0), { stage: '03', complicity: '20' });
  k.answer(1, ['20', '01']);
  k.answer(2, ['10']);
  const { line, plan } = k.cells();
  assert.deepEqual(line(0), { stage: '03', complicity: '21' });
  assert.deepEqual(line(1), { stage: '02', complicity: '10' }, 'вторая строка – свой ответ, стадия – из ст. 30');
  assert.equal(plan.ready, true);
});

test('бланк ф. 6: ст. 33, 35 в квалификации дополняют ответ; расхождение – примечание, в бланк идет ответ', () => {
  const k = court6qual('ч. 5 ст. 33, п. «а» ч. 2 ст. 158 УК РФ');
  assert.equal(k.cells().line(0).complicity, '04', 'пособник – из квалификации');
  k.answer(1, ['20']);
  assert.equal(k.cells().line(0).complicity, '24', 'форма из ответа + категория из квалификации');
  k.answer(1, ['20', '02']);
  const { line, plan } = k.cells();
  assert.equal(line(0).complicity, '22');
  assert.ok(plan.warnings.some((w) => /строка 1: соучастие по ответу расходится с квалификацией – категория 02 \(в квалификации – 04\)/.test(w)), plan.warnings.join('; '));
  assert.equal(core.blankComplicity('ч. 2 ст. 35, ч. 1 ст. 105 УК РФ', 0).value, '20', 'ст. 35 в квалификации без ответа');
});

test('сохраненное дело: прежний общий ответ по р. 15 переходит в строку 1 без кодов стадии', () => {
  const c = court6qual('п. «а» ч. 2 ст. 158 УК РФ');
  const saved = JSON.parse(JSON.stringify(c.c));
  const card = saved.events[0].cards[0];
  card.facts['fact.court.qualification'] = [{ event: saved.events[0].id, status: 'answered',
    value: ['Стадии совершения преступления|03', 'Формы соучастия в преступлении (по способу взаимодействия соучастников преступления и степени согласованности их действий)|20'] }];
  const back = core.migrateCase(saved, { scopeOf: (f) => core.scopeOf(ix, f) });
  const facts = back.events[0].cards[0].facts;
  assert.equal(facts['fact.court.qualification'], undefined);
  assert.deepEqual(facts['fact.court.complicity_l1'][0].value.map(core.keyCode), ['20']);
});

test('по другой карточке: клетки соучастия ф. 6 читаются обратно – форма и исполнитель в ответ строки, пособник в квалификацию', async () => {
  for (const [qual, codes, wantQual, wantLine] of [
    ['п. «а» ч. 2 ст. 158 УК РФ', ['20', '01'], 'п. «а» ч. 2 ст. 158 УК РФ', ['20', '01']],
    ['ч. 5 ст. 33, п. «а» ч. 2 ст. 158 УК РФ', ['30'], 'ч. 5 ст. 33, п. «а» ч. 2 ст. 158 УК РФ', ['30']],
  ]) {
    const k = court6qual(qual);
    k.answer(1, codes);
    const { memo, plan } = k.cells();
    const bytes = await core.fillDocx(blank, layout, plan.edits, plan.cellEdits);
    const res = await core.readCardFile(ix, 'ф6.docx', bytes, { blanks: [{ form: '6', layout, xml: await docXml(blank) }] });
    const val = (fid) => res.rows.flatMap((r) => r.entries).find((e) => e.fact === fid)?.value;
    assert.equal(val('fact.crime.qualification'), wantQual, qual);
    assert.deepEqual((val('fact.court.complicity_l1') ?? []).map(core.keyCode), wantLine, qual);
    assert.ok(memo);
  }
});
