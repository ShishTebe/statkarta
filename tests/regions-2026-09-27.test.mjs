// Автотесты региональных пакетов (27.09.2026, ответ В-77, документ 24): формат пакетов, местные коды
// в реквизитах «кем расследовано», ОКАТО региона, строка местных кодов в бланках, мастер пакета.
// Запуск: node --test tests/regions-2026-09-27.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importCore } from '../scripts/bundle.mjs';
import { loadPack } from '../scripts/load-pack.mjs';

const core = await importCore();
const pack = loadPack();
const index = pack.regions;
const readRegion = (code) => JSON.parse(fs.readFileSync(`data/regions/2026/${code}.json`, 'utf8'));
const optionCodes = (p, form, number) => p.forms.find((f) => f.form === form).requisites.find((r) => r.number === number).options.map((o) => o.code);

test('пакеты регионов: перечень и файлы согласованы, форматы верны, Камчатский край встроен', () => {
  assert.ok(index.regions.length >= 85);
  for (const r of index.regions) {
    const rp = readRegion(r.code);
    assert.deepEqual(core.regionPackProblems(rp, index), [], `регион ${r.code}`);
    assert.equal(rp.okato.count, r.okato);
  }
  assert.deepEqual(Object.keys(pack.region_packs), ['30']);
  assert.equal(index.regions.find((r) => r.code === '30').status, 'verified');
  assert.equal(index.targets.length, 7);
});

test('общие данные без местных кодов; пакет 30 добавляет их после 0001 во всех семи реквизитах', () => {
  const rp30 = core.regionalPack(pack, pack.region_packs['30']);
  for (const t of index.targets) {
    const base = optionCodes(pack, t.form, t.requisite);
    assert.ok(!base.includes('0018'), `ф. ${t.form} р. ${t.requisite}: в общих данных нет 0018`);
    const codes = optionCodes(rp30, t.form, t.requisite);
    assert.deepEqual(codes.slice(codes.indexOf('0001'), codes.indexOf('0001') + 4), ['0001', '0018', '0017', '0019'], `ф. ${t.form} р. ${t.requisite}`);
  }
  const f3 = rp30.forms.find((f) => f.form === '3').requisites.find((r) => r.number === '15').options.find((o) => o.code === '0018');
  assert.match(f3.value, /СО по ОВД СУ СК Камчатского края/, 'в ф. 3 – наименование по ее бланку');
  assert.ok(!optionCodes(pack, '1', '40').includes('0018'), 'исходный пакет не меняется');
  assert.equal(rp30.region.code, '30');
});

test('ОКАТО – из пакета региона: у другого региона свой ОКАТО и нет местных кодов', () => {
  const rp08 = readRegion('08');
  const p08 = core.regionalPack(pack, rp08);
  const ok = p08.classifiers.okato;
  assert.ok(ok.entries.length > 100 && ok.entries.every((e) => e.code.startsWith('08')));
  const ix = core.indexPack(p08);
  assert.ok(core.searchClassifier(ix.classifiers.get('okato').entries, 'Хабаровск', 5).length >= 1);
  const child = ok.entries.find((e) => !e.code.endsWith('000000'));
  assert.equal(child.path[0], rp08.name, 'путь начинается с региона');
  assert.ok(!optionCodes(p08, '1', '40').includes('0018'));
  assert.equal(pack.classifiers.okato, undefined);
});

test('проверка файла пакета: чужие коды ОКАТО, неверный код подразделения, другой формат', () => {
  const rp = readRegion('08');
  assert.deepEqual(core.regionPackProblems({ ...rp, okato: { ...rp.okato, rows: [...rp.okato.rows, ['30000000000', 'Камчатский край']] } }, index).length, 1);
  assert.match(core.regionPackProblems({ ...rp, unit_codes: [{ code: '18', value: 'СУ' }] }, index)[0], /4 цифр/);
  assert.match(core.regionPackProblems({ ...rp, schema: 'x' }, index)[0], /формат/);
  assert.deepEqual(core.regionPackProblems(null), ['файл не является пакетом региона']);
});

