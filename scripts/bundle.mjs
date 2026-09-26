// Склейка модулей ядра в один сценарий без import/export (для однофайловой сборки и тестов).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib-data.mjs';

export const CORE_ORDER = ['text.mjs', 'uk.mjs', 'classifiers.mjs', 'codes.mjs', 'pack.mjs', 'rules.mjs', 'engine.mjs', 'model.mjs', 'package.mjs', 'vault.mjs', 'zip.mjs', 'ooxml.mjs', 'xlsxfill.mjs', 'blank.mjs', 'docx.mjs', 'doctext.mjs', 'extract.mjs', 'docimport.mjs', 'feedback.mjs', 'review.mjs', 'regions.mjs'];

export function bundleSource(files) {
  return files.map((f) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
      .replace(/^import .*$/gm, '')
      .replace(/^export (function|const|let|class|async function) /gm, '$1 ');
    return `// ---- ${f} ----\n${src}`;
  }).join('\n');
}

export function coreBundle() {
  return bundleSource(CORE_ORDER.map((f) => `src/core/${f}`));
}

// Для тестов: собрать ядро в модуль и вернуть его экспорт
export async function importCore() {
  const names = new Set();
  for (const f of CORE_ORDER) {
    const src = fs.readFileSync(path.join(ROOT, 'src/core', f), 'utf8');
    for (const m of src.matchAll(/^export (?:async )?(?:function|const|let|class) ([A-Za-z0-9_]+)/gm)) names.add(m[1]);
  }
  const code = `${coreBundle()}\nexport { ${[...names].join(', ')} };\n`;
  // Имя свое у каждого процесса: тесты запускаются параллельно и затирали общий файл.
  const tmp = path.join(ROOT, `tests/.core-bundle-${process.pid}.mjs`);
  fs.writeFileSync(tmp, code);
  const mod = await import(`${tmp}?t=${Date.now()}`);
  fs.rmSync(tmp, { force: true });
  return mod;
}
