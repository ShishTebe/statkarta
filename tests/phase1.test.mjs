// Автотесты Фазы 1 (критерии A1-2 – A1-5, A1-7, A1-11, A1-12). Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importCore } from '../scripts/bundle.mjs';
import { loadPack } from '../scripts/load-pack.mjs';
import { ROOT } from '../scripts/lib-data.mjs';

const core = await importCore();
const hasPrivate = fs.existsSync(path.join(ROOT, 'data-private/classifiers/2026/spr-17.json'));
const pack = loadPack({ withPrivate: hasPrivate });
const ix = core.indexPack(pack);
const factOf = (form, req) => ix.mapping.get(form).get(req).value_from;
const newCase = (answers = {}, forms = []) => {
  const c = core.createCase();
  for (const [k, v] of Object.entries(answers)) core.setAnswer(c, k, v === null ? 'na' : 'answered', v);
  c.forms = forms;
  return c;
};
const failed = (memo, id) => memo.checks.some((x) => x.id === id);

test('A1-12, A1-2: памятка по формам 1, 1.1, 2, 3 содержит все реквизиты в порядке бланка', () => {
  const c = newCase({ 'fact.crime.qualification': 'п. «в» ч. 2 ст. 158 УК РФ' });
  for (const f of core.PHASE1_FORMS) {
    const memo = core.buildMemo(ix, c, f);
    assert.deepEqual(memo.rows.map((r) => r.id), ix.forms.get(f).requisites.map((r) => r.id), `ф. ${f}`);
  }
});

test('A1-3: у каждой строки со значением указан источник', () => {
  const c = newCase({ 'fact.crime.qualification': 'ч. 3 ст. 30, п. «а» ч. 3 ст. 158, ч. 1 ст. 159 УК РФ', 'fact.crime.crime_date': '2026-03-01',
    'fact.case.case_number': '12600000001000123', 'fact.victims.victims_count': '1' });
  for (const f of core.PHASE1_FORMS) {
    const memo = core.buildMemo(ix, c, f);
    const bad = memo.rows.filter((r) => (r.display || (Array.isArray(r.value) ? r.value.length : r.value)) && !r.source);
    assert.equal(bad.length, 0, `ф. ${f}: ${bad.map((b) => b.number).join(', ')}`);
  }
});

test('A1-4: реквизиты ИЦ отделены и не заполняются следователем', () => {
  const memo = core.buildMemo(ix, newCase(), '1');
  const ic = memo.rows.filter((r) => r.fills_by === 'ic');
  assert.deepEqual(ic.map((r) => r.number), ['6', '7']);
  assert.ok(ic.every((r) => r.status === 'fills_ic' && r.value === null));
});

test('Квалификация: разбор, стадия, категория на дату', () => {
  const q = core.parseQualification('ч. 3 ст. 30, пп. «а», «в» ч. 2 ст. 158 УК РФ');
  assert.equal(q.stage, 2);
  assert.deepEqual(q.main[0], { article: '158', parts: ['2'], points: ['а', 'в'] });
  const cat = (text, date = '2026-01-15') => core.mostSevere(ix.uk, core.parseQualification(text), date).category;
  assert.equal(cat('ч. 1 ст. 105 УК РФ'), 'especially_grave');
  assert.equal(cat('ч. 1 ст. 158 УК РФ'), 'small');
  assert.equal(cat('ч. 2 ст. 291 УК РФ'), 'medium');
  assert.equal(cat('ч. 2 ст. 178 УК РФ', '2025-01-10'), 'medium');
  assert.equal(cat('ч. 2 ст. 178 УК РФ', '2020-01-10'), 'grave');
  assert.equal(cat('ч. 1 ст. 158, ч. 4 ст. 111 УК РФ'), 'especially_grave');
});

