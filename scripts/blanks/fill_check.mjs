// Проверочное заполнение бланка по эталонному делу с дополнительными сведениями (Фаза 1.6).
// К эталонному делу добавляются вымышленные значения составных реквизитов (фабула, время,
// даты, коды профиля), чтобы проверить впечатывание всех видов мест. Сведений реальных дел нет.
//
// Запуск: node scripts/blanks/fill_check.mjs <форма> <куда.docx>
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { demoMemos } from './memo_rows.mjs';
import { ROOT } from '../lib-data.mjs';

const FILE_NAME = { '3': 'forma-3', '1': 'forma-1', '1.1': 'forma-1-1', '2': 'forma-2', '2.1': 'forma-2-1',
  '4': 'forma-4', '5': 'forma-5', '6': 'forma-6', ipk: 'forma-ipk', 'ipk-in': 'forma-ipk-in' };
const PROFILE = { organ_name: 'Тестовый следственный отдел', unit_code: '99TEST01', prosecutor_code: '99PROK01',
  investigator_position: 'следователь', investigator_rank: 'лейтенант юстиции', investigator_fio: 'Тестов Т.Т.',
  blank_sign_investigator: true };

const [form, dst, variant] = process.argv.slice(2);
const { core, ix, c, ev } = await demoMemos('E1');
const put = (cont, fid, v) => core.setFactVersion(c, cont, fid, 'answered', v, null);
const cr = core.getObject ? core.getObject(c, 'crime.1') : null;
if (cr) {
  put(cr, 'fact.crime.ipk_r78', '1');
  put(cr, 'fact.crime.fabula', 'Тестовая фабула: неустановленное лицо тайно похитило имущество из помещения склада, причинив ущерб.');
}
put(c.case, 'fact.case.vud_date', '2026-03-01');
put(c.case, 'fact.case.vud_date.date', '2026-03-01');
put(c.case, 'fact.f1_1.r37', '2026-04-15');
const person = core.getObject(c, 'person.1');
if (person) {
  put(person, 'fact.f2.r7', 'Тестов');
  put(person, 'fact.f2_1.r8', 'Тестов');
  put(person, 'fact.f2_1.r9', 'Тест');
  put(person, 'fact.f2_1.r10', 'Тестович');
  put(person, 'fact.f2.r8', 'Тест Тестович');
  put(person, 'fact.person.birth_date', '1990-05-17');
  put(person, 'fact.person.age', '35');
  put(person, 'fact.f2.r20', 'ООО «Тестовая организация», кладовщик');
  put(person, 'fact.person.surname', 'Тестов');
  put(person, 'fact.person.ipk_in_r12', 'Тестовия');
  put(person, 'fact.person.ipk_in_r11', 'М');
  put(person, 'fact.person.first_name', 'Тест');
  put(person, 'fact.person.patronymic', 'Тестович');
  put(person, 'fact.person.ipk_r07', 'Тестовая республика; Тестовый край; Тестовый район; г. Тестовск');
}
const memos = core.buildPackageMemos(ix, c, ev, PROFILE);
let memo = variant ? null : [...memos.values()].find((m) => m.form === form);
if (!memo) {
  // формы нет в пакете события – карточка собирается вручную по первому эпизоду и первому лицу
  const card = { key: `check|${form}`, form, variant: variant ?? undefined, of: { crime: 'crime.1', person: 'person.1' }, fills: {}, mode: 'primary' };
  memo = core.buildCardMemo(ix, c, ev, card, PROFILE);
}
const layout = JSON.parse(await readFile(path.join(ROOT, `data/layout/2026/${FILE_NAME[form]}.json`), 'utf8'));
memo.fills = { ...memo.fills, [`${form}|12`]: { 0: '14:30' } };
const plan = core.planBlank(memo, layout, { profile: PROFILE });
const bytes = new Uint8Array(await readFile(path.join(ROOT, 'data/blanks/2026', layout.blank)));
await writeFile(dst, await core.fillDocx(bytes, layout, plan.edits, plan.cellEdits));
console.log(`заполнено реквизитов ${plan.fields.length}, знаков ${plan.edits.length}, текстовых мест ${plan.cellEdits.length}`);
for (const f of plan.fields) console.log(`  р. ${f.requisite}: ${f.text}${f.notes.length ? ` [${f.notes.join('; ')}]` : ''}`);
