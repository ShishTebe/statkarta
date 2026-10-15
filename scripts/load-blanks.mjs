// Пакет бланков для однофайловой сборки (Фаза 1.6).
// Бланки (без образцов и свойств файла) и карты раскладки публикуются по решению заказчика
// от 20.09.2026 (ответ В-44) и входят в обе сборки.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib-data.mjs';

const DIR = 'data/blanks/2026';
const LAYOUT = 'data/layout/2026';

export function loadBlanks() {
  const dir = path.join(ROOT, DIR);
  const layoutDir = path.join(ROOT, LAYOUT);
  if (!fs.existsSync(dir) || !fs.existsSync(layoutDir)) return null;
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'blanks.json'), 'utf8'));
  const layouts = {};
  for (const name of fs.readdirSync(layoutDir).filter((f) => f.endsWith('.json'))) {
    const layout = JSON.parse(fs.readFileSync(path.join(layoutDir, name), 'utf8'));
    layouts[layout.form] = layout;
  }
  // координаты мест бланка на странице PDF – для чтения заполненной карточки из PDF (16.10.2026)
  const pdf = {};
  const pdfDir = path.join(layoutDir, 'pdf');
  if (fs.existsSync(pdfDir)) {
    for (const name of fs.readdirSync(pdfDir).filter((f) => f.endsWith('.json'))) {
      const pos = JSON.parse(fs.readFileSync(path.join(pdfDir, name), 'utf8'));
      if (layouts[pos.form]?.blank_sha256 === pos.blank_sha256) pdf[pos.form] = pos;
    }
  }
  const files = {};
  for (const b of manifest.blanks) {
    if (!layouts[b.form]) continue;
    files[b.file] = fs.readFileSync(path.join(dir, b.file)).toString('base64');
  }
  return { version: manifest.version, built: manifest.built, blanks: manifest.blanks, layouts, files, pdf };
}