test('Строки квалификации ф. 2 р. 21.1–21.3 – по убыванию тяжести', () => {
  const memo = core.buildMemo(ix, newCase({ 'fact.crime.qualification': 'ч. 1 ст. 158, ч. 4 ст. 111 УК РФ' }), '2');
  const get = (n) => memo.rows.find((r) => r.number === n);
  assert.match(get('21.1').display, /ст\. 111/);
  assert.match(get('21.2').display, /ст\. 158/);
  assert.equal(get('21.3').status, 'not_applicable');
});

// A1-5: каждая проверка – отрицательный (срабатывает) и положительный (не срабатывает) случай
const CHECK_CASES = {
  'c.attempt_vs_art30': [
    ['2', { 'fact.crime.qualification': 'ч. 1 ст. 158 УК РФ', 'fact.crime.attempt': ['|1'] }],
    ['2', { 'fact.crime.qualification': 'ч. 1 ст. 30, ч. 1 ст. 158 УК РФ', 'fact.crime.attempt': ['|1'] }],
  ],
  'c.art30_vs_attempt': [
    ['1', { 'fact.crime.qualification': 'ч. 3 ст. 30, ч. 1 ст. 158 УК РФ', 'fact.crime.attempt': null }],
    ['1', { 'fact.crime.qualification': 'ч. 3 ст. 30, ч. 1 ст. 158 УК РФ' }],
  ],
  'c.category_vs_uk': [
    ['1', { 'fact.crime.qualification': 'ч. 1 ст. 158 УК РФ', 'fact.crime.category': ['|1'] }],
    ['1', { 'fact.crime.qualification': 'ч. 1 ст. 158 УК РФ', 'fact.crime.category': ['|2'] }],
  ],
  'c.f11_r13_code8': [
    ['1.1', { 'fact.crime.qualification': 'ч. 1 ст. 158 УК РФ', 'fact.crime.intoxication': ['|08'] }],
    ['1.1', { 'fact.crime.qualification': 'ч. 1 ст. 264.1 УК РФ', 'fact.crime.intoxication': ['|08'] }],
  ],
  'c.f1_r9_prosecutor': [
    ['1', { 'fact.case.report_source': ['|prosecutor_materials'], [factOf('1', '9')]: ['|000105'] }],
    ['1', { 'fact.case.report_source': ['|prosecutor_materials'], [factOf('1', '9')]: ['|000125'] }],
  ],
  'c.minors_extra_char': [
    ['1', { 'fact.crime.qualification': 'ч. 1 ст. 106 УК РФ', 'fact.crime.extra_char': ['|004'] }],
    ['1', { 'fact.crime.qualification': 'ч. 1 ст. 106 УК РФ', 'fact.crime.extra_char': ['|134'] }],
  ],
  'c.vud_after_report': [
    ['1', { 'fact.case.vud_date': '2026-05-01', 'fact.case.kusp_date': '2026-05-03' }],
    ['1', { 'fact.case.vud_date': '2026-05-05', 'fact.case.kusp_date': '2026-05-03' }],
  ],
  'c.f3_extension_date': [
    ['3', { [factOf('3', '9.1')]: '2026-06-10', [factOf('3', '10')]: '2026-06-01' }],
    ['3', { [factOf('3', '9.1')]: '2026-06-10', [factOf('3', '10')]: '2026-09-10' }],
  ],
  'c.classifier_code_valid': [
    ['1', { 'fact.crime.method': ['|999'] }],
    ['1', { 'fact.crime.method': ['|010'] }],
  ],
  'c.enum_code_valid': [
    ['1', { 'fact.crime.ownership': ['|99'] }],
    ['1', { 'fact.crime.ownership': ['|03'] }],
  ],
  'c.no_victims_characteristics': [
    ['1', { 'fact.victims.victims_count': '0', 'fact.victims.social_status': ['|0016'] }],
    ['1', { 'fact.victims.victims_count': '1', 'fact.victims.social_status': ['|0016'] }],
  ],
  'c.f1_r40_required': [
    ['1', {}],
    ['1', { [factOf('1', '40')]: ['|0001'] }],
  ],
  'c.itt_method_required': [
    ['1', { 'fact.crime.qualification': 'ч. 1 ст. 272 УК РФ', 'fact.crime.method': ['|010'] }],
    ['1', { 'fact.crime.qualification': 'ч. 1 ст. 272 УК РФ', 'fact.crime.method': ['|057'] }],
  ],
  'c.mkb_method_required': [
    ['1', { 'fact.crime.qualification': 'ч. 1 ст. 105 УК РФ', 'fact.crime.method': ['|010'] }],
    ['1', { 'fact.crime.qualification': 'ч. 1 ст. 105 УК РФ', 'fact.crime.method': ['|105'] }],
  ],
  'c.svo_extra_char': [
    ['1', { 'fact.victims.victims_count': '1', 'fact.victims.social_status': ['|0054'] }],
    ['1', { 'fact.victims.victims_count': '1', 'fact.victims.social_status': ['|0054'], 'fact.crime.extra_char': ['|062'] }],
  ],
  'c.foreign_victim_regime': [
    ['1', { 'fact.victims.victims_count': '1', 'fact.victims.citizenship': ['|831'] }],
    ['1', { 'fact.victims.victims_count': '1', 'fact.victims.citizenship': ['|831'], 'fact.victims.social_status': ['|0041'] }],
  ],
  'c.art322_arrival_purpose': [
    ['2', { 'fact.crime.qualification': 'ч. 1 ст. 322 УК РФ', 'fact.person.arrival_purpose': ['|01'] }],
    ['2', { 'fact.crime.qualification': 'ч. 1 ст. 322 УК РФ', 'fact.person.arrival_purpose': ['|14'] }],
  ],
  'c.select_limits': [
    ['1', { 'fact.crime.ownership': ['|01', '|02', '|03', '|07'] }],
    ['1', { 'fact.crime.ownership': ['|01', '|10'] }],
  ],
  'c.fabula_length': [
    ['1', { 'fact.crime.fabula': 'а'.repeat(451) }],
    ['1', { 'fact.crime.fabula': 'а'.repeat(450) }],
  ],
  'c.case_number_17': [
    ['1', { 'fact.case.case_number': '1240230000104' }],
    ['1', { 'fact.case.case_number': '12402300001000045' }],
  ],
  'c.victims_count_vs_f5': [
    ['1', { 'fact.victims.victims_count': '2' }, ['1']],
    ['1', { 'fact.victims.victims_count': '2' }, ['1', '5']],
  ],
};

