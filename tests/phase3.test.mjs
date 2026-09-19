// Автотесты Фазы 3 «Полнота и распространение» (критерий A3-2: другие документы дела).
// Набор – tests/fixtures/docs (вымышленные постановления, `node scripts/fixtures/make-docs-corpus.mjs`).
// Запуск: node --test tests/phase3.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importCore } from '../scripts/bundle.mjs';
import { ROOT, readJson } from '../scripts/lib-data.mjs';
import { loadPack } from '../scripts/load-pack.mjs';

const core = await importCore();
const PACK = loadPack();
const IX = core.indexPack(PACK);
const DIR = 'tests/fixtures/docs';
const golds = fs.readdirSync(path.join(ROOT, DIR)).filter((f) => f.endsWith('.gold.json')).sort().map((f) => readJson(path.join(DIR, f)));
const parse = (text) => core.extractDoc(text, { rules: PACK.rules.extract, documents: PACK.documents, optionsOf: (form, req) => core.optionsOf(IX, form, req) });
const run = (g) => parse(fs.readFileSync(path.join(ROOT, DIR, g.file), 'utf8'));
const fieldOf = (res, rule) => res.fields.find((f) => f.rule === rule) ?? null;
const qualKey = (q) => core.parseQualification(q).refs.map((r) => `${r.article}/${r.parts.join(',')}/${r.points.join(',')}`).join(';');
const fio = (p) => `${p.surname} ${p.first_name} ${p.patronymic}`;

// Дело с одним эпизодом и возбуждением – к нему прикладываются остальные документы
function caseWithVud() {
  const c = core.createCase2({ today: '2026-09-20' });
  const crime = core.addObject(c, 'crime');
  core.setFactVersion(c, crime, 'fact.crime.qualification', 'answered', 'п. «в» ч. 2 ст. 158 УК РФ', null);
  const ev = core.addEvent(c, { type: 'ev.vud', date: '2026-01-10', attrs: { vud_mode: 'fact' }, refs: { crimes: [crime.id] } });
  core.applyEventFacts(IX, c, ev);
  core.syncPackage(IX, c, ev);
  return c;
}

const importDoc = (c, res) => core.importDoc(IX, c, res, core.defaultDecisions(res));
const cardFact = (c, evId, form, fact) => {
  const ev = core.getEvent(c, evId);
  const card = ev.cards.find((k) => k.form === form);
  return core.factAt(c, card, fact, evId)?.value ?? null;
};

test('A3-2: вид документа определяется верно для всех образцов', () => {
  assert.equal(golds.length, 24);
  for (const g of golds) {
    const res = run(g);
    assert.ok(res.ok, `${g.file}: ${res.reason}`);
    assert.equal(res.docType, g.doc_type, g.file);
    assert.equal(fieldOf(res, 'x.doc.case_number')?.value, g.case_number, `${g.file}: номер дела`);
    assert.equal(fieldOf(res, 'x.doc.date')?.value, g.doc_date, `${g.file}: дата документа`);
  }
});

test('A3-2: постановление о привлечении в качестве обвиняемого дает лицо и квалификацию', () => {
  for (const g of golds.filter((x) => x.doc_type === 'charge')) {
    const res = run(g);
    assert.deepEqual(res.persons.map((p) => fio(p.names)), g.persons.map(fio), g.file);
    assert.deepEqual(res.persons.map((p) => p.birth), g.persons.map((p) => p.birth), g.file);
    assert.deepEqual(res.episodes.map((e) => qualKey(e.qualification)), g.qualifications, g.file);
  }
});

