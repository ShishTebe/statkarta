// Проверка карт раскладки бланков (Фаза 1.6, критерии A1.6-3, A1.6-4, A1.6-6).
// Сверяет карты раскладки с пакетом форм и с эталонными бланками:
//  – у каждого реквизита, который заполняет следователь или руководитель, есть место в бланке;
//  – каждое место карты привязано к реквизиту формы;
//  – число клеток в группе совпадает с разрядностью кода по бланку (input.code_digits);
//  – контрольная сумма бланка совпадает с той, по которой составлена карта.
//
// Запуск: node scripts/check-layout.mjs [--quiet]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson } from './lib-data.mjs';
import { sha256Hex } from '../src/core/zip.mjs';

const LAYOUT_DIR = path.join(ROOT, 'data/layout/2026');
const BLANK_DIR = path.join(ROOT, 'data/blanks/2026');
const FILE_NAME = { '1': 'forma-1', '1.1': 'forma-1-1', '2': 'forma-2', '2.1': 'forma-2-1', '3': 'forma-3',
  '4': 'forma-4', '5': 'forma-5', '6': 'forma-6', ipk: 'forma-ipk', 'ipk-in': 'forma-ipk-in' };
const BY_INVESTIGATOR = new Set(['investigator', 'head']);

if (!fs.existsSync(LAYOUT_DIR)) {
  console.log('Карт раскладки нет – проверка пропущена (пакет бланков собирается локально).');
  process.exit(0);
}

const quiet = process.argv.includes('--quiet');
let errors = 0;
let warnings = 0;
const report = [];

for (const file of fs.readdirSync(LAYOUT_DIR).filter((f) => f.endsWith('.json')).sort()) {
  const layout = JSON.parse(fs.readFileSync(path.join(LAYOUT_DIR, file), 'utf8'));
  const form = readJson(`data/forms/2026/${FILE_NAME[layout.form]}.json`);
  const byId = new Map(form.requisites.map((r) => [r.id, r]));
  const mapped = new Set(layout.fields.map((f) => f.requisite));
  const bytes = fs.readFileSync(path.join(BLANK_DIR, layout.blank));
  const sha = await sha256Hex(new Uint8Array(bytes));
  const lines = [];
  if (layout.blank_sha256 && sha !== layout.blank_sha256) {
    lines.push(`ОШИБКА: бланк ${layout.blank} изменился – контрольная сумма не совпадает с картой`);
    errors += 1;
  }
  const missing = form.requisites.filter((r) => BY_INVESTIGATOR.has(r.fills_by) && !mapped.has(r.id));
  // служебные места бланка (строки подписи «sign.*», вид карты ИПК «variant») реквизитами формы не являются
  const extra = layout.fields.filter((f) => !byId.has(f.requisite) && !f.requisite.startsWith('sign.') && f.requisite !== 'variant');
  const owner = new Map();
  for (const f of layout.fields) {
    for (const s of f.groups.flat()) {
      if (owner.has(s) && owner.get(s) !== f.requisite) {
        lines.push(`ОШИБКА: фигура ${s} отнесена и к р. ${owner.get(s)}, и к р. ${f.requisite}`);
        errors += 1;
      }
      owner.set(s, f.requisite);
    }
  }
  if (missing.length) {
    lines.push(`нет места в бланке (${missing.length}): ${missing.map((r) => r.number).join(', ')}`);
    warnings += missing.length;
  }
  if (extra.length) {
    lines.push(`место есть, а реквизита в пакете формы нет (${extra.length}): ${extra.map((f) => f.requisite).join(', ')}`);
    warnings += extra.length;
  }
  const sizeProblems = [];
  for (const field of layout.fields) {
    const r = byId.get(field.requisite);
    if (!r || !BY_INVESTIGATOR.has(r.fills_by)) continue;
    // разрядность – по кодам вариантов бланка, если они есть (в пакете формы она местами указана неточно)
    const lens = [...new Set((r.options ?? []).map((o) => String(o.code).length))];
    const digits = lens.length === 1 ? lens[0] : r.input?.code_digits ?? null;
    if (!digits) continue;
    const codeGroups = field.parts ? field.parts.filter((p) => p.role === 'code').flatMap((p) => p.groups) : field.groups;
    if (!codeGroups.length) continue;
    const bad = codeGroups.filter((g) => g.length !== digits);
    if (bad.length === codeGroups.length) {
      sizeProblems.push(`${r.number}: клеток ${codeGroups.map((g) => g.length).join('+')}, а код ${digits}-значный`);
    }
  }
  if (sizeProblems.length) {
    lines.push(`разрядность не сходится (${sizeProblems.length}): ${sizeProblems.join('; ')}`);
    warnings += sizeProblems.length;
  }
  report.push({ form: layout.form, status: layout.map_status, fields: layout.fields.length,
    cells: layout.fields.reduce((n, f) => n + f.groups.reduce((m, g) => m + g.length, 0), 0), lines });
}

for (const r of report) {
  if (!quiet || r.lines.length) {
    console.log(`форма ${r.form} (${r.status}): реквизитов ${r.fields}, мест ${r.cells}`);
    for (const l of r.lines) console.log(`   ${l}`);
  }
}
console.log(`итого: карт ${report.length}, ошибок ${errors}, замечаний ${warnings}`);
process.exit(errors ? 1 : 0);
