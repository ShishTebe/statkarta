// Автотесты Фазы 2 «Документы» (критерии A2-1, A2-2, A2-4, A2-6).
// Набор – tests/fixtures/vud (вымышленные постановления, `node scripts/fixtures/make-vud-corpus.mjs`).
// Запуск: node --test tests/phase2.test.mjs; таблица точности – STATKARTA_REPORT=1.
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
const RULES = PACK.rules.extract;
const DIR = path.join(ROOT, 'tests/fixtures/vud');
const golds = fs.readdirSync(DIR).filter((f) => f.endsWith('.gold.json')).sort().map((f) => readJson(path.join('tests/fixtures/vud', f)));
const others = fs.readdirSync(DIR).filter((f) => f.startsWith('other-'));

async function run(file) {
  const { text } = await core.fileText(file, new Uint8Array(fs.readFileSync(path.join(DIR, file))));
  return core.extractVud(text, RULES);
}

const qualKey = (q) => core.parseQualification(q).refs.map((r) => `${r.article}/${r.parts.join(',')}/${r.points.join(',')}`).join(';');
const fieldOf = (res, rule) => res.fields.find((f) => f.rule === rule) ?? null;

// Поля A2-2: имя поля эталона → как взять найденное значение
const FIELDS = {
  case_number: { tier: 95, get: (r) => fieldOf(r, 'x.vud.case_number') },
  vud_date: { tier: 95, get: (r) => fieldOf(r, 'x.vud.date') },
  kusp_number: { tier: 95, gold: 'kusp', get: (r) => fieldOf(r, 'x.vud.kusp') },
  qualification: { tier: 95, gold: 'qualifications', get: (r) => (r.episodes.length ? { value: r.episodes.map((e) => qualKey(e.qualification)), confidence: r.episodes[0].confidence } : null), eq: (v, g) => JSON.stringify(v) === JSON.stringify(g) },
  investigator_fio: { tier: 95, gold: 'investigator', get: (r) => fieldOf(r, 'x.vud.investigator') },
  crime_datetime: { tier: 80, gold: 'crime_date', get: (r) => fieldOf(r, 'x.vud.crime_date') },
  crime_place_text: { tier: 80, gold: 'crime_place', get: (r) => fieldOf(r, 'x.vud.crime_place') },
  damage_amount: { tier: 80, get: (r) => fieldOf(r, 'x.vud.damage') },
  kusp_date: { tier: 95, get: (r) => fieldOf(r, 'x.vud.kusp_date') },
  report_source: { tier: 80, get: (r) => fieldOf(r, 'x.vud.report_source'), eq: (v, g) => JSON.stringify(v) === JSON.stringify(g === null ? null : [`|${g}`]) },
  person: { tier: 80, gold: 'persons', get: (r) => ({ value: r.episodes.map((e) => e.person).filter(Boolean).map((p) => `${p.names.surname} ${p.names.first_name} ${p.names.patronymic} ${p.birth}`)[0] ?? null, confidence: 'medium' }),
    eq: (v, g) => (g.length ? v === `${g[0].surname} ${g[0].first_name} ${g[0].patronymic} ${g[0].birth}` : v === null) },
};

// Верно: значение совпало с эталоном; если в документе поля нет – программа ничего не нашла.
// Ложная высокоуверенная находка: уверенность «высокая», а значение неверно.
async function measure() {
  const stat = Object.fromEntries(Object.keys(FIELDS).map((k) => [k, { ok: 0, n: 0, falseHigh: 0, miss: [] }]));
  let findings = 0;
  let falseHigh = 0;
  let maxMs = 0;
  for (const g of golds) {
    const res = await run(g.file);
    maxMs = Math.max(maxMs, res.ms);
    for (const [k, spec] of Object.entries(FIELDS)) {
      const gold = g[spec.gold ?? k];
      const got = spec.get(res);
      const value = got?.value ?? null;
      const ok = spec.eq ? spec.eq(value, gold) : (gold === null ? value === null : value === gold);
      const s = stat[k];
      s.n++;
      if (ok) s.ok++; else s.miss.push(`${g.file}: найдено ${JSON.stringify(value)}, эталон ${JSON.stringify(gold)}`);
      if (got && value !== null) {
        findings++;
        if (!ok && got.confidence === 'high') { s.falseHigh++; falseHigh++; }
      }
    }
  }
  return { stat, findings, falseHigh, maxMs };
}