for (const chk of pack.rules.checks.filter((x) => x.scope !== 'package')) {
  test(`A1-5: проверка ${chk.id}`, () => {
    if (chk.id === 'c.ic_fields_empty') {
      const c = newCase();
      const memo = core.buildMemo(ix, c, '1');
      assert.equal(failed(memo, chk.id), false, 'в памятке реквизиты ИЦ пусты');
      const rows = memo.rows.map((r) => (r.fills_by === 'ic' ? { ...r, status: 'fill', value: '2026-01-01' } : r));
      const res = core.runChecks(ix, c, '1', rows, core.deriveAll(ix, c));
      assert.ok(res.some((x) => x.id === chk.id), 'заполненный реквизит ИЦ обнаружен');
      return;
    }
    const cases = CHECK_CASES[chk.id];
    assert.ok(cases, `нет тестового случая для ${chk.id}`);
    const [[fBad, aBad, formsBad = []], [fOk, aOk, formsOk = []]] = cases;
    assert.equal(failed(core.buildMemo(ix, newCase(aBad, formsBad), fBad), chk.id), true, 'должна сработать');
    assert.equal(failed(core.buildMemo(ix, newCase(aOk, formsOk), fOk), chk.id), false, 'не должна сработать');
  });
}

test('A1-7: поиск по справочникам – верный результат в первых трех в 9 из 10', () => {
  const Q = [
    [2, '700000', '700000'], [2, 'жилой', '700000'], [2, 'метрополтен', '060000'],
    [12, '082', '082'], [12, 'перевозка', '012'], [12, 'хранене', '011'],
    [15, 'банкротство', '243'], [15, 'несовершеннолетних', '003'],
  ];
  if (hasPrivate) Q.push([17, '02300003', '02300003'], [17, 'Вилючинск', '02300003']);
  else Q.push([15, 'кредитование', '096'], [15, '131', '131']);
  let ok = 0;
  const miss = [];
  for (const [no, q, want] of Q) {
    const top = core.searchClassifier(ix.classifiers.get(no).entries, q, 3).map((e) => String(e.code));
    if (top.includes(want)) ok++; else miss.push(`№ ${no} «${q}» → ${top.join(', ')}`);
  }
  assert.ok(ok >= 9, `найдено ${ok} из 10; промахи: ${miss.join('; ')}`);
});

