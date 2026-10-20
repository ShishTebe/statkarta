// Автотесты «Заполнение по другой карточке» (замечание заказчика от 16.10.2026): заполненная карточка
// (Word .docx или PDF, сохраненный из Word) читается по карте раскладки бланка, ее реквизиты переносятся
// в новую карточку – новый эпизод, новое лицо по тому же преступлению, карточка другого дела.
// Все сведения в тестах вымышленные. Запуск: node --test tests/cardimport-2026-10-16.test.mjs
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
const FILE = { '3': 'forma-3', '1': 'forma-1', '1.1': 'forma-1-1', '2': 'forma-2', '2.1': 'forma-2-1', '4': 'forma-4', '5': 'forma-5', '6': 'forma-6', ipk: 'forma-ipk', 'ipk-in': 'forma-ipk-in' };
const layoutOf = (form) => JSON.parse(fs.readFileSync(path.join(ROOT, `data/layout/2026/${FILE[form]}.json`), 'utf8'));
const pdfPosOf = (form) => JSON.parse(fs.readFileSync(path.join(ROOT, `data/layout/2026/pdf/${FILE[form]}.json`), 'utf8'));
const blankBytes = (file) => new Uint8Array(fs.readFileSync(path.join(ROOT, 'data/blanks/2026', file)));
const PROFILE = { unit_code: '0018', prosecutor_code: '123', investigator_position: 'следователь', investigator_rank: 'капитан юстиции', investigator_fio: 'И.И. Иванов', region: '30' };
const FABULA = 'Неустановленное лицо 20.02.2026 около 14 часов в г. Энске тайно похитило имущество потерпевшего на сумму 15000 рублей';

const BLANKS = [];
for (const form of Object.keys(FILE)) {
  const layout = layoutOf(form);
  const entries = core.readZip(blankBytes(layout.blank));
  const text = async (name) => core.entryText(entries.find((e) => e.name === name));
  BLANKS.push(layout.kind === 'xlsx' ? { form, layout, sheet: await text(core.XLSX_SHEET), shared: await text('xl/sharedStrings.xml') }
    : { form, layout, xml: await text('word/document.xml') });
}
const POS = Object.fromEntries(['1', '1.1', '2', '2.1', '4', '5', '6'].map((f) => [f, pdfPosOf(f)]));

