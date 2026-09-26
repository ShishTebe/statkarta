// Автотесты по замечаниям пользователя от 22.09.2026 (проверка на Mac).
// Запуск: node --test tests/remarks-2026-09-22.test.mjs
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
const layoutOf = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/layout/2026', name), 'utf8'));
const PROFILE = { organ_name: 'Тестовый следственный отдел', organ_code: '02', unit_code: '02300003', investigator_fio: 'В.В.В.' };

function vudCase({ kusp = '93пр-26', fabula = null } = {}) {
  const c = core.createCase2({ today: '2026-09-22' });
  const crime = core.addObject(c, 'crime');
  core.setFactVersion(c, c.case, 'fact.case.kusp', 'answered', kusp);
  core.setFactVersion(c, c.case, 'fact.case.kusp_date', 'answered', '2026-09-10');
  core.setFactVersion(c, crime, 'fact.crime.qualification', 'answered', 'ч. 1 ст. 173.1 УК РФ');
  core.setFactVersion(c, crime, 'fact.crime.crime_date', 'answered', '2026-09-01');
  if (fabula) core.setFactVersion(c, crime, 'fact.crime.fabula', 'answered', fabula);
  const ev = core.addEvent(c, { type: 'ev.vud', date: '2026-09-12', attrs: { vud_mode: 'fact' }, refs: { crimes: [crime.id] } });
  core.applyEventFacts(ix, c, ev);
  core.syncPackage(ix, c, ev);
  const memo = [...core.buildPackageMemos(ix, c, ev, PROFILE).values()].find((m) => m.form === '1');
  return core.planBlank(memo, layoutOf('forma-1.json'), { profile: PROFILE });
}

test('Р. 5 ф. 1 и р. 4 ф. 5: из номера КРСП «93пр-26» в клетки идет только 93, без года', () => {
  const plan = vudCase();
  const p5 = plan.fields.find((f) => f.requisite === '5');
  assert.equal(p5.edits.map((e) => e.text).join(''), '9320260910', 'номер 93 и дата «год мес. чис.»');
  const f5 = layoutOf('forma-5.json').fields.find((f) => f.requisite === '4');
  assert.equal(f5.parts.find((p) => p.role === 'fact').lead_number, true);
  const other = vudCase({ kusp: '1087пр/1-24' }).fields.find((f) => f.requisite === '5');
  assert.equal(other.edits.map((e) => e.text).join('').slice(0, 4), '1087');
});

test('Р. 12 ф. 1: фабула шрифтом 6 пт; длиннее 450 знаков – печать закрыта с просьбой сократить', () => {
  const ok = vudCase({ fabula: 'а'.repeat(440) }).fields.find((f) => f.requisite === '12');
  assert.equal(ok.cellEdits[0].size, 12, '6 пт = 12 полупунктов');
  const long = vudCase({ fabula: 'а'.repeat(460) });
  assert.equal(long.ready, false);
  assert.ok(long.blockers.some((b) => /реквизит 12: текст длиннее 450 знаков/.test(b)), long.blockers.join('; '));
});

test('Заданный картой размер шрифта применяется и на линейках', () => {
  const xml = '<w:tbl><w:tr><w:tc><w:p><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>12. ФАБУЛА ________________________________</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const out = core.setUnderscoreText(xml, { table: 0, row: 0, cell: 0 }, 'Текст фабулы', { size: 12 });
  assert.match(out, /<w:sz w:val="12"\/>[\s\S]*Текст фабулы/);
});

test('Р. 40 ф. 1: местные подразделения из бланка информационного центра (0018, 0017, 0019) – из пакета региона 30', () => {
  const r40 = core.regionalPack(pack, pack.region_packs['30']).forms.find((f) => f.form === '1').requisites.find((r) => r.number === '40');
  const codes = r40.options.map((o) => o.code);
  for (const code of ['0018', '0017', '0019']) assert.ok(codes.includes(code), code);
  assert.equal(codes.indexOf('0018'), codes.indexOf('0001') + 1, 'после «следственных органов СК РФ (0001)»');
});

// ---------- Вторая партия замечаний 22.09.2026 ----------

