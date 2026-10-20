// Проверка заполненных бланков (Фаза 3.5, работа 2, критерий A3.5-2).
// Вымышленная карточка каждой формы заполняется ядром (как в tests/cardimport-2026-10-16.test.mjs),
// бланк кладется в data-private/blanks/work с уникальным именем, рядом – памятка (.memo.json и .memo.txt).
// Затем файл читается обратно (readCardFile) и сверяется с памяткой; то же – для PDF, напечатанного
// Word или Excel (osascript scripts/blanks/topdf.applescript / xlsx_topdf.applescript – только с
// разрешения пользователя).
//
// Запуск:
//   node scripts/blanks/filled_check.mjs make [форма …]   – сформировать бланки и сверить .docx/.xlsx
//   node scripts/blanks/filled_check.mjs read <файл> …     – сверить файл (.pdf, .docx, .xlsx) с его памяткой
import fs from 'node:fs';
import path from 'node:path';
import { importCore } from '../bundle.mjs';
import { loadPack } from '../load-pack.mjs';
import { ROOT } from '../lib-data.mjs';

const core = await importCore();
const pack = loadPack();
const ix = core.indexPack(core.regionalPack(pack, pack.region_packs['30']));
const WORK = path.join(ROOT, 'data-private/blanks/work');
const FILE = { '1': 'forma-1', '1.1': 'forma-1-1', '2': 'forma-2', '2.1': 'forma-2-1', '3': 'forma-3', '4': 'forma-4',
  '5': 'forma-5', '6': 'forma-6', ipk: 'forma-ipk', 'ipk-in': 'forma-ipk-in' };
const VARIANT = { ipk: 'lc' };
const layoutOf = (form) => JSON.parse(fs.readFileSync(path.join(ROOT, `data/layout/2026/${FILE[form]}.json`), 'utf8'));
const blankBytes = (file) => new Uint8Array(fs.readFileSync(path.join(ROOT, 'data/blanks/2026', file)));
const PROFILE = { unit_code: '0018', prosecutor_code: '123', investigator_position: 'следователь',
  investigator_rank: 'капитан юстиции', investigator_fio: 'И.И. Иванов', region: '30' };
const FABULA = 'Неустановленное лицо 20.02.2026 около 14 часов в г. Энске тайно похитило имущество потерпевшего на сумму 15000 рублей';
// Ответы, которые проверяют исправления 20.10.2026: коды бланка, отличные от кода варианта, и новые варианты
const FORCED = {
  'fact.f1.r9_1': ['|4', '|13'], // в бланке «04» и «13»
  'fact.f1.r8': ['|16'],
  'fact.f1_1.r15': ['|017'],
  'fact.f1_1.r17': ['|5'],
  'fact.f1_1.r32_1': ['|13'],
  'fact.f1_1.r36': ['|18'],
  'fact.crime.intoxication': ['|01', '|10'], // код 08 – только ст. 263–264.1 (контроль)
  'fact.crime.laundering_predicate': 'ч. 4 ст. 159 УК РФ',
  'fact.f3.r10': '2026-09-20', // срок продления – позже даты решения (контроль ф. 3)
  'fact.f2.r55': ['|17'],
  'fact.crime.new_regions': ['|5'], // ф. 5 р. 18.4: в бланке «11»; ф. 1 р. 19.2, ф. 2 р. 28.2 – «5»
};

const BLANKS = [];
for (const form of Object.keys(FILE)) {
  const layout = layoutOf(form);
  const entries = core.readZip(blankBytes(layout.blank));
  const text = async (name) => core.entryText(entries.find((e) => e.name === name));
  BLANKS.push(layout.kind === 'xlsx' ? { form, layout, sheet: await text(core.XLSX_SHEET), shared: await text('xl/sharedStrings.xml') }
    : { form, layout, xml: await text('word/document.xml') });
}
const POS = {};
for (const form of Object.keys(FILE)) {
  const f = path.join(ROOT, `data/layout/2026/pdf/${FILE[form]}.json`);
  if (fs.existsSync(f)) POS[form] = JSON.parse(fs.readFileSync(f, 'utf8'));
}