test('A1-11: в текстах интерфейса и ядра нет «ё» и «—»', () => {
  const files = [...fs.readdirSync(path.join(ROOT, 'src/core')).map((f) => `src/core/${f}`), ...fs.readdirSync(path.join(ROOT, 'src/ui')).map((f) => `src/ui/${f}`)];
  for (const f of files.filter((x) => fs.statSync(path.join(ROOT, x)).isFile() && !/\.png$/.test(x))) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/[\u0451\u0401\u2014]/.test(t), f);
  }
});

test('Наложение кодов: подсказка направленности по ч. 1 ст. 290 – 10 + 02 = 12', () => {
  const memo = core.buildMemo(ix, newCase({ 'fact.crime.qualification': 'ч. 1 ст. 290 УК РФ' }), '1');
  const r18 = memo.rows.find((r) => r.number === '18');
  assert.equal(r18.status, 'hint');
  assert.match(r18.display, /^12 = 10 .*\+ 02/);
});

test('Наложение кодов: р. 10.1 ф. 1 – 2000 + 0030 = 2030, конфликт разрядов запрещен', () => {
  const r = ix.reqs.get('1').get('10.1');
  assert.equal(r.input.select, 'overlay');
  assert.equal(core.composeOverlay(['2000', '0030']), '2030');
  assert.equal(core.selectionProblem(r, ['2000', '0030']), null);
  assert.ok(core.selectionProblem(r, ['1000', '2000']));
  assert.ok(core.selectionProblem(r, ['0030', '0031']));
});

test('Число кодов ограничено полями бланка', () => {
  assert.equal(ix.reqs.get('1').get('26').input.max_codes, 6);
  assert.equal(ix.reqs.get('1').get('33').input.select, 'multiple');
  assert.equal(ix.reqs.get('1').get('20').input.select, 'single');
  assert.equal(ix.reqs.get('1').get('9').input.select, 'overlay');
});

test('Дополнительные поля: сумма взятки в р. 25 ф. 1 попадает в памятку', () => {
  const c = newCase({ [factOf('1', '25')]: ['|5'] });
  core.setFill(c, '1', '25', 1, '150000');
  core.setFill(c, '1', '25', 0, '999');
  const row = core.buildMemo(ix, c, '1').rows.find((r) => r.number === '25');
  assert.match(row.display, /Сумма взятки, подкупа, незаконного вознаграждения: 150000 руб\./);
  assert.doesNotMatch(row.display, /999/, 'сумма для кода 4 не показывается, если выбран код 5');
});

test('Нет потерпевших – характеристики потерпевших неактивны', () => {
  const c = newCase({ 'fact.victims.victims_count': '0' });
  const q = core.questionsForForm(ix, c, '1').find((x) => x.factId === 'fact.victims.social_status');
  assert.ok(q.disabled, 'вопрос неактивен');
  const row = core.buildMemo(ix, c, '1').rows.find((r) => r.number === '34');
  assert.equal(row.status, 'disabled');
});

