// Автотесты канала обратной связи (26.09.2026, документ 23): проверка текста на сведения дела,
// партия замечаний файлом и ее разбор, заготовка заявки, сведения о браузере.
// Все имена и номера – вымышленные. Запуск: node --test tests/feedback-2026-09-26.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importCore } from '../scripts/bundle.mjs';

const core = await importCore();

function caseWithData() {
  const c = core.createCase2({ title: 'Дело Зайцева', today: '2026-09-26' });
  core.addObject(c, 'crime');
  core.addObject(c, 'person', { label: 'Зайцев Олег Игоревич', crimes: ['crime.1'] });
  core.addObject(c, 'victim', { label: 'Лисицына', crimes: ['crime.1'] });
  c.case.facts['fact.case.fabula'] = [{ status: 'answered', value: 'Неустановленное лицо, находясь у дома 7 на улице Цветочной в поселке Вымышленном, тайно похитило велосипед стоимостью 23456 рублей' }];
  return c;
}
const PROFILE = { investigator_fio: 'К.К. Кротов', organ_name: 'Тестовый отдел' };

test('проверка текста: номер дела, почта, телефон, Ф.И.О. с отчеством – стоп без открытого дела', () => {
  const found = core.feedbackScan('Дело 12300000000000000, почта test@example.org, тел. 8 (900) 000-00-00, обвиняемый Орлов Павел Андреевич');
  const blocks = found.filter((x) => x.level === 'block').map((x) => x.why);
  assert.equal(blocks.length, 4);
  assert.ok(blocks.some((w) => /номер/.test(w)) && blocks.some((w) => /почт/.test(w)) && blocks.some((w) => /телефон/.test(w)) && blocks.some((w) => /отчество/.test(w)));
});

test('проверка текста: обычное замечание по реквизиту проходит без находок', () => {
  const c = caseWithData();
  const tokens = core.feedbackTokens([c], PROFILE, new Set(['дело', 'неустановленное']));
  assert.deepEqual(core.feedbackScan('В ф. 1 р. 19 не предлагается код 0018 при квалификации по ч. 1 ст. 158 УК РФ', tokens), []);
});

test('проверка текста: фамилии, числа и фабула открытого дела, фамилия из профиля', () => {
  const c = caseWithData();
  const tokens = core.feedbackTokens([c], PROFILE, new Set(['дело', 'неустановленное']));
  const lvl = (s) => core.feedbackScan(s, tokens).map((x) => x.level);
  assert.ok(lvl('Для Зайцев не выбирается код').includes('block'), 'фамилия лица из объекта дела');
  assert.ok(lvl('потерпевшая Лисицына').includes('block'), 'подпись потерпевшего');
  assert.ok(lvl('ошибка у Кротов').includes('block'), 'фамилия из профиля');
  assert.ok(lvl('сумма 23456 не переносится').includes('block'), 'число из текста дела');
  assert.ok(lvl('Зайцеву не выбирается код').includes('warn'), 'падежная форма фамилии – предупреждение');
  assert.ok(lvl('в поселке Вымышленном').includes('warn'), 'слово с прописной из фабулы');
  assert.ok(core.feedbackScan('пример: на улице Цветочной в поселке и так далее', tokens).some((x) => /фабул/.test(x.why)), 'пятерка слов фабулы');
});

test('замечание: место в программе – только белый список, пустые поля отбрасываются', () => {
  const e = core.createFeedback({ kind: 'error', source: 'ic', today: '2026-09-26',
    where: { screen: 'Опросник', form: '1', requisites: ['19'], codes: ['0018'], label: 'Зайцев', objectLabel: 'x' }, fields: { shown: ' Нет кода ', expected: '', basis: 'Разъяснение, п. 5', extra: 'y' } });
  assert.deepEqual(Object.keys(e.where).sort(), ['codes', 'form', 'requisites', 'screen']);
  assert.deepEqual(e.fields, { shown: 'Нет кода', basis: 'Разъяснение, п. 5' });
  assert.equal(e.source, 'ic');
  assert.equal(core.createFeedback({ kind: 'нет такого' }).kind, 'error');
});

test('партия файлом: читаемый текст по канону и обратный разбор; сценарий приема', () => {
  const env = { app: '0.8.0', data: '2026.3.6-draft', kind: 'web', browser: 'Chrome 128, macOS' };
  const list = [
    core.createFeedback({ kind: 'error', today: '2026-09-26', where: { screen: 'Опросник', form: '1', requisites: ['19'], requisiteLabel: 'Квалификация' }, fields: { shown: 'Нет кода', expected: 'Код 0018\n\nна второй строке', basis: 'Разъяснение, п. 5' } }),
    core.createFeedback({ kind: 'addition', source: 'prosecutor', today: '2026-09-26', fields: { what: 'Коды региона 41', basis: 'Приказ (пример)' } }),
  ];
  const md = core.feedbackMarkdown(list, env, { today: '2026-09-26' });
  assert.match(md, /^# Замечания к СтатКарте/);
  assert.match(md, /Выгружено 26\.09\.2026/);
  assert.match(md, /## З-2\. Дополнение/);
  assert.match(md, /- Где: экран «Опросник»; ф\. 1; р\. 19 – «Квалификация»/);
  assert.doesNotMatch(md, new RegExp(`[${String.fromCharCode(0x451, 0x401, 0x2014)}]`));
  const back = core.parseFeedbackFile(md);
  assert.equal(back.length, 2);
  assert.equal(back[0].fields.expected, 'Код 0018\n\nна второй строке');
  assert.equal(back[1].source, 'prosecutor');
  assert.deepEqual(back[0].where.requisites, ['19']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-'));
  const f = path.join(dir, 'partiya.md');
  fs.writeFileSync(f, md);
  const out = execFileSync('node', ['scripts/feedback/intake.mjs', f], { encoding: 'utf8' });
  assert.match(out, /Замечаний: 2; отметок ревизии: 0; остановлено проверкой: 0/);
  fs.writeFileSync(f, md.replace('Нет кода', 'Дело 12300000000000000'));
  assert.throws(() => execFileSync('node', ['scripts/feedback/intake.mjs', f], { encoding: 'utf8', stdio: 'pipe' }), 'сведения дела останавливают прием');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('заготовка заявки на GitHub: метки, заголовок с формой и реквизитом, предел длины', () => {
  const e = core.createFeedback({ kind: 'error', today: '2026-09-26', where: { form: '1', requisites: ['19'] }, fields: { shown: 'Нет кода 0018' } });
  const url = core.feedbackIssueUrl('https://github.com/example/repo', e, { app: '0.8.0' });
  const u = new URL(url);
  assert.equal(u.pathname, '/example/repo/issues/new');
  assert.equal(u.searchParams.get('labels'), 'ошибка,из программы');
  assert.equal(u.searchParams.get('title'), 'Ошибка: ф. 1, р. 19 – Нет кода 0018');
  assert.match(u.searchParams.get('body'), /statkarta-feedback/);
  const long = core.createFeedback({ kind: 'idea', fields: { what: 'а'.repeat(3900) } });
  assert.equal(core.feedbackIssueUrl('https://github.com/example/repo', long, {}), null, 'слишком длинная заявка – только файлом');
});

test('сведения о браузере: название, основная версия и система, без всей строки агента', () => {
  assert.equal(core.browserName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15'), 'Safari 18, macOS');
  assert.equal(core.browserName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0'), 'Edge 128, Windows');
  assert.equal(core.browserName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', { brave: true }), 'Brave 128, macOS');
});