const M = await measure();

if (process.env.STATKARTA_REPORT) {
  console.log('| Поле | Верно | Порог |');
  for (const [k, s] of Object.entries(M.stat)) console.log(`| ${k} | ${s.ok} из ${s.n} (${Math.round((s.ok * 100) / s.n)} %) | ${FIELDS[k].tier} % |`);
  console.log(`ложных высокоуверенных: ${M.falseHigh} из ${M.findings}; наибольшее время: ${M.maxMs} мс`);
  for (const [k, s] of Object.entries(M.stat)) for (const m of s.miss) console.log(`  ${k}: ${m}`);
}

test('A2-1: .docx, .txt (UTF-8 и Windows-1251) и вставка дают один и тот же текст', async () => {
  const kinds = new Set(golds.map((g) => g.format));
  assert.deepEqual([...kinds].sort(), ['docx', 'txt', 'txt1251']);
  for (const g of golds) {
    const res = await run(g.file);
    assert.ok(res.ok, `${g.file}: ${res.reason}`);
    assert.ok(res.parts.found.established && res.parts.found.decided, `${g.file}: части не выделены`);
  }
  const { text } = await core.fileText('x.txt', new Uint8Array(fs.readFileSync(path.join(DIR, golds[1].file))));
  const pasted = core.extractVud(text, RULES);
  assert.equal(fieldOf(pasted, 'x.vud.date').value, golds[1].vud_date);
});

test('A2-1: .doc, .rtf и .pdf – понятное сообщение, а не сбой', async () => {
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  await assert.rejects(() => core.fileText('a.doc', ole), /\.docx/);
  await assert.rejects(() => core.fileText('a.rtf', new TextEncoder().encode('{\\rtf1 x}')), /Фаза 3/);
  await assert.rejects(() => core.fileText('a.pdf', new TextEncoder().encode('%PDF-1.4')), /Фаза 3/);
});

test('документы другого вида не принимаются за постановление о ВУД', async () => {
  for (const f of others) assert.equal((await run(f)).ok, false, f);
});

test('A2-2: точность извлечения на тестовом наборе не ниже порогов', () => {
  assert.ok(golds.length >= 20, 'в наборе не менее 20 постановлений');
  for (const [k, s] of Object.entries(M.stat)) {
    const pct = (s.ok * 100) / s.n;
    assert.ok(pct >= FIELDS[k].tier, `${k}: ${s.ok} из ${s.n} (${pct.toFixed(0)} %) ниже ${FIELDS[k].tier} %\n${s.miss.join('\n')}`);
  }
  assert.ok(M.falseHigh / M.findings <= 0.02, `ложных высокоуверенных ${M.falseHigh} из ${M.findings}`);
});

test('A2-6: разбор постановления быстрее 2 секунд', () => {
  assert.ok(M.maxMs < 2000, `${M.maxMs} мс`);
});

test('A2-2: номер дела не из 17 цифр – низкая уверенность', () => {
  const res = core.extractVud('ПОСТАНОВЛЕНИЕ\nо возбуждении уголовного дела № 1260000000000109\nг. Энск\t01.02.2026\nСледователь отдела, рассмотрев сообщение,\nУСТАНОВИЛ:\nТекст.\nПОСТАНОВИЛ:\nВозбудить уголовное дело по признакам преступления, предусмотренного ч. 1 ст. 158 УК РФ.', RULES);
  const f = fieldOf(res, 'x.vud.case_number');
  assert.equal(f.confidence, 'low');
  assert.match(f.note, /16 цифр/);
});

