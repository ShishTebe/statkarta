// Проверочное заполнение мест, добавленных по замечаниям от 19.09.2026: раздел 1 (номер дела, КРСП,
// даты), ОКАТО ф. 1 р. 19.1, ф. 3 р. 3, 7.2, 7.2.1, 8, 11, 16, 18, 18.1, вид карты ИПК. Значения вымышленные.
// Запуск: node scripts/blanks/remarks_check.mjs <форма> <куда.docx|.xlsx> [вариант]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { demoMemos } from './memo_rows.mjs';
import { ROOT } from '../lib-data.mjs';

const FILE_NAME = { '3': 'forma-3', '1': 'forma-1', '1.1': 'forma-1-1', '2': 'forma-2', '2.1': 'forma-2-1',
  '4': 'forma-4', '5': 'forma-5', '6': 'forma-6', ipk: 'forma-ipk', 'ipk-in': 'forma-ipk-in' };
const PROFILE = { organ_name: 'Тестовый следственный отдел', unit_code: '99TEST01', investigator_position: 'следователь',
  investigator_rank: 'лейтенант юстиции', investigator_fio: 'Тестов Т.Т.', blank_sign_investigator: true };
const [form, dst, variant] = process.argv.slice(2);
const { core, ix, c, ev } = await demoMemos('E1');
const put = (cont, fid, v) => core.setFactVersion(c, cont, fid, 'answered', v, null);
put(c.case, 'fact.case.case_number', '12600000017000123');
put(c.case, 'fact.case.kusp', '4567');
put(c.case, 'fact.case.kusp_date', '2026-02-27');
put(c.case, 'fact.case.vud_date', '2026-03-01');
put(c.case, 'fact.case.vud_date.date', '2026-03-01');
const cr = core.getObject(c, 'crime.1');
put(cr, 'fact.crime.crime_date', '2026-02-20');
put(cr, 'fact.crime.okato', ['|30401000000']);
const card = { key: `check|${form}`, form, variant: variant ?? null, of: form === '5' ? { victim: c.victims[0]?.id, crime: 'crime.1' } : { crime: 'crime.1', person: 'person.1' },
  fills: form === '3' ? { '3|8': { 0: '12600000017000077' } } : {}, facts: {}, mode: 'new' };
if (form === '3') {
  const f = { 'fact.f3.r7_2': ['|03'], 'fact.f3.r7_2_1': '2026-05-12', 'fact.f3.r8': ['|1'], 'fact.f3.r8_1': '2026-05-13',
    'fact.f3.r11': '2026-05-14', 'fact.f3.r16': ['|003', '|010'], 'fact.f3.r16_1': '2026-05-15', 'fact.f3.r18': ['|4'], 'fact.f3.r18_1': '2026-05-16' };
  for (const [fid, v] of Object.entries(f)) card.facts[fid] = [{ event: null, status: 'answered', value: v }];
}
ev.cards.push(card);
const memo = core.buildCardMemo(ix, c, ev, card, PROFILE);
const layout = JSON.parse(await readFile(path.join(ROOT, `data/layout/2026/${FILE_NAME[form]}.json`), 'utf8'));
const plan = core.planBlank(memo, layout, { profile: PROFILE });
const bytes = new Uint8Array(await readFile(path.join(ROOT, 'data/blanks/2026', layout.blank)));
await writeFile(dst, await core.fillDocx(bytes, layout, plan.edits, plan.cellEdits));
const want = new Set(['3', '3.1', '3.2', '3.3', '4', '5', '7.2', '7.2.1', '8', '11', '16', '18', '18.1', '19.1', 'variant']);
for (const f of plan.fields) if (want.has(f.requisite)) console.log(`  р. ${f.requisite}: ${f.text || (f.cellEdits ?? []).map((x) => x.text).join(' ')}${f.notes.length ? ` [${f.notes.join('; ')}]` : ''}`);
