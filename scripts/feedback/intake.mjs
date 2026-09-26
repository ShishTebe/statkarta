// Прием партии замечаний, выгруженной из программы (кнопка «Замечание» → «Сохранить файлом»).
//   node scripts/feedback/intake.mjs <файл.md> [<файл.md> ...] [--json]
// Печатает таблицу разбора (Markdown) и повторно проверяет текст на сведения уголовных дел:
// при находках уровня «block» – код выхода 1, такой файл в репозиторий и заявки не переносится.
import fs from 'node:fs';
import path from 'node:path';
import { FEEDBACK_KINDS, FEEDBACK_SOURCES, parseFeedbackFile, feedbackScan, feedbackWhereText } from '../../src/core/feedback.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('Укажите файл партии замечаний: node scripts/feedback/intake.mjs <файл.md>');
  process.exit(2);
}

const rows = [];
for (const f of files) {
  const list = parseFeedbackFile(fs.readFileSync(f, 'utf8'));
  if (!list.length) console.error(`${path.basename(f)}: замечаний с отметкой программы не найдено`);
  list.forEach((e, i) => {
    const text = Object.values(e.fields ?? {}).join('\n');
    rows.push({ file: path.basename(f), n: i + 1, ...e, found: feedbackScan(text) });
  });
}

const blocked = rows.filter((r) => r.found.some((x) => x.level === 'block'));
if (asJson) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  const cell = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 110);
  console.log('| Файл | № | Вид | Метка | От кого | Где | Суть | Проверка текста |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const k = FEEDBACK_KINDS[r.kind] ?? FEEDBACK_KINDS.error;
    const gist = Object.values(r.fields ?? {})[0] ?? '';
    const check = r.found.length ? r.found.map((x) => `${x.level === 'block' ? 'СТОП' : 'проверить'}: ${x.why}`).join('; ') : 'чисто';
    console.log(`| ${cell(r.file)} | З-${r.n} | ${cell(k.title)} | ${k.label} | ${cell(FEEDBACK_SOURCES[r.source] ?? '')} | ${cell(feedbackWhereText(r.where))} | ${cell(gist)} | ${cell(check)} |`);
  }
  console.log(`\nВсего: ${rows.length}; остановлено проверкой: ${blocked.length}.`);
}
process.exit(blocked.length ? 1 : 0);