// Заполненная программой карточка: сведения дела вымышленные, остальные вопросы – первый подходящий код
function filledCard(form, { variant = null } = {}) {
  const c = core.createCase2({ today: '2026-03-01' });
  const set = (cont, fid, v) => core.setFactVersion(c, cont, fid, 'answered', v, null);
  set(c.case, 'fact.case.case_number', '12600000001000045');
  set(c.case, 'fact.case.kusp', '93');
  set(c.case, 'fact.case.kusp_date', '2026-02-21');
  const cr = core.addObject(c, 'crime');
  set(cr, 'fact.crime.qualification', 'ч. 3 ст. 30, п. «в» ч. 2 ст. 158 УК РФ');
  set(cr, 'fact.crime.crime_date', '2026-02-20');
  set(cr, 'fact.crime.fabula', FABULA);
  // р. 13.1 ф. 1 и р. 7.1 ф. 1.1 с 20.10.2026 раскладываются по клеткам «ст., зн., ч., п.» – нужна квалификация
  set(cr, 'fact.crime.laundering_predicate', 'ч. 4 ст. 159 УК РФ');
  const p = core.addObject(c, 'person', { crimes: [cr.id] });
  const v = core.addObject(c, 'victim', { crimes: [cr.id] });
  const ev = core.addEvent(c, { type: 'ev.manual', date: '2026-03-01', refs: { crimes: [cr.id], persons: [p.id], victims: [v.id] } });
  const card = core.addCardManually(ix, c, ev, { form, variant, of: { crime: cr.id, person: p.id, victim: v.id } });
  let i = 0;
  for (const it of core.packageQuestions(ix, c, ev, PROFILE).groups.flatMap((g) => g.items)) {
    if (!it.cards.includes(card.key) || it.answer) continue;
    i += 1;
    const no = core.lookupOf(it.requisite) ?? it.requisite?.classifier_no;
    if (no && ix.classifiers.get(no)) {
      const e = ix.classifiers.get(no).entries.filter((x) => /^\d+$/.test(x.code));
      core.setPackageAnswer(c, ev, it, 'answered', [`|${e[(i * 7) % e.length].code}`]);
    } else if (it.input?.select === 'overlay_slots' && it.options.length) {
      const ranks = [...new Set(it.options.map((o) => core.overlayRank(o.code)))].sort((a, b) => a - b);
      core.setPackageAnswer(c, ev, it, 'answered', ranks.map((rk) => core.optKey(it.options.find((o) => core.overlayRank(o.code) === rk))));
    } else if (it.options.length) {
      // р. 16 ф. 1 (стадия) – по квалификации: покушение
      const o = it.factId === 'fact.crime.attempt' ? it.options.find((x) => x.code === '2') : it.options[i % it.options.length];
      core.setPackageAnswer(c, ev, it, 'answered', [core.optKey(o)]);
    } else if (it.requisite?.field_type === 'date' || it.q.answer.type === 'date') core.setPackageAnswer(c, ev, it, 'answered', '2026-08-20');
    else core.setPackageAnswer(c, ev, it, 'answered', '7');
  }
  const memo = core.buildCardMemo(ix, c, ev, card, PROFILE);
  return { c, ev, card, memo };
}

async function filledDocx(form, opts) {
  const f = filledCard(form, opts);
  const layout = layoutOf(form);
  const plan = core.planBlank(f.memo, layout, { profile: PROFILE });
  return { ...f, layout, plan, bytes: await core.fillDocx(blankBytes(layout.blank), layout, plan.edits, plan.cellEdits) };
}

const PRINTED = new Set(['fill', 'default', 'hint']);
// Сколько напечатанных реквизитов прочитано тем же значением
function compare(form, memo, res) {
  const read = new Map(res.rows.map((r) => [r.id, r]));
  const out = { same: 0, diff: [] };
  for (const m of memo.rows) {
    if (!PRINTED.has(m.status) || ['ic', 'court'].includes(m.fills_by) || m.value === null) continue;
    const r = read.get(m.id);
    if (!r) continue;
    const mp = ix.mapping.get(form).get(m.id);
    const fid = mp?.value_from ?? mp?.value_hint_from;
    const got = r.entries.find((e) => e.fact === fid)?.value;
    if (JSON.stringify(got) === JSON.stringify(m.value)) out.same += 1;
    else out.diff.push(`р. ${m.number}: ${JSON.stringify(m.value)} → ${JSON.stringify(got)}`);
  }
  return out;
}

test('.docx ф. 1: форма определяется по бланку, все напечатанные реквизиты читаются теми же значениями', async () => {
  const { memo, bytes } = await filledDocx('1');
  const res = await core.readCardFile(ix, 'карточка.docx', bytes, { blanks: BLANKS, pdfPositions: POS });
  assert.equal(res.form, '1');
  assert.equal(res.kind, 'docx');
  const cmp = compare('1', memo, res);
  assert.deepEqual(cmp.diff, []);
  assert.ok(cmp.same >= 40, `прочитано ${cmp.same}`);
  const val = (fid) => res.rows.flatMap((r) => r.entries).find((e) => e.fact === fid)?.value;
  assert.equal(val('fact.crime.fabula'), FABULA, 'фабула – текст места без линеек и чужих клеток');
  assert.equal(val('fact.crime.crime_date'), '2026-02-20');
  assert.equal(val('fact.crime.qualification'), 'ч. 3 ст. 30, п. «в» ч. 2 ст. 158 УК РФ', 'стадия восстановлена по р. 16');
  assert.equal(val('fact.case.case_number'), '12600000001000045');
  assert.equal(val('fact.case.kusp_date'), '2026-02-21');
  const r2 = res.rows.find((r) => r.number === '2');
  assert.match(r2.skip, /видом новой карточки/, 'р. 2 (учесть, изменить) задается новой карточкой');
});