test('строка местных кодов в бланке: у региона 30 – как есть, у другого – своя строка или убирается', () => {
  assert.deepEqual(core.regionBlankEdits(index, '1', pack.region_packs['30']), []);
  const line = 'в т.ч. СУ СК по вымышленному краю (0018)';
  const eds = core.regionBlankEdits(index, '3', { region: '08', blank_line: { '*': line } });
  assert.equal(eds.length, 2);
  assert.ok(eds.every((e) => e.replace === line));
  assert.ok(core.regionBlankEdits(index, '6', { region: '08' }).length === 0, 'в ф. 6 строки нет');
  // разбитый на прогоны текст и запятая после строки
  const xml = '<w:p><w:r><w:t>органов СК (0001), в т.ч. СУ </w:t></w:r><w:r><w:t>СК края (0018), органов МВД</w:t></w:r></w:p>';
  const out = core.replaceBlankText(xml, 'в т.ч. СУ СК края (0018)', '');
  assert.equal(out.replace(/<[^>]+>/g, ''), 'органов СК (0001), органов МВД');
  assert.equal(core.replaceBlankText(xml, 'нет такого', 'x'), null);
});

test('заполненные бланки для другого региона: камчатской строки нет ни в Word, ни в Excel', async () => {
  const rp = { region: '08', name: 'Хабаровский край', blank_line: { '*': 'в т.ч. СУ СК по вымышленному краю (0018)' } };
  for (const [form, file] of [['1', 'forma-1.json'], ['2.1', 'forma-2-1.json'], ['3', 'forma-3.json']]) {
    const layout = JSON.parse(fs.readFileSync(`data/layout/2026/${file}`, 'utf8'));
    const bytes = new Uint8Array(fs.readFileSync(`data/blanks/2026/${layout.blank}`));
    const out = await core.fillDocx(bytes, layout, [], [], { textEdits: core.regionBlankEdits(index, form, rp) });
    const part = layout.kind === 'xlsx' ? 'xl/sharedStrings.xml' : 'word/document.xml';
    const text = (await core.entryText(core.readZip(out).find((e) => e.name === part))).replace(/<[^>]+>/g, '');
    assert.doesNotMatch(text, /Камчатского края \(0018\)|Елизово СУ СК/, `ф. ${form}`);
    assert.match(text, /вымышленному краю \(0018\)/, `ф. ${form}`);
    const same = await core.fillDocx(bytes, layout, [], [], { textEdits: core.regionBlankEdits(index, form, pack.region_packs['30']) });
    const text30 = (await core.entryText(core.readZip(same).find((e) => e.name === part))).replace(/<[^>]+>/g, '');
    assert.match(text30, /Камчатского края \(0018\)/, `ф. ${form}: для региона 30 бланк как есть`);
  }
});

test('мастер пакета: предложение в замечании, разбор сценарием и заготовка для regions-2026.json', () => {
  const region = { code: '08', name: 'Хабаровский край', unit_codes: [{ code: '0018', value: 'в т.ч. СУ СК по вымышленному краю' }, { code: 'abc', value: 'x' }], blank_line: 'в т.ч. СУ СК по вымышленному краю (0018)', source: 'бланк ИЦ (пример)' };
  const e = core.createFeedback({ kind: 'addition', today: '2026-09-27', fields: { what: core.regionProposalText(core.regionProposal(region)) }, region });
  assert.equal(e.region.unit_codes.length, 1, 'код не из 4 цифр отброшен');
  assert.equal(core.createFeedback({ kind: 'addition', fields: { what: 'x' }, region: { code: 'x' } }).region, undefined);
  const md = core.feedbackMarkdown([e], { app: '0.10.0' }, { today: '2026-09-27' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-'));
  const f = path.join(dir, 'p.md');
  fs.writeFileSync(f, md);
  assert.match(execFileSync('node', ['scripts/feedback/intake.mjs', f], { encoding: 'utf8' }), /## Предложения по региональным пакетам[\s\S]*0018 – в т\.ч\. СУ СК по вымышленному краю/);
  const snippet = JSON.parse(execFileSync('node', ['scripts/feedback/intake.mjs', f, '--regions-json'], { encoding: 'utf8' }));
  assert.deepEqual(snippet.regions['08'].unit_codes, [{ code: '0018', value: 'в т.ч. СУ СК по вымышленному краю' }]);
  assert.equal(snippet.regions['08'].blank_line['*'], region.blank_line);
  fs.rmSync(dir, { recursive: true, force: true });
});
