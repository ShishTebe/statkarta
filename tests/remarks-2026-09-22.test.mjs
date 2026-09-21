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

test('Р. 40 ф. 1: местные подразделения из бланка информационного центра (0018, 0017, 0019)', () => {
  const r40 = pack.forms.find((f) => f.form === '1').requisites.find((r) => r.number === '40');
  const codes = r40.options.map((o) => o.code);
  for (const code of ['0018', '0017', '0019']) assert.ok(codes.includes(code), code);
  assert.equal(codes.indexOf('0018'), codes.indexOf('0001') + 1, 'после «следственных органов СК РФ (0001)»');
});
