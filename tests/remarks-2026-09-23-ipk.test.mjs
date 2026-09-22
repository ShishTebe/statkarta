// Автотесты по замечаниям пользователя от 23.09.2026 к ИПК: перечни кодов без предела и строки подписи.
// Запуск: node --test tests/remarks-2026-09-23-ipk.test.mjs
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
const LAYOUT = path.join(ROOT, 'data/layout/2026/forma-ipk.json');
const PROFILE = { organ_name: 'Тестовый СО', organ_code: '02', unit_code: '02300003', investigator_position: 'следователь', investigator_rank: 'майор юстиции', investigator_fio: 'И.И. Иванов',
  head_position: 'руководитель отдела', head_rank: 'полковник юстиции', head_fio: 'П.П. Петров' };

test('ИПК: реквизиты-перечни («multiple» без max_codes) принимают несколько кодов без ошибки', () => {
  const reqs = [...ix.reqs.get('ipk').values()].filter((r) => r.input?.select === 'multiple' && !r.input.max_codes);
  assert.ok(reqs.length >= 10, `таких реквизитов в ИПК: ${reqs.length}`);
  for (const r of reqs) {
    const codes = r.options.slice(0, 3).map((o) => o.code);
    if (codes.length < 2) continue;
    assert.equal(core.selectionProblem(r, codes), null, `р. ${r.number}: ${codes.join(', ')}`);
  }
  // предел, заданный в форме, действует по-прежнему
  const limited = [...ix.reqs.get('1').values()].find((r) => r.input?.select === 'multiple' && r.input.max_codes);
  assert.ok(limited);
  assert.match(core.selectionProblem(limited, Array.from({ length: limited.input.max_codes + 1 }, (_, i) => String(i))) ?? '', /полей|поле/);
});

test('ИПК: строки подписи – нижний абзац ячейки над линейкой, Times New Roman 8 пт, без табуляции', async () => {
  const layout = JSON.parse(fs.readFileSync(LAYOUT, 'utf8'));
  for (const [who, cell] of [['investigator', 1], ['head', 3]]) {
    const part = layout.fields.find((f) => f.requisite === `sign.${who}`).parts[0];
    assert.deepEqual(part.place, { table: 3, row: 54, cell, para: 2 });
    assert.equal(part.mode, 'para');
    assert.equal(part.size, 16);
    assert.equal(part.replace, true);
    assert.equal(part.font, 'Times New Roman');
  }
  const xml = '<w:tbl><w:tr><w:tc><w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:tab/></w:r></w:p></w:tc></w:tr></w:tbl>';
  const out = core.setCellParagraphText(xml, { table: 0, row: 0, cell: 0 }, 1, 'следователь И.И. Иванов', { size: 16, font: 'Times New Roman', replace: true, align: 'left' });
  assert.doesNotMatch(out, /<w:tab\/>/, 'табуляция линейки убрана');
  assert.match(out, /<w:jc w:val="left"\/><\/w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman"[^>]*\/><w:sz w:val="16"\/>/);
  assert.match(out, /<w:t>x<\/w:t>/, 'первый абзац не тронут');
});

test('ИПК: план бланка ставит подписи следователя и руководителя из профиля', () => {
  const c = core.createCase2({ today: '2026-09-23' });
  core.addObject(c, 'crime'); core.addObject(c, 'person', { crimes: ['crime.1'] }); core.addObject(c, 'victim', { crimes: ['crime.1'] });
  const ev = core.addEvent(c, { type: 'ev.manual', date: '2026-09-23', refs: { crimes: ['crime.1'], persons: ['person.1'], victims: ['victim.1'] } });
  const card = core.addCardManually(ix, c, ev, { form: 'ipk', variant: 'lc', of: { person: 'person.1', crime: 'crime.1' } });
  const memo = core.buildCardMemo(ix, c, ev, card, PROFILE);
  const plan = core.planBlank(memo, JSON.parse(fs.readFileSync(LAYOUT, 'utf8')), { profile: PROFILE });
  const signs = plan.cellEdits.filter((e) => e.place.row === 54);
  assert.equal(signs.length, 2);
  assert.ok(signs.some((e) => e.text === 'следователь майор юстиции И.И. Иванов' && e.mode === 'para' && e.replace === true && e.align === 'left'));
  assert.ok(signs.some((e) => e.text === 'руководитель отдела полковник юстиции П.П. Петров'));
});