test('A3-2: коды реквизитов ф. 3 подбираются по ссылке на УПК и по сроку', () => {
  const codeOf = (res, rule) => core.keyCode(fieldOf(res, rule)?.value?.[0] ?? '');
  for (const g of golds) {
    const res = run(g);
    if (g.doc_type === 'extend') {
      assert.equal(codeOf(res, 'x.extend.term'), g.extend.code, `${g.file}: код срока`);
      assert.equal(fieldOf(res, 'x.extend.until')?.value, g.extend.until, `${g.file}: дата, до которой продлен срок`);
    }
    if (g.doc_type === 'suspend') assert.equal(codeOf(res, 'x.suspend.code'), g.suspend.code, g.file);
    if (g.doc_type === 'resume') assert.equal(codeOf(res, 'x.resume.code'), g.resume.code, g.file);
    if (g.doc_type === 'terminate') assert.equal(codeOf(res, 'x.terminate.code'), g.terminate.code, g.file);
  }
});

test('A3-2: потерпевший из постановления о признании потерпевшим', () => {
  for (const g of golds.filter((x) => x.doc_type === 'victim_decision')) {
    const res = run(g);
    assert.deepEqual(res.victims.map((v) => fio(v.names)), g.victims.map(fio), g.file);
  }
});

test('Перенос в дело: обвинение создает событие «Установление лица» и связывает лицо с эпизодом', () => {
  const g = golds.find((x) => x.doc_type === 'charge');
  const c = caseWithVud();
  const res = run(g);
  const log = importDoc(c, res);
  const ev = core.getEvent(c, log.event);
  assert.equal(ev.type, 'ev.person_identified');
  assert.equal(ev.date, g.doc_date);
  assert.equal(c.persons.length, 1);
  assert.equal(core.factAt(c, c.persons[0], 'fact.person.surname').value, g.persons[0].surname);
  assert.deepEqual(c.persons[0].crimes, [c.crimes[0].id], 'лицо связано с эпизодом по квалификации обвинения');
  assert.ok(ev.cards.some((k) => k.form === '2.1'), 'в пакете есть ф. 2.1 – карточка на лицо при установлении');
});

test('Перенос в дело: продление, приостановление, возобновление и прекращение заполняют ф. 3', () => {
  for (const type of ['extend', 'suspend', 'resume', 'terminate']) {
    const g = golds.find((x) => x.doc_type === type);
    const c = caseWithVud();
    const res = run(g);
    const log = importDoc(c, res);
    const ev = core.getEvent(c, log.event);
    assert.equal(ev.type, g.event, type);
    assert.equal(ev.date, g.doc_date, type);
    const pairs = {
      extend: [['fact.f3.r9', g.extend?.code], ['fact.f3.r9_1', g.doc_date], ['fact.f3.r10', g.extend?.until]],
      suspend: [['fact.f3.r12', g.suspend?.code], ['fact.f3.r12_1', g.doc_date]],
      resume: [['fact.f3.r17', g.resume?.code], ['fact.f3.r17_1', g.doc_date]],
      terminate: [['fact.f3.r13', g.terminate?.code], ['fact.f3.r13_1', g.doc_date]],
    }[type];
    for (const [fact, want] of pairs) {
      const got = cardFact(c, log.event, '3', fact);
      const value = Array.isArray(got) ? core.keyCode(got[0]) : got;
      assert.equal(value, want, `${type}: ${fact}`);
    }
    if (type === 'suspend') assert.equal(ev.attrs.ground, g.suspend.point, 'основание события – пункт ст. 208 УПК РФ');
    if (type === 'terminate') {
      assert.equal(ev.attrs.ground_type, g.terminate.ground_type, 'вид основания прекращения');
      assert.equal(c.persons.length, 1, 'лицо, преследование в отношении которого прекращено');
    }
  }
});