test('лицо: именительный падеж из анкеты, иначе по окончаниям с отметкой', () => {
  assert.deepEqual(core.genitiveToNominative(['Чернобая', 'Андрея', 'Геннадьевича']), { surname: 'Чернобай', first_name: 'Андрей', patronymic: 'Геннадьевич' });
  assert.deepEqual(core.genitiveToNominative(['Карпина', 'Михаила', 'Павловича']), { surname: 'Карпин', first_name: 'Михаил', patronymic: 'Павлович' });
  assert.equal(core.genitiveToNominative(['Орлова', 'Павла', 'Ильича']).first_name, 'Павел');
  assert.deepEqual(core.genitiveToNominative(['Ивановой', 'Марии', 'Петровны']), { surname: 'Иванова', first_name: 'Мария', patronymic: 'Петровна' });
});

test('В-41: потерпевшие – подсказка с именительным падежом, без ложных находок', async () => {
  let ok = 0;
  let n = 0;
  for (const g of golds) {
    const res = await run(g.file);
    const got = res.victims.map((v) => `${v.names.surname} ${v.names.first_name} ${v.names.patronymic}`);
    const want = g.victims.map((v) => `${v.surname} ${v.first_name} ${v.patronymic}`);
    if (!want.length) { assert.deepEqual(got, [], `${g.file}: лишний потерпевший`); continue; }
    n++;
    if (JSON.stringify(got) === JSON.stringify(want)) ok++;
    assert.ok(res.victims.every((v) => v.confidence === 'low'));
  }
  assert.ok(n >= 6, 'в наборе есть потерпевшие');
  assert.equal(ok, n);
  assert.deepEqual(core.dativeToNominative(['Полянскому', 'Григорию', 'Львовичу']), { surname: 'Полянский', first_name: 'Григорий', patronymic: 'Львович' });
});

test('FR-09, A2-4: переносится только подтвержденное; ручные сведения не затираются', async () => {
  const g = golds.find((x) => x.persons.length && x.qualifications.length === 1 && x.kusp);
  const res = await run(g.file);
  const c = core.createCase2({ today: '2026-09-20' });
  core.addObject(c, 'crime'); // пустой эпизод нового дела
  core.setFactVersion(c, c.case, 'fact.case.kusp', 'answered', 'вручную', null);
  const dec = core.defaultDecisions(res);
  const kuspKey = fieldOf(res, 'x.vud.kusp').key;
  const dateKey = fieldOf(res, 'x.vud.kusp_date').key;
  dec.fields[dateKey].accept = false; // не подтверждено
  const conflicts = core.importConflicts(c, res, dec);
  assert.deepEqual(conflicts.map((x) => x.field), ['fact.case.kusp']);
  const log = core.importVud(IX, c, res, dec);
  assert.equal(core.factAt(c, c.case, 'fact.case.kusp').value, 'вручную');
  assert.ok(log.kept.includes('fact.case.kusp'));
  assert.equal(core.factAt(c, c.case, 'fact.case.kusp_date'), null, 'неподтвержденное поле в дело не попало');
  assert.equal(c.crimes.length, 1);
  assert.equal(c.persons.length, 1);
  assert.equal(core.factAt(c, c.persons[0], 'fact.person.surname').value, g.persons[0].surname);
  const ev = c.events.find((e) => e.type === 'ev.vud');
  assert.equal(ev.date, g.vud_date);
  assert.equal(ev.attrs.vud_mode, 'person');
  assert.ok(ev.cards.length > 0, 'пакет карточек ВУД составлен');
  assert.equal(c.victims.length, 0, 'потерпевший без отметки не переносится');
  // замена по выбору следователя
  dec.replace['fact.case.kusp'] = true;
  core.importVud(IX, c, res, dec);
  assert.equal(core.factAt(c, c.case, 'fact.case.kusp').value, g.kusp);
  assert.equal(c.crimes.length, 1, 'повторный перенос не создает эпизод заново');
  assert.equal(c.persons.length, 1);
  void dateKey; void kuspKey;
});