test('.docx других форм: форма определяется, напечатанные реквизиты читаются', async () => {
  for (const [form, variant] of [['1.1'], ['2'], ['2.1'], ['3'], ['4'], ['5'], ['6'], ['ipk', 'lc']]) {
    const { memo, bytes } = await filledDocx(form, { variant });
    const res = await core.readCardFile(ix, 'к.docx', bytes, { blanks: BLANKS, pdfPositions: POS });
    assert.equal(res.form, form, `ф. ${form}`);
    const cmp = compare(form, memo, res);
    // одинаковые коды в разных группах вариантов (ф. 4 р. 29.2) различить по клетке нельзя – помечаются примечанием;
    // в квалификации ф. 4 р. 6 (с 20.10.2026 впечатывается) клеток стадии нет – «ч. 3 ст. 30» обратно не читается
    const diff = cmp.diff.filter((d) => !/^р\. 6: "ч\. 3 ст\. 30, (.+)" → "\1"$/.test(d) || form !== '4');
    assert.ok(diff.length <= 1, `ф. ${form}: ${diff.join('; ')}`);
    assert.ok(cmp.same >= 8, `ф. ${form}: прочитано ${cmp.same}`);
  }
});

test('вписанное в бланк: разница с чистым бланком без остатков линеек', () => {
  assert.equal(core.insertedText('СОВЕРШЕНИЯ ______ год', 'СОВЕРШЕНИЯ Кража у дома__ год'), 'Кража у дома');
  assert.equal(core.insertedText('', '12 34'), '12 34');
  assert.equal(core.insertedText('Фамилия ____', 'Фамилия ____'), '');
});

test('наложение кодов раскладывается на варианты реквизита, неизвестный код – примечанием', () => {
  const layout = { fields: [{ requisite: '10', groups: [[1, 2, 3, 4]] }, { requisite: '18', groups: [[5, 6]] }] };
  const r10 = ix.reqs.get('1').get('10');
  const two = r10.options.filter((o) => o.code.length === 4 && /^[1-9]000$/.test(o.code)).slice(0, 1)
    .concat(r10.options.filter((o) => /^00[1-9]0$|^000[1-9]$/.test(o.code)).slice(0, 1));
  const code = core.composeOverlay(two.map((o) => o.code));
  const cells = new Map([...code].map((ch, i) => [i + 1, ch]).concat([[5, '9'], [6, '9']]));
  const rows = core.cardValues(ix, '1', layout, { cells, texts: {} });
  const r = rows.find((x) => x.id === '10');
  assert.deepEqual(r.entries[0].value.map(core.keyCode).sort(), two.map((o) => o.code).sort());
  const bad = rows.find((x) => x.id === '18');
  assert.equal(bad.confidence, 'low');
  assert.match(bad.notes.join(' '), /не раскладывается|не найден/);
});

// ---- PDF ----