const PROFILE_FULL = { ...PROFILE, card_unit_name: 'СО по г. Энску СУ СК России по Условной области',
  investigator_position: 'следователь', investigator_rank: 'капитан юстиции', investigator_fio: 'И.И. Иванов',
  head_position: 'руководитель следственного отдела', head_rank: 'полковник юстиции', head_fio: 'П.П. Петров',
  prosecutor_position: 'заместитель прокурора', prosecutor_rank: 'советник юстиции', prosecutor_fio: 'С.С. Сидоров', blank_sign_prosecutor: true };

async function filledForm1(profile) {
  const c = core.createCase2({ today: '2026-09-22' });
  const crime = core.addObject(c, 'crime');
  core.setFactVersion(c, crime, 'fact.crime.qualification', 'answered', 'ч. 1 ст. 105 УК РФ');
  const ev = core.addEvent(c, { type: 'ev.vud', date: '2026-09-12', attrs: { vud_mode: 'fact' }, refs: { crimes: [crime.id] } });
  core.applyEventFacts(ix, c, ev);
  core.syncPackage(ix, c, ev);
  const memo = [...core.buildPackageMemos(ix, c, ev, profile).values()].find((m) => m.form === '1');
  const layout = layoutOf('forma-1.json');
  const plan = core.planBlank(memo, layout, { profile });
  const bytes = await core.fillDocx(new Uint8Array(fs.readFileSync(path.join(ROOT, 'data/blanks/2026', layout.blank))), layout, plan.edits, plan.cellEdits);
  const xml = await core.entryText(core.readZip(bytes).find((e) => e.name === 'word/document.xml'));
  return { memo, plan, plain: xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '') };
}

test('Р. 11 ф. 1: вид проставляется по событию – ВУД 1, учетный отказ 3', () => {
  const c = core.createCase2({ today: '2026-09-22' });
  const crime = core.addObject(c, 'crime');
  const vud = core.addEvent(c, { type: 'ev.vud', date: '2026-09-12', attrs: { vud_mode: 'fact' }, refs: { crimes: [crime.id] } });
  core.applyEventFacts(ix, c, vud);
  assert.deepEqual(core.factAt(c, c.case, 'fact.case.vud_date.opte034c7').value, ['|1']);
  const c2 = core.createCase2({ today: '2026-09-22' });
  const cr2 = core.addObject(c2, 'crime');
  const ref = core.addEvent(c2, { type: 'ev.refusal', date: '2026-09-14', attrs: { ground_type: 'non_rehab' }, refs: { crimes: [cr2.id] } });
  core.applyEventFacts(ix, c2, ref);
  assert.deepEqual(core.factAt(c2, c2.case, 'fact.case.vud_date.opte034c7').value, ['|3']);
  assert.equal(core.factAt(c2, c2.case, 'fact.case.vud_date').value, '2026-09-14');
});

test('Р. 1: наименование подразделения из профиля; подписи следователя, руководителя и прокурора', async () => {
  const { plain } = await filledForm1(PROFILE_FULL);
  assert.match(plain, /СО по г\. Энску СУ СК России по Условной области\s*\n\s*орган: внутренних дел/);
  assert.ok(!/Фамилия, подпись лица, ведущего расследование/.test(plain), 'надпись заменена строкой следователя');
  assert.match(plain, /следователь капитан юстиции И\.И\. Иванов/);
  assert.match(plain, /руководитель следственного отдела полковник юстиции П\.П\. Петров/);
  assert.match(plain, /заместитель прокурора советник юстиции С\.С\. Сидоров/);
  const { plan } = await filledForm1({ ...PROFILE_FULL, card_unit_name: 'а'.repeat(95) });
  assert.ok(plan.blockers.some((b) => /длиннее 90 знаков/.test(b)));
  const bare = await filledForm1({ organ_code: '02', unit_code: '02300003' });
  assert.match(bare.plain, /Фамилия, подпись лица, ведущего расследование/, 'без данных профиля надпись остается');
});

