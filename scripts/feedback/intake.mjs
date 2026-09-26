// Прием партии замечаний, выгруженной из программы (кнопка «Замечание» → «Сохранить файлом»).
//   node scripts/feedback/intake.mjs <файл.md> [<файл.md> ...] [--json] [--regions-json]
// --regions-json – предложения мастера регионального пакета в виде раздела "regions" для
// scripts/import/regions-2026.json (переносится после сверки с бланками информационного центра региона).
// Печатает таблицу разбора (Markdown) и повторно проверяет текст на сведения уголовных дел:
// при находках уровня «block» – код выхода 1, такой файл в репозиторий и заявки не переносится.
// Раздел «Ревизия правил» – сводка отметок и охват по видам правил текущего пакета данных.
// Служебный номер замечания (fb-…) вносится в docs/CHANGELOG.md строкой «- Замечания: fb-…» раздела версии,
// где оно исправлено: у автора в программе появится «исправлено в <версия>».
import fs from 'node:fs';
import path from 'node:path';
import { FEEDBACK_KINDS, FEEDBACK_SOURCES, parseFeedbackFile, feedbackScan, feedbackWhereText } from '../../src/core/feedback.mjs';
import { REVIEW_GROUPS, REVIEW_VERDICTS, parseReviewFile, reviewRules, reviewCoverage } from '../../src/core/review.mjs';
import { loadPack } from '../load-pack.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const regionsJson = args.includes('--regions-json');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('Укажите файл партии замечаний: node scripts/feedback/intake.mjs <файл.md>');
  process.exit(2);
}

const rows = [];
const marks = [];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const list = parseFeedbackFile(text);
  const rv = parseReviewFile(text).map((m) => ({ ...m, file: path.basename(f), found: feedbackScan(m.comment) }));
  marks.push(...rv);
  if (!list.length && !rv.length) console.error(`${path.basename(f)}: замечаний и отметок с отметкой программы не найдено`);
  list.forEach((e, i) => {
    const text = Object.values(e.fields ?? {}).join('\n');
    rows.push({ file: path.basename(f), n: i + 1, ...e, found: feedbackScan(text) });
  });
}

const proposals = rows.filter((r) => r.region);
if (regionsJson) {
  const out = {};
  for (const r of proposals) out[r.region.code] = { status: 'verified', unit_codes: r.region.unit_codes, blank_line: r.region.blank_line ? { '*': r.region.blank_line } : null, sources: [r.region.source].filter(Boolean) };
  console.log(JSON.stringify({ regions: out }, null, 1));
  process.exit(0);
}
const blocked = [...rows, ...marks].filter((r) => r.found.some((x) => x.level === 'block'));
const rules = reviewRules(loadPack());
const byId = new Map(rules.map((r) => [r.id, r]));
if (asJson) {
  console.log(JSON.stringify({ notes: rows, reviews: marks }, null, 1));
} else {
  const cell = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 110);
  console.log('| Файл | № | Номер | Вид | Метка | От кого | Где | Суть | Проверка текста |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const k = FEEDBACK_KINDS[r.kind] ?? FEEDBACK_KINDS.error;
    const gist = Object.values(r.fields ?? {})[0] ?? '';
    const check = r.found.length ? r.found.map((x) => `${x.level === 'block' ? 'СТОП' : 'проверить'}: ${x.why}`).join('; ') : 'чисто';
    console.log(`| ${cell(r.file)} | З-${r.n} | ${cell(r.id)} | ${cell(k.title)} | ${k.label} | ${cell(FEEDBACK_SOURCES[r.source] ?? '')} | ${cell(feedbackWhereText(r.where))} | ${cell(gist)} | ${cell(check)} |`);
  }
  if (proposals.length) {
    console.log('\n## Предложения по региональным пакетам\n');
    console.log('| Регион | Местные коды | Строка бланка | Источник |');
    console.log('|---|---|---|---|');
    for (const r of proposals) console.log(`| ${r.region.code} ${cell(r.region.name)} | ${cell(r.region.unit_codes.map((u) => `${u.code} – ${u.value}`).join('; ') || 'нет')} | ${cell(r.region.blank_line || 'нет')} | ${cell(r.region.source)} |`);
    console.log('\nПеренос в scripts/import/regions-2026.json: --regions-json, затем python3 scripts/import/build_regions.py.');
  }
  if (marks.length) {
    const last = new Map(marks.map((m) => [m.rule, m]));
    const cov = reviewCoverage(rules, [...last.values()]);
    console.log('\n## Ревизия правил\n');
    console.log('| Вид правил | Всего | Отмечено | Верно | Неверно | Уточнить |');
    console.log('|---|---|---|---|---|---|');
    for (const [g, t] of Object.entries(REVIEW_GROUPS)) { const c = cov[g] ?? { total: 0, ok: 0, wrong: 0, unclear: 0 }; console.log(`| ${t} | ${c.total} | ${c.ok + c.wrong + c.unclear} | ${c.ok} | ${c.wrong} | ${c.unclear} |`); }
    const todo = [...last.values()].filter((m) => m.verdict !== 'ok');
    if (todo.length) {
      console.log('\n| Правило | Оценка | Что проверено | Основание | Проверка текста |');
      console.log('|---|---|---|---|---|');
      for (const m of todo) console.log(`| ${cell(m.rule)}${byId.has(m.rule) ? '' : ' (нет в пакете)'} | ${REVIEW_VERDICTS[m.verdict] ?? m.verdict} | ${cell(byId.get(m.rule)?.title)} | ${cell(m.comment)} | ${m.found.length ? m.found.map((x) => `${x.level === 'block' ? 'СТОП' : 'проверить'}: ${x.why}`).join('; ') : 'чисто'} |`);
    }
  }
  console.log(`\nЗамечаний: ${rows.length}; отметок ревизии: ${marks.length}; остановлено проверкой: ${blocked.length}.`);
}
process.exit(blocked.length ? 1 : 0);
