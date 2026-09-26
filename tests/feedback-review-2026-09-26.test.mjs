// Автотесты ответов В-71 – В-75 (26.09.2026, документ 23): письмо с партией (адрес не хранится в открытом виде),
// ревизия правил в программе, «Что нового» по журналу изменений. Адреса и имена – вымышленные.
// Запуск: node --test tests/feedback-review-2026-09-26.test.mjs
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
const ADDR = 'test@example.org';

test('адрес для писем: в сборке закодирован, раскодируется без потерь', () => {
  const enc = core.feedbackAddrEncode(ADDR);
  assert.ok(Array.isArray(enc) && enc.length === ADDR.length);
  assert.doesNotMatch(JSON.stringify(enc), /@|example/);
  assert.equal(core.feedbackAddrDecode(enc), ADDR);
  assert.equal(core.feedbackAddrDecode(null), '');
});

test('письмо: короткая партия – в тексте письма, длинная – вложением', () => {
  const short = core.feedbackMailto(ADDR, '# Замечания\n\nкоротко', { today: '2026-09-26' });
  assert.ok(short.fits);
  assert.match(short.href, /^mailto:test@example\.org\?subject=/);
  assert.match(decodeURIComponent(short.href), /СтатКарта: замечания от 26\.09\.2026/);
  assert.match(decodeURIComponent(short.href), /коротко/);
  const long = core.feedbackMailto(ADDR, 'а'.repeat(5000), { today: '2026-09-26' });
  assert.equal(long.fits, false);
  assert.match(decodeURIComponent(long.href), /statkarta-zamechaniya-2026-09-26\.md/);
});

test('ревизия: все правила пакета, номера не повторяются, подписи понятны', () => {
  const rules = core.reviewRules(pack);
  const r = pack.rules;
  const events = pack.events.events;
  const expected = r.mapping.length + r.checks.length + r.derived.length + r.hints.length + r.availability.length + r.extract.length
    + events.reduce((a, e) => a + (e.cards?.length ?? 0) + (e.sets_facts?.length ?? 0), 0);
  assert.equal(rules.length, expected);
  assert.equal(new Set(rules.map((x) => x.id)).size, rules.length);
  assert.deepEqual([...new Set(rules.map((x) => x.group))].sort(), Object.keys(core.REVIEW_GROUPS).sort());
  const vud = rules.find((x) => x.id === 'ev.vud#card.1');
  assert.match(vud.title, /^Возбуждение уголовного дела: ф\. 1 – на каждый эпизод$/);
  assert.ok(rules.filter((x) => x.group === 'events').some((x) => /«Дело возбуждено» = «по факту»/.test(x.detail)), 'признак события – по наименованию и значению');
  assert.ok(rules.some((x) => /^Возбуждение уголовного дела: ИПК-ПР/.test(x.title)), 'ИПК – по обозначению бланка');
  assert.doesNotMatch(rules.map((x) => `${x.title} ${x.detail}`).join('\n'), new RegExp(`[${String.fromCharCode(0x451, 0x401, 0x2014)}]`));
});

test('ревизия: отметки, охват, раздел партии и обратный разбор', () => {
  const rules = core.reviewRules(pack);
  const marks = [
    core.createReviewMark({ rule: rules[0].id, verdict: 'ok', today: '2026-09-26', data: pack.version }),
    core.createReviewMark({ rule: rules[1].id, verdict: 'wrong', comment: 'Не нужна при возбуждении (пример) | с чертой', today: '2026-09-26', data: pack.version }),
    core.createReviewMark({ rule: 'нет.такого', verdict: 'странно', today: '2026-09-26' }),
  ];
  assert.equal(marks[2].verdict, 'unclear');
  const cov = core.reviewCoverage(rules, marks);
  assert.equal(cov.events.ok + cov.events.wrong, 2);
  assert.equal(Object.values(cov).reduce((a, g) => a + g.total, 0), rules.length);
  const env = { app: '0.9.0', data: pack.version, kind: 'web', browser: 'Chrome 128, macOS' };
  const note = core.createFeedback({ kind: 'idea', today: '2026-09-26', fields: { what: 'Темная тема' } });
  const md = core.feedbackMarkdown([note], env, { today: '2026-09-26', appendix: core.reviewMarkdown(marks, rules), reviewCount: marks.length });
  assert.match(md, /Замечаний: 1; отметок ревизии правил: 3\./);
  assert.match(md, /## Ревизия правил/);
  assert.match(md, /\| неверно \| Не нужна при возбуждении \(пример\) \/ с чертой \|/);
  assert.equal(core.parseFeedbackFile(md).length, 1, 'раздел ревизии не считается замечанием');
  const back = core.parseReviewFile(md);
  assert.equal(back.length, 3);
  assert.equal(back[1].comment, 'Не нужна при возбуждении (пример) | с чертой');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-'));
  const f = path.join(dir, 'partiya.md');
  fs.writeFileSync(f, md);
  const out = execFileSync('node', ['scripts/feedback/intake.mjs', f], { encoding: 'utf8' });
  assert.match(out, /## Ревизия правил/);
  assert.match(out, /нет\.такого \(нет в пакете\)/);
  assert.match(out, /Замечаний: 1; отметок ревизии: 3; остановлено проверкой: 0/);
  assert.match(out, new RegExp(`\\| ${note.id} \\|`), 'служебный номер замечания – для отметки «исправлено»');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('«Что нового»: разделы версий и номера исправленных замечаний (строка не выводится)', () => {
  const md = '# Журнал\n\n## Приложение 0.9.0, данные 2026.3.6-draft – 26.09.2026 (ответы)\n\n- Исправлено одно.\n- Замечания: fb-abc123, fb-def456.\n\n## Данные без версии приложения\n\n- пропуск\n\n## Приложение 0.8.0, данные 2026.3.6-draft – 26.09.2026\n\n- Другое.\n';
  const news = core.changelogNews(md);
  assert.deepEqual(news.map((n) => n.app), ['0.9.0', '0.8.0']);
  assert.deepEqual(news[0].fixed, ['fb-abc123', 'fb-def456']);
  assert.doesNotMatch(news[0].body, /Замечания:/);
  assert.equal(core.changelogNews(fs.readFileSync('docs/CHANGELOG.md', 'utf8'), 3).length, 3);
});