test('Подсказки кодов по статье: ИТТ и несовершеннолетние', () => {
  const c = newCase({ 'fact.crime.qualification': 'ч. 2 ст. 159 УК РФ' });
  const m = core.buildMemo(ix, newCase({ 'fact.crime.qualification': 'ч. 1 ст. 272 УК РФ' }), '1');
  assert.ok(m.rows.find((r) => r.number === '26').suggest.some((h) => h.id === 'h.itt_method'));
  const m2 = core.buildMemo(ix, newCase({ 'fact.crime.qualification': 'ст. 106 УК РФ' }), '1');
  assert.ok(m2.rows.find((r) => r.number === '27').suggest.some((h) => h.id === 'h.minors_extra'));
  assert.equal(core.buildMemo(ix, c, '1').rows.find((r) => r.number === '27').suggest.length, 0);
});

test('Поиск по неполному номеру кода: окончание и часть', () => {
  const s14 = ix.classifiers.get(14).entries;
  const byEnd = core.searchClassifier(s14, '006', 30).map((e) => e.code);
  assert.ok(byEnd.includes('000006'), byEnd.join(', '));
  assert.ok(byEnd.every((c) => c.includes('006')));
  const s2 = ix.classifiers.get(2).entries;
  assert.ok(core.searchClassifier(s2, '597', 5).some((e) => e.code === '000597'));
});

test('Иерархия справочника № 14: у кодов ФСБ видно, следователь это или оперативный сотрудник', () => {
  const e = ix.clsCode.get(14).get('000083');
  assert.match(core.entryPath(e), /следователь/);
  assert.equal(ix.clsCode.get(14).get('000032')?.active, false);
});

test('ОКАТО: поиск по неполному коду и названию для р. 19.1 ф. 1', () => {
  const ok = ix.classifiers.get('okato');
  assert.ok(ok, 'ОКАТО загружен');
  assert.equal(ix.reqs.get('1').get('19.1').input.lookup, 'okato');
  assert.ok(core.searchClassifier(ok.entries, '30207', 5).some((e) => e.name.includes('Елизовский')));
  assert.ok(core.searchClassifier(ok.entries, 'Елизов', 5).length >= 1);
  const c = newCase({ 'fact.crime.okato': ['|30401000000'] });
  assert.match(core.buildMemo(ix, c, '1').rows.find((r) => r.number === '19.1').display, /30401000000 – .*Петропавловск-Камчатский/);
});

test('Опросник формы: общие сведения о деле – только те, что нужны выбранной форме', () => {
  const core1 = (f) => core.questionsForForm(ix, newCase(), f).filter((x) => x.q.core).map((x) => x.factId);
  assert.deepEqual(core1('1.1'), ['fact.crime.qualification', 'fact.case.case_number']);
  assert.ok(!core1('1.1').includes('fact.case.kusp'), 'номер КРСП (р. 5 ф. 1) не спрашивается в ф. 1.1');
  assert.ok(core1('1').includes('fact.case.kusp') && core1('1').includes('fact.case.report_source'));
  const q = core.questionsForForm(ix, newCase(), '1.1').find((x) => x.factId === 'fact.crime.qualification');
  assert.deepEqual(q.requisites.map((r) => r.number), ['7']);
});

test('Наименования реквизитов сверены с бланком: без вариантов кодов, подписей и обрезков', () => {
  const lbl = (f, id) => core.displayLabel(ix.reqs.get(f).get(id));
  assert.equal(lbl('1.1', '33'), 'Уголовное дело расследовано (разрешен материал)');
  assert.equal(lbl('1.1', '33.1'), 'Решение принято судьей');
  assert.equal(ix.reqs.get('1.1').has('28.1~2'), false);
  assert.equal(ix.reqs.get('1.1').get('33.1').options[0].value, 'судьей');
  for (const f of core.PHASE1_FORMS) {
    for (const r of ix.forms.get(f).requisites) {
      const l = core.displayLabel(r);
      assert.doesNotMatch(l, /Дата передачи карточки|подпись|_{2,}|…$|\(\d{2,6}\)/, `ф. ${f} р. ${r.id}: ${l}`);
      for (const o of r.options) assert.doesNotMatch(o.value, /^(руб\.|кг|ед\.)|[А-Я]{4,} [А-Я]{4,}/, `ф. ${f} р. ${r.id} код ${o.code}: ${o.value}`);
    }
  }
});