test('Перенос в дело: признание потерпевшим создает объект «Потерпевший» по отметке', () => {
  const g = golds.find((x) => x.doc_type === 'victim_decision');
  const c = caseWithVud();
  const res = run(g);
  const dec = core.defaultDecisions(res);
  assert.equal(dec.victims[0].accept, false, 'потерпевший – подсказка, по умолчанию не переносится');
  dec.victims[0].accept = true;
  const log = core.importDoc(IX, c, res, dec);
  assert.equal(c.victims.length, 1);
  assert.equal(c.victims[0].label, `${g.victims[0].surname} ${g.victims[0].first_name[0]}.${g.victims[0].patronymic[0]}.`);
  const ev = core.getEvent(c, log.event);
  assert.equal(ev.type, 'ev.victim_new');
  assert.deepEqual(ev.refs.victims, [c.victims[0].id]);
});

test('Документ по чужому делу: номер дела расходится с внесенным в дело', () => {
  const g = golds.find((x) => x.doc_type === 'suspend');
  const c = caseWithVud();
  core.setFactVersion(c, c.case, 'fact.case.case_number', 'answered', '12600000000000001', null);
  const res = run(g);
  const conflicts = core.importConflicts(c, res, core.defaultDecisions(res));
  assert.deepEqual(conflicts.map((x) => x.field), ['fact.case.case_number']);
});

// ---------- Форматы .rtf и .pdf (перенесено из Фазы 2, ответы В-35, В-46) ----------

const cp1251 = (text) => Uint8Array.from([...text].map((ch) => {
  const c = ch.codePointAt(0);
  if (c < 128) return c;
  if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
  if (c === 0x2116) return 0xb9;
  return 0x3f;
}));

test('A2-1: .rtf читается (кириллица в кодовой странице документа)', async () => {
  const rtf = '{\\rtf1\\ansi\\ansicpg1251{\\fonttbl{\\f0 Times;}}ПОСТАНОВЛЕНИЕ\\par о признании потерпевшим\\par г. Энск\\tab 11.03.2026\\par Следователь, рассмотрев материалы уголовного дела, постановил признать потерпевшим гражданина.\\par}';
  const { text, kind } = await core.fileText('a.rtf', cp1251(rtf));
  assert.equal(kind, 'rtf');
  assert.match(text, /ПОСТАНОВЛЕНИЕ/);
  assert.match(text, /о признании потерпевшим/);
  assert.match(text, /11\.03\.2026/);
});

test('A2-1: .pdf с текстовым слоем читается, скан и нечитаемый текст – понятное сообщение', async () => {
  const lines = ['ПОСТАНОВЛЕНИЕ', 'о приостановлении предварительного следствия', 'г. Энск 11.03.2026',
    'Следователь следственного отдела, рассмотрев материалы уголовного дела, установил основания приостановления производства по делу'];
  const content = `BT /F1 12 Tf ${lines.map((l) => `(${l}) Tj T*`).join(' ')} ET`;
  const parts = [`%PDF-1.4\n1 0 obj\n<</Type/Catalog>>\nendobj\n`, `2 0 obj\n<</Length ${cp1251(content).length}>>\nstream\n`, content, `\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF`];
  const pdf = cp1251(parts.join(''));
  const { text, kind } = await core.fileText('a.pdf', pdf);
  assert.equal(kind, 'pdf');
  assert.match(text, /приостановлении предварительного следствия/);
  await assert.rejects(() => core.fileText('scan.pdf', cp1251('%PDF-1.4\n1 0 obj\n<</Type/Page>>\nendobj\n%%EOF')), /скан/);
  assert.equal(core.looksLikeRussian('¢¢¢ŜŮ¢¢ţŔ¢Ŕũşşũ¢¢¢¢¢¢¢¢¢Ś¢¢¢¢¢¢¢¢¢¢¢¢¢¢¢ť¢¢¢¢¢¢Ś¢¢¢¢¢®¢¢¢¢¢ŭ'), false);
});

test('Слишком большой файл не принимается', async () => {
  await assert.rejects(() => core.fileText('big.docx', new Uint8Array(core.MAX_FILE_BYTES + 1)), /слишком большой/);
});

// ---------- Умолчания по квалификации (A3-3) и новая форма без правки кода (A3-9) ----------