test('В-51: потерпевший-организация извлекается и не получает ф. 5', () => {
  const text = 'ПОСТАНОВЛЕНИЕ\nо признании потерпевшим\nг. Энск\t11.03.2026\nСледователь отдела, рассмотрев материалы уголовного дела № 12600000000000001,\nУСТАНОВИЛ:\nПричинен вред.\nПОСТАНОВИЛ:\nПризнать потерпевшим юридическое лицо – Государственное бюджетное учреждение «Условная больница» (сокращенное наименование – ГБУ «УБ»), расположенное по адресу: г. Энск, о чем объявить его представителю.';
  const res = core.extractDoc(text, { rules: pack.rules.extract, documents: pack.documents, optionsOf: (f, r) => core.optionsOf(ix, f, r) });
  assert.deepEqual(res.victims.map((v) => [v.label, v.legal]), [['Государственное бюджетное учреждение «Условная больница»', true]]);
  const c = core.createCase2({ today: '2026-09-22' });
  const crime = core.addObject(c, 'crime');
  const ev0 = core.addEvent(c, { type: 'ev.vud', date: '2026-03-01', attrs: { vud_mode: 'fact' }, refs: { crimes: [crime.id] } });
  core.syncPackage(ix, c, ev0);
  const dec = core.defaultDecisions(res);
  dec.victims[0].accept = true;
  const log = core.importDoc(ix, c, res, dec);
  assert.equal(c.victims[0].attrs.legal_entity, true);
  const ev = core.getEvent(c, log.event);
  assert.ok(!ev.cards.some((k) => k.form === '5'), 'ф. 5 на организацию не составляется');
});

// ---------- Третья партия замечаний 22.09.2026 ----------

test('Подписи дополнительных полей читаются целиком, лишние поля убраны', () => {
  const req = (form, number) => pack.forms.find((f) => f.form === form).requisites.find((r) => r.number === number);
  const labels = (form, number) => (req(form, number).input?.fills ?? []).map((f) => core.fillLabel(req(form, number), f));
  assert.deepEqual(labels('1', '31'), [], 'р. 31 ф. 1 – одно поле количества, без обрывка «ым причинен…»');
  assert.deepEqual(labels('1', '5'), []);
  assert.ok(labels('1.1', '28').includes('Взятки'));
  assert.ok(labels('1.1', '28').includes('Невыплаченной заработной платы, пенсий, стипендий, пособий и иных выплат'));
  assert.equal(labels('4', '11.1')[0], 'В порядке гражданского и арбитражного судопроизводства (1) на сумму');
  assert.equal(labels('4', '15').length, 0);
  for (const f of pack.forms) for (const r of f.requisites) for (const x of r.input?.fills ?? []) {
    const l = core.fillLabel(r, x);
    assert.ok(/^[А-ЯA-Z№(0-9]/u.test(l), `${f.form} р. ${r.number}: подпись с заглавной – «${l}»`);
  }
});

test('Строки руководителя и прокурора – вместо печатных надписей; прокурор печатается по умолчанию', async () => {
  const { plain } = await filledForm1({ ...PROFILE_FULL, blank_sign_prosecutor: undefined });
  assert.ok(!/Руководитель следственного органа,/.test(plain), 'надпись руководителя убрана');
  assert.ok(!/начальник органа \(подразделения\) дознания/.test(plain));
  assert.ok(!/Прокурор _/.test(plain), 'надпись прокурора убрана');
  assert.match(plain, /руководитель следственного отдела полковник юстиции П\.П\. Петров/);
  assert.match(plain, /заместитель прокурора советник юстиции С\.С\. Сидоров/);
  const off = await filledForm1({ ...PROFILE_FULL, blank_sign_head: false, blank_sign_prosecutor: false });
  assert.match(off.plain, /Руководитель следственного органа,/, 'без отметки надпись остается');
  assert.match(off.plain, /Прокурор _/);
});

test('Предел фабулы один – 450 знаков: и в проверке, и в поле р. 12', () => {
  const check = pack.rules.checks.find((x) => x.id === 'c.fabula_length');
  assert.deepEqual(check.assert.args, ['req.12', 450]);
  assert.equal(pack.forms.find((f) => f.form === '1').requisites.find((r) => r.number === '12').input.max_chars, 450);
});