function filledCard(form) {
  const c = core.createCase2({ today: '2026-03-01' });
  const set = (cont, fid, v) => core.setFactVersion(c, cont, fid, 'answered', v, null);
  set(c.case, 'fact.case.case_number', '12600000001000045');
  set(c.case, 'fact.case.kusp', '93');
  set(c.case, 'fact.case.kusp_date', '2026-02-21');
  const cr = core.addObject(c, 'crime');
  set(cr, 'fact.crime.qualification', 'ч. 3 ст. 30, п. «в» ч. 2 ст. 158 УК РФ');
  set(cr, 'fact.crime.crime_date', '2026-02-20');
  set(cr, 'fact.crime.fabula', FABULA);
  const p = core.addObject(c, 'person', { crimes: [cr.id] });
  const v = core.addObject(c, 'victim', { crimes: [cr.id] });
  const ev = core.addEvent(c, { type: 'ev.manual', date: '2026-03-01', refs: { crimes: [cr.id], persons: [p.id], victims: [v.id] } });
  const card = core.addCardManually(ix, c, ev, { form, variant: VARIANT[form] ?? null, of: { crime: cr.id, person: p.id, victim: v.id } });
  let i = 0;
  for (const it of core.packageQuestions(ix, c, ev, PROFILE).groups.flatMap((g) => g.items)) {
    if (!it.cards.includes(card.key) || it.answer) continue;
    i += 1;
    const no = core.lookupOf(it.requisite) ?? it.requisite?.classifier_no;
    if (FORCED[it.factId]) core.setPackageAnswer(c, ev, it, 'answered', FORCED[it.factId]);
    else if (no && ix.classifiers.get(no)) {
      const e = ix.classifiers.get(no).entries.filter((x) => /^\d+$/.test(x.code));
      core.setPackageAnswer(c, ev, it, 'answered', [`|${e[(i * 7) % e.length].code}`]);
    } else if (it.input?.select === 'overlay_slots' && it.options.length) {
      const ranks = [...new Set(it.options.map((o) => core.overlayRank(o.code)))].sort((a, b) => a - b);
      core.setPackageAnswer(c, ev, it, 'answered', ranks.map((rk) => core.optKey(it.options.find((o) => core.overlayRank(o.code) === rk))));
    } else if (it.options.length) {
      const o = it.factId === 'fact.crime.attempt' ? it.options.find((x) => x.code === '2') : it.options[i % it.options.length];
      core.setPackageAnswer(c, ev, it, 'answered', [core.optKey(o)]);
    } else if (it.requisite?.field_type === 'date' || it.q.answer.type === 'date') core.setPackageAnswer(c, ev, it, 'answered', '2026-08-20');
    else core.setPackageAnswer(c, ev, it, 'answered', '7');
  }
  return core.buildCardMemo(ix, c, ev, card, PROFILE);
}

const PRINTED = new Set(['fill', 'default', 'hint']);
function compare(form, rows, res) {
  const read = new Map(res.rows.map((r) => [r.id, r]));
  const out = { same: 0, diff: [], missing: [] };
  for (const m of rows) {
    if (!PRINTED.has(m.status) || ['ic', 'court'].includes(m.fills_by) || m.value === null) continue;
    const r = read.get(m.id);
    if (!r) { out.missing.push(m.number); continue; }
    const mp = ix.mapping.get(form).get(m.id);
    const fid = mp?.value_from ?? mp?.value_hint_from;
    const got = r.entries.find((e) => e.fact === fid)?.value;
    if (JSON.stringify(got) === JSON.stringify(m.value)) out.same += 1;
    else out.diff.push(`р. ${m.number}: ${JSON.stringify(m.value)} → ${JSON.stringify(got)}`);
  }
  return out;
}

async function check(file) {
  const base = file.replace(/\.(pdf|docx|xlsx)$/, '');
  const saved = JSON.parse(fs.readFileSync(`${base}.memo.json`, 'utf8'));
  let res;
  try {
    res = await core.readCardFile(ix, path.basename(file), new Uint8Array(fs.readFileSync(file)), { blanks: BLANKS, pdfPositions: POS });
  } catch (e) {
    console.log(`${path.basename(file)}: не прочитан – ${e.message}`);
    return null;
  }
  const cmp = compare(saved.form, saved.rows, res);
  console.log(`${path.basename(file)}: форма ${res.form} (${res.kind})${res.match ? `, ${JSON.stringify(res.match)}` : ''}; совпало ${cmp.same}, расхождений ${cmp.diff.length}, не прочитано ${cmp.missing.length}`);
  for (const d of cmp.diff) console.log(`   ${d}`);
  if (cmp.missing.length) console.log(`   не прочитаны: ${cmp.missing.join(', ')}`);
  for (const r of res.rows.filter((x) => x.notes?.length)) console.log(`   примечание р. ${r.number}: ${r.notes.join('; ')}`);
  return cmp;
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'make') {
  fs.mkdirSync(WORK, { recursive: true });
  const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
  for (const form of args.length ? args : Object.keys(FILE)) {
    const memo = filledCard(form);
    const layout = layoutOf(form);
    const plan = core.planBlank(memo, layout, { profile: PROFILE });
    const bytes = await core.fillDocx(blankBytes(layout.blank), layout, plan.edits, plan.cellEdits);
    const base = path.join(WORK, `p35-${form.replace('.', '')}-${stamp}`);
    const ext = layout.kind === 'xlsx' ? 'xlsx' : 'docx';
    fs.writeFileSync(`${base}.${ext}`, bytes);
    fs.writeFileSync(`${base}.memo.json`, JSON.stringify({ form, rows: memo.rows.map((r) => ({ id: r.id, number: r.number, status: r.status,
      fills_by: r.fills_by, value: r.value, display: r.display })) }, null, 1));
    const lines = memo.rows.filter((r) => PRINTED.has(r.status) && !['ic', 'court'].includes(r.fills_by) && r.display)
      .map((r) => `${r.number}\t${r.display}`);
    fs.writeFileSync(`${base}.memo.txt`, [`Форма ${form}: памятка вымышленной карточки`, ...lines, '',
      'План печати – препятствия:', ...plan.blockers, '', 'Предупреждения:', ...plan.warnings].join('\n'));
    console.log(`ф. ${form}: ${path.relative(ROOT, `${base}.${ext}`)}; мест ${plan.edits.length + plan.cellEdits.length}, препятствий ${plan.blockers.length}`);
    await check(`${base}.${ext}`);
  }
} else if (mode === 'read') {
  for (const f of args) await check(path.resolve(f));
} else {
  console.log('Запуск: node scripts/blanks/filled_check.mjs make [форма …] | read <файл> …');
  process.exit(1);
}