// Простой PDF: текст в заданных местах страницы (шрифт с таблицей ToUnicode – как у Word)
function miniPdf(pages) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /T def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n'
    + '4 beginbfrange <0020> <007E> <0020> <00A0> <00A0> <00A0> <0401> <0401> <0401> <0410> <044F> <0410> endbfrange\n5 beginbfchar <0451> <0451> <00AB> <00AB> <00BB> <00BB> <2116> <2116> <2013> <2013> endbfchar endcmap end end';
  const tu = add(`<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`);
  const font = add(`<< /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding /Identity-H /ToUnicode ${tu} 0 R >>`);
  const hex = (s) => [...s].map((ch) => ch.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  const kids = [];
  const pagesId = objs.length + 1 + pages.length * 2;
  for (const p of pages) {
    const body = p.items.map((it) => `BT /F1 ${it.size} Tf 1 0 0 1 ${it.x.toFixed(2)} ${(p.h - it.y).toFixed(2)} Tm <${hex(it.text)}> Tj ET`).join('\n');
    const content = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${p.w} ${p.h}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const root = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.7\n';
  const offs = [];
  objs.forEach((b, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${root} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array([...out].map((ch) => ch.charCodeAt(0) & 0xff));
}

// «Печать» заполненной карточки в PDF по координатам бланка: знак – по центру своей клетки,
// номера реквизитов – в левом поле, фабула – в своей области
function printedPdf(form, plan, { shift = [0, 0], fabula = null } = {}) {
  const pos = POS[form];
  const size = 9;
  const pages = pos.pages.map(([w, hh]) => ({ w, h: hh, items: [] }));
  const at = new Map(pos.cells.map(([shape, page, x, top]) => [shape, { page, x, top }]));
  for (const e of plan.edits) {
    const c = at.get(e.shape);
    if (!c) continue;
    pages[c.page].items.push({ x: c.x - size * 0.25 + shift[0], y: c.top + size * 0.89 + shift[1], size, text: e.text });
  }
  for (const [label, page, x, top] of pos.anchors) pages[page].items.push({ x: x + shift[0], y: top + 8 * 0.89 + shift[1], size: 8, text: `${label}.` });
  for (const r of pos.regions) {
    // печатные слова бланка – на своих местах, как их печатает Word
    for (const [wx, , top, text] of r.blank_words) pages[r.page].items.push({ x: wx + shift[0], y: top + 8 * 0.89 + shift[1], size: 8, text });
    if (fabula && r.requisite === '12') pages[r.page].items.push({ x: r.box[0] + 6 + shift[0], y: r.box[1] + 20 + shift[1], size: 6, text: fabula });
  }
  return miniPdf(pages);
}

test('PDF ф. 1: знаки по координатам мест бланка, сдвиг полей принтера учитывается', async () => {
  const { memo, plan } = await filledDocx('1');
  for (const shift of [[0, 0], [2.4, -1.8]]) {
    const pdf = printedPdf('1', plan, { shift, fabula: FABULA });
    const res = await core.readCardFile(ix, 'карточка.pdf', pdf, { blanks: BLANKS, pdfPositions: POS });
    assert.equal(res.form, '1');
    assert.equal(res.kind, 'pdf');
    assert.ok(res.match.share > 0.9);
    const cmp = compare('1', memo, res);
    assert.deepEqual(cmp.diff, [], `сдвиг ${shift}`);
    assert.ok(cmp.same >= 40);
  }
});

test('PDF: не карточка, скан, старый .doc – понятный отказ', async () => {
  const other = miniPdf([{ w: 595, h: 842, items: [{ x: 100, y: 100, size: 12, text: 'Постановление о возбуждении уголовного дела' }] }]);
  await assert.rejects(() => core.readCardFile(ix, 'п.pdf', other, { blanks: BLANKS, pdfPositions: POS }), /не совпадает с бланком/);
  const scan = miniPdf([{ w: 595, h: 842, items: [] }]);
  await assert.rejects(() => core.readCardFile(ix, 'скан.pdf', scan, { blanks: BLANKS, pdfPositions: POS }), /текстового слоя/);
  await assert.rejects(() => core.readCardFile(ix, 'к.doc', Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0, 0), { blanks: BLANKS }), /\.doc/);
  const zip = await core.zipFiles([{ name: 'word/document.xml', bytes: new TextEncoder().encode('<w:document><w:body><w:p><w:r><w:t>Справка</w:t></w:r></w:p></w:body></w:document>') }]);
  await assert.rejects(() => core.readCardFile(ix, 'с.docx', zip, { blanks: BLANKS }), /не похож на бланк карточки/);
});

// ---- перенос в дело ----

async function readF1() {
  const { bytes } = await filledDocx('1');
  return core.readCardFile(ix, 'карточка.docx', bytes, { blanks: BLANKS, pdfPositions: POS });
}

test('новый эпизод того же дела: сведения дела не затираются, эпизод и карточка ф. 1 заполнены', async () => {
  const res = await readF1();
  const c = core.createCase2({ today: '2026-10-16' });
  core.setFactVersion(c, c.case, 'fact.case.case_number', 'answered', '12600000001000045', null);
  const cr1 = core.addObject(c, 'crime');
  core.setFactVersion(c, cr1, 'fact.crime.qualification', 'answered', 'ч. 1 ст. 159 УК РФ', null);
  const dec = core.cardImportDefaults(res, { sameCase: true });
  assert.deepEqual(core.cardImportConflicts(ix, c, res, dec, { crime: 'new' }), [], 'номер дела тот же – расхождений нет');
  const log = core.applyCardImport(ix, c, res, dec, { form: '1', crime: 'new', event: 'manual' }, PROFILE);
  assert.equal(c.crimes.length, 2, 'новый эпизод');
  const cr2 = c.crimes.find((x) => x.id === log.crime);
  assert.notEqual(cr2.id, cr1.id);
  assert.equal(core.factAt(c, cr2, 'fact.crime.fabula').value, FABULA);
  assert.equal(core.factAt(c, cr1, 'fact.crime.qualification').value, 'ч. 1 ст. 159 УК РФ', 'прежний эпизод не тронут');
  const ev = core.getEvent(c, log.event);
  assert.equal(ev.type, 'ev.manual');
  const card = ev.cards.find((k) => k.key === log.card);
  assert.equal(card.form, '1');
  assert.equal(card.of.crime, cr2.id);
  assert.ok(log.cardFacts > 10, 'реквизиты карточки (р. 9, 10, 21 …) перенесены');
  // коды из профиля органа (р. 40: код подразделения, прокуратуры) не затираются кодами карточки
  assert.equal(card.fills?.['1|40']?.[0], undefined);
  const memo = core.buildCardMemo(ix, c, ev, card, PROFILE);
  assert.equal(memo.rows.find((r) => r.number === '12').value, FABULA);
  assert.match(String(memo.rows.find((r) => r.number === '2').display), /основная/, 'вид карточки – по новой карточке');
});

test('карточка другого дела: номер дела, КРСП и дата возбуждения по умолчанию не переносятся', async () => {
  const res = await readF1();
  const dec = core.cardImportDefaults(res, { sameCase: false });
  const ids = (r) => r.entries.map((e) => e.fact);
  for (const r of res.rows) {
    if (ids(r).some((f) => ['fact.case.case_number', 'fact.case.kusp', 'fact.case.vud_date'].includes(f))) assert.equal(dec.rows[r.id].accept, false, `р. ${r.number}`);
  }
  assert.equal(dec.rows[res.rows.find((r) => r.number === '13').id].accept, true, 'квалификация переносится');
  const c = core.createCase2({ today: '2026-10-16' });
  core.addObject(c, 'crime');
  core.applyCardImport(ix, c, res, dec, { form: '1', crime: 'crime.1', event: 'manual' }, PROFILE);
  assert.equal(core.factAt(c, c.case, 'fact.case.case_number'), null);
});

test('новое лицо по тому же преступлению: карточка ф. 2 получает сведения дела и эпизода, свои реквизиты ф. 1 не переносятся', async () => {
  const res = await readF1();
  const c = core.createCase2({ today: '2026-10-16' });
  const cr = core.addObject(c, 'crime');
  const dec = core.cardImportDefaults(res, { sameCase: true });
  const log = core.applyCardImport(ix, c, res, dec, { form: '2', crime: cr.id, person: 'new', event: 'manual', of: ['person'] }, PROFILE);
  assert.equal(c.persons.length, 1);
  assert.ok(c.persons[0].crimes.includes(cr.id));
  const ev = core.getEvent(c, log.event);
  const card = ev.cards.find((k) => k.key === log.card);
  assert.equal(card.form, '2');
  assert.equal(card.of.person, c.persons[0].id);
  assert.ok(log.skipped.length > 5, 'р. 9, 10 и др. – свои у ф. 1');
  assert.equal(log.cardFacts, 0);
  const memo = core.buildCardMemo(ix, c, ev, card, PROFILE);
  const qual = memo.rows.find((r) => ix.mapping.get('2').get(r.id)?.value_from === 'fact.crime.qualification' && r.status === 'fill');
  assert.ok(qual, 'квалификация эпизода видна в ф. 2');
});

test('расхождения с делом показываются; без «заменить» остается значение дела', async () => {
  const res = await readF1();
  const c = core.createCase2({ today: '2026-10-16' });
  const cr = core.addObject(c, 'crime');
  core.setFactVersion(c, cr, 'fact.crime.crime_date', 'answered', '2026-01-01', null);
  const dec = core.cardImportDefaults(res, { sameCase: true });
  const conf = core.cardImportConflicts(ix, c, res, dec, { crime: cr.id });
  assert.ok(conf.some((x) => x.fact === 'fact.crime.crime_date'));
  const log = core.applyCardImport(ix, c, res, dec, { form: '1', crime: cr.id, event: 'manual' }, PROFILE);
  assert.ok(log.kept.includes('fact.crime.crime_date'));
  assert.equal(core.factAt(c, cr, 'fact.crime.crime_date').value, '2026-01-01');
  const dec2 = { ...core.cardImportDefaults(res, { sameCase: true }), replace: true };
  core.applyCardImport(ix, c, res, dec2, { form: '1', crime: cr.id, event: 'manual' }, PROFILE);
  assert.equal(core.factAt(c, cr, 'fact.crime.crime_date').value, '2026-02-20');
});

// ---- настоящий PDF из Word (только на компьютере разработчика: размеченная копия бланка не публикуется) ----

const WORK = path.join(ROOT, 'data-private/blanks/work');
test('PDF, напечатанный Word: метки размеченного бланка попадают в свои клетки', { skip: !fs.existsSync(path.join(WORK, 'cards_1-marked.pdf')) }, async () => {
  for (const [form, base] of [['1', 'cards_1'], ['1.1', 'cards_1.1'], ['2', 'cards_2'], ['4', 'cards_4'], ['6', 'cards_6']]) {
    const ex = await core.pdfTextChunks(new Uint8Array(fs.readFileSync(path.join(WORK, `${base}-marked.pdf`))));
    const read = core.pdfCardCells(ex, POS[form]);
    const marks = JSON.parse(fs.readFileSync(path.join(WORK, `${base}-marks.json`), 'utf8')).marks;
    const own = marks.filter((m) => POS[form].cells.some((c) => c[0] === m.shape));
    const ok = own.filter((m) => read.cells.get(m.shape) === m.mark).length;
    assert.ok(ok / own.length > 0.98, `ф. ${form}: ${ok} из ${own.length}`);
    assert.ok(read.match.share > 0.9, `ф. ${form}: номера реквизитов`);
  }
});

// ---- ревизия 16.10.2026: р. 30 ф. 1 ----

test('р. 30 ф. 1: количество потерпевших – в первое поле первой строки, дополнительные поля – в свои клетки', () => {
  const layout = layoutOf('1');
  const field = layout.fields.find((f) => f.requisite === '30');
  const row = { id: '30', number: '30', status: 'fill', fills_by: 'investigator', value: '12', requisite: ix.reqs.get('1').get('30') };
  const memo = { form: '1', facts: { 'fact.victims.victims_count': { status: 'answered', value: '12' } },
    fills: { '1|30': { 1: '1', 2: '3', 3: '2', 4: '5', 5: '1', 6: '4', 7: '6', 8: '7', 9: '8', 10: '9', 11: '2' } } };
  const plan = core.planField(row, field, memo);
  const at = Object.fromEntries(plan.edits.map((e) => [e.shape, e.text]));
  // строки: все (744 – 753), н/л (766 – 775), женщины (755 – 764), н/л женского пола (777 – 790); поля – потер., погиб., повреж.
  assert.deepEqual(at, { 745: '1', 746: '2', 749: '1', 753: '3', 768: '2', 771: '4', 775: '6', 757: '5', 760: '7', 764: '8', 778: '1', 787: '9', 781: '2' });
  assert.ok(!plan.blocked);
  // и обратно: из клеток – то же количество и те же поля
  const rows = core.cardValues(ix, '1', { fields: [field] }, { cells: new Map(plan.edits.map((e) => [e.shape, e.text])), texts: {} });
  assert.equal(rows[0].entries[0].value, '12');
  assert.deepEqual(rows[0].fills, { 1: '1', 2: '3', 3: '2', 4: '5', 5: '1', 6: '4', 7: '6', 8: '7', 9: '8', 10: '9', 11: '2' });
});

test('р. 30 ф. 1: 12 полей бланка, прежнее поле № 0 скрыто, поля – в порядке бланка (ответ В-78)', () => {
  const r = ix.reqs.get('1').get('30');
  assert.equal(r.input.fills.length, 12);
  assert.equal(r.input.fills[0].retired, true);
  const shown = core.fillsInOrder(r.input.fills).map(([f]) => /\((30\.\d+)\)/.exec(f.label)[1]);
  assert.deepEqual(shown, ['30.2', '30.3', '30.4', '30.5', '30.6', '30.7', '30.8', '30.9', '30.10', '30.11', '30.12']);
});

// ---- ответ В-80: PDF печатной копии программы ----

// Копия, как ее печатает браузер: заголовок «(форма № …, ред. 2026)», строки «номер – наименование –
// клетки»; каждый знак – отдельно, пустая клетка – неразрывный пробел (так печатает Chrome)
function copyPdf(memo, layout, plan) {
  const sheet = core.blankSheet(ix, memo, layout, plan, { profile: PROFILE });
  const NB = String.fromCharCode(0xa0);
  const pages = [{ w: 595, h: 842, items: [] }];
  let y = 40;
  const line = (items) => {
    if (y > 800) { pages.push({ w: 595, h: 842, items: [] }); y = 40; }
    pages.at(-1).items.push(...items.map((it) => ({ ...it, y })));
    y += 14;
  };
  const glyphs = (x, text, step = 6) => [...text].map((ch, i) => ({ x: x + i * step, size: 10.5, text: ch }));
  // длинный заголовок браузер переносит на вторую строку
  const head = `${sheet.title} (форма № ${sheet.form}, ред. ${sheet.edition})`;
  const cut = head.lastIndexOf(' ', 80);
  line(glyphs(25.5, head.length > 80 ? head.slice(0, cut) : head));
  if (head.length > 80) line(glyphs(25.5, head.slice(cut + 1)));
  for (const sec of sheet.sections) {
    if (sec.title) line(glyphs(25.5, sec.title.slice(0, 40)));
    for (const r of sec.rows) {
      const cells = r.groups.flatMap((g, gi) => g.map((ch, k) => ({ ch: ch || NB, gap: gi && !k })));
      let x = 346.3;
      const val = [];
      for (const c of cells) { if (c.gap) x += 6; val.push({ x, size: 10.5, text: c.ch }); x += 8.32; }
      const text = r.text ? glyphs(x + 5, r.text.slice(0, 30)) : [];
      line([...glyphs(28.9, r.number), ...glyphs(64.7, r.label.slice(0, 20)), ...val.slice(0, 28), ...text]);
      for (let i = 28; i < val.length; i += 28) line(val.slice(i, i + 28).map((v, k) => ({ ...v, x: 346.3 + k * 8.32 })));
    }
  }
  return miniPdf(pages);
}

test('PDF печатной копии программы: клетки по порядку чтения, пустая клетка – неразрывный пробел', async () => {
  for (const [form, variant] of [['1'], ['2'], ['5'], ['ipk', 'lc']]) {
    const { memo, layout, plan } = await filledDocx(form, { variant });
    const res = await core.readCardFile(ix, 'копия.pdf', copyPdf(memo, layout, plan), { blanks: BLANKS, pdfPositions: POS });
    assert.equal(res.kind, 'copy', `ф. ${form}`);
    assert.equal(res.form, form);
    assert.deepEqual(res.match.problems, [], `ф. ${form}: строки без разбора`);
    const cmp = compare(form, memo, res);
    // текст длиннее 30 знаков в синтетической копии обрезан – сравниваются клетки
    const diff = cmp.diff.filter((d) => !/fabula|\[|"[^"]{31,}/.test(d) && !d.includes(FABULA.slice(0, 20)));
    assert.deepEqual(diff, [], `ф. ${form}`);
    assert.ok(cmp.same >= 8, `ф. ${form}: прочитано ${cmp.same}`);
  }
});

test('ф. 3 из книги Excel: форма определяется по книге, чужая книга – отказ', async () => {
  const { memo, bytes } = await filledDocx('3');
  const res = await core.readCardFile(ix, 'ф3.xlsx', bytes, { blanks: BLANKS });
  assert.equal(res.kind, 'xlsx');
  assert.equal(res.form, '3');
  const cmp = compare('3', memo, res);
  assert.deepEqual(cmp.diff, []);
  assert.ok(cmp.same >= 15, `прочитано ${cmp.same}`);
  const other = await core.zipFiles([{ name: core.XLSX_SHEET, bytes: new TextEncoder().encode('<worksheet><sheetData/></worksheet>') }]);
  await assert.rejects(() => core.readCardFile(ix, 'книга.xlsx', other, { blanks: BLANKS }), /не похожа на бланк ф\. 3/);
});


// ---- В-79: PDF заполненной карточки, сохраненный Word ----

test('ToUnicode: диапазон списком знаков (так пишет Word) и двузначные коды', () => {
  const map = core.parseToUnicode('beginbfrange\n<0000> <0002> [<0020> <043E> <0440>]\n<0011> <0012> <0030>\nendbfrange\nbeginbfchar\n<41> <0041>\nendbfchar');
  assert.equal(map.get(1), 'о');
  assert.equal(map.get(2), 'р');
  assert.equal(map.get(0x12), '1');
  assert.equal(map.get(0x41), 'A');
});

const V79 = path.join(WORK, 'v79-f1-162656');
test('PDF, сохраненный Word из заполненной карточки ф. 1: все реквизиты, фабула, р. 30', { skip: !fs.existsSync(`${V79}.pdf`) }, async () => {
  const res = await core.readCardFile(ix, 'v.pdf', new Uint8Array(fs.readFileSync(`${V79}.pdf`)), { blanks: BLANKS, pdfPositions: POS });
  assert.equal(res.kind, 'pdf');
  assert.equal(res.match.found, res.match.anchors);
  const rows = JSON.parse(fs.readFileSync(`${V79}.memo.json`, 'utf8'));
  const { fills } = rows.pop();
  const cmp = compare('1', { rows }, res);
  assert.deepEqual(cmp.diff, []);
  assert.ok(cmp.same >= 45, `прочитано ${cmp.same}`);
  assert.deepEqual(res.rows.find((r) => r.id === '30').fills, fills['1|30']);
});