test('A3-3: по квалификации проставляются категория тяжести и перечни с пометкой «умолчание»', () => {
  for (const [qual, category] of [['п. «в» ч. 2 ст. 158 УК РФ', 'medium'], ['ч. 1 ст. 105 УК РФ', 'especially_grave']]) {
    const c = core.createCase2({ today: '2026-09-20' });
    const crime = core.addObject(c, 'crime');
    core.setFactVersion(c, crime, 'fact.crime.qualification', 'answered', qual, null);
    const ev = core.addEvent(c, { type: 'ev.vud', date: '2026-02-01', attrs: { vud_mode: 'fact' }, refs: { crimes: [crime.id] } });
    core.applyEventFacts(IX, c, ev);
    core.syncPackage(IX, c, ev);
    const memo = [...core.buildPackageMemos(IX, c, ev).values()].find((m) => m.form === '1');
    const row = memo.rows.find((r) => /категори[яи] преступления/i.test(r.label ?? ''));
    assert.ok(row, `${qual}: реквизит категории есть в памятке`);
    assert.equal(row.status, 'default', `${qual}: значение помечено как умолчание`);
    assert.match(row.display ?? '', new RegExp(core.CATEGORY_RU[category]), `${qual}: категория`);
  }
});

test('A3-9: новая форма появляется добавлением файла в пакет, без изменения кода', () => {
  const pack = loadPack();
  const form99 = {
    form: '99', title: 'Тестовая карточка формы 99', edition: '2026', effective_from: '2026-01-01', effective_to: null,
    legal_basis: 'проверка расширяемости (A3-9)', source: 'тест', requisites_count: 2, variants: [],
    requisites: [
      { id: '1', number: '1', label: 'Номер уголовного дела', field_type: 'text', classifier_no: null, options: [], multiple: null, has_text: true, has_date: false, section: 'РАЗДЕЛ 1', fills_by: 'investigator', input: { fields: 1, fields_source: 'бланк' }, label_status: 'verified' },
      { id: '2', number: '2', label: 'Квалификация преступления', field_type: 'text', classifier_no: null, options: [], multiple: null, has_text: true, has_date: false, section: 'РАЗДЕЛ 2', fills_by: 'investigator', input: { fields: 1, fields_source: 'бланк' }, label_status: 'verified' },
    ],
  };
  const extended = {
    ...pack,
    forms: [...pack.forms, form99],
    rules: {
      ...pack.rules,
      mapping: [...pack.rules.mapping,
        { id: 'm.f99.r1', form: '99', requisite: '1', value_from: 'fact.case.case_number', match: 'direct', scope: 'case', source_note: 'тест', status: 'draft' },
        { id: 'm.f99.r2', form: '99', requisite: '2', value_from: 'fact.crime.qualification', match: 'direct', scope: 'crime', source_note: 'тест', status: 'draft' }],
    },
  };
  const ix99 = core.indexPack(extended);
  const c = core.createCase2({ today: '2026-09-20' });
  const crime = core.addObject(c, 'crime');
  core.setFactVersion(c, crime, 'fact.crime.qualification', 'answered', 'ч. 1 ст. 105 УК РФ', null);
  core.setFactVersion(c, c.case, 'fact.case.case_number', 'answered', '12600000000000001', null);
  const ev = core.addEvent(c, { type: 'ev.vud', date: '2026-02-01', attrs: { vud_mode: 'fact' }, refs: { crimes: [crime.id] } });
  const card = core.addCardManually(ix99, c, ev, { form: '99', of: { crime: crime.id } });
  const memo = core.buildCardMemo(ix99, c, ev, card);
  assert.equal(memo.form, '99');
  assert.equal(memo.rows.find((r) => r.number === '1').value, '12600000000000001');
  assert.equal(memo.rows.find((r) => r.number === '2').value, 'ч. 1 ст. 105 УК РФ');
});
