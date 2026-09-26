// Сборка приложения из ядра, интерфейса и пакетов данных.
//   node scripts/build-app.mjs                 → dist/statkarta-offline.html (однофайловая, публикуется в Releases)
//   node scripts/build-app.mjs --with-private  → dist-private/statkarta-offline-local.html (со справочником № 17, не публикуется)
//   node scripts/build-app.mjs --web           → dist-web/ (для GitHub Pages: работа без сети после первого открытия,
//                                                 установка как приложение в Chrome, Edge, Яндекс; телефоны не настраиваются – решение заказчика 20.09.2026)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson } from './lib-data.mjs';
import { loadPack } from './load-pack.mjs';
import { loadBlanks } from './load-blanks.mjs';
import { coreBundle, bundleSource } from './bundle.mjs';
import { feedbackAddrEncode, changelogNews } from '../src/core/feedback.mjs';

// Адрес публикации (ответ В-48): отсюда проверяются обновления (FR-21) по кнопке пользователя
export const PAGES_URL = 'https://shishtebe.github.io/statkarta/';
export const RELEASES_URL = 'https://github.com/ShishTebe/statkarta/releases/latest';
// Репозиторий: заготовки заявок из журнала замечаний (канал обратной связи, документ 23)
export const REPO_URL = 'https://github.com/ShishTebe/statkarta';

const withPrivate = process.argv.includes('--with-private');
const web = process.argv.includes('--web');
const kind = web ? 'web' : withPrivate ? 'local' : 'offline';
const pkg = readJson('package.json');
const pack = loadPack({ withPrivate });
// Адрес для писем с замечаниями (ответ В-71): не хранится в репозитории – берется из секрета сборки
// STATKARTA_FEEDBACK_TO (GitHub Actions) или из локального файла data-private/feedback-to.txt; в файле – закодированным
const feedbackTo = (process.env.STATKARTA_FEEDBACK_TO ?? (fs.existsSync(path.join(ROOT, 'data-private/feedback-to.txt'))
  ? fs.readFileSync(path.join(ROOT, 'data-private/feedback-to.txt'), 'utf8') : '')).trim();
const build = { app: pkg.version, data: pack.version, kind, built: new Date().toISOString().slice(0, 10), pages: PAGES_URL, releases: RELEASES_URL, repo: REPO_URL,
  ...(feedbackTo ? { fb_to: feedbackAddrEncode(feedbackTo) } : {}),
  // «Что нового» (ответ В-75): последние разделы журнала изменений и номера исправленных замечаний
  news: changelogNews(fs.readFileSync(path.join(ROOT, 'docs/CHANGELOG.md'), 'utf8')) };
const pagesOrigin = new URL(PAGES_URL).origin;
const CSP = {
  // однофайловая: ни одного внешнего адреса, кроме проверки обновлений по кнопке
  offline: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src ${pagesOrigin}; base-uri 'none'; form-action 'none'`,
  local: "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
  web: "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'",
}[kind];
const HEAD = web ? [
  '<link rel="manifest" href="manifest.webmanifest">',
  '<link rel="icon" href="icons/icon-192.png">',
  '<meta name="theme-color" content="#1f3a5f">',
].join('\n') : '';

const tpl = fs.readFileSync(path.join(ROOT, 'src/ui/index.html'), 'utf8');
const style = fs.readFileSync(path.join(ROOT, 'src/ui/styles.css'), 'utf8');
const script = `(() => {\n'use strict';\n${coreBundle()}\n${bundleSource(['src/ui/storage.mjs', 'src/ui/app.mjs'])}\n})();`;
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const html = tpl.replace('{{CSP}}', () => CSP).replace('{{HEAD}}', () => HEAD).replace('{{STYLE}}', () => style)
  .replace('{{BUILD}}', () => json(build)).replace('{{DATA}}', () => json(pack)).replace('{{BLANKS}}', () => json(loadBlanks() ?? null))
  .replace('{{SCRIPT}}', () => script.replace(/<\/script/gi, '<\\/script'));

const outDir = path.join(ROOT, web ? 'dist-web' : withPrivate ? 'dist-private' : 'dist');
if (web) fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, web ? 'index.html' : withPrivate ? 'statkarta-offline-local.html' : 'statkarta-offline.html');
fs.writeFileSync(out, html);

if (web) {
  // Сборка для Pages: значки, манифест, сервис-воркер (офлайн после первого открытия), сведения о версии для проверки обновлений
  fs.mkdirSync(path.join(outDir, 'icons'));
  for (const f of ['icon-192.png', 'icon-512.png']) fs.copyFileSync(path.join(ROOT, 'src/ui/icons', f), path.join(outDir, 'icons', f));
  fs.writeFileSync(path.join(outDir, 'manifest.webmanifest'), `${JSON.stringify({
    name: 'СтатКарта – помощник по статистическим карточкам', short_name: 'СтатКарта', lang: 'ru',
    start_url: './', scope: './', display: 'standalone', background_color: '#ffffff', theme_color: '#1f3a5f',
    icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
  }, null, 1)}\n`);
  const files = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
  const sw = fs.readFileSync(path.join(ROOT, 'src/ui/sw.js'), 'utf8')
    .replace('__CACHE__', `statkarta-${build.app}-${build.data}-${Date.now()}`).replace('__FILES__', JSON.stringify(files));
  fs.writeFileSync(path.join(outDir, 'sw.js'), sw);
  fs.copyFileSync(path.join(ROOT, 'dist/statkarta-offline.html'), path.join(outDir, 'statkarta-offline.html'));
  fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
}
// Сведения о версии – по ним приложение по кнопке проверяет, вышло ли обновление (FR-21)
if (web) fs.writeFileSync(path.join(outDir, 'version.json'), `${JSON.stringify({ app: build.app, data: build.data, built: build.built }, null, 1)}\n`);

const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(2);
console.log(`собрано: ${path.relative(ROOT, out)}, ${mb} МБ; письма с замечаниями: ${feedbackTo ? 'адрес задан' : 'адрес не задан'}`);
// Предел 8 МБ (NFR-06) относится к публикуемым сборкам; в локальной добавлен справочник № 17
const limit = withPrivate ? 12 : 8;
if (fs.statSync(out).size > limit * 1024 * 1024) { console.error(`превышен предел ${limit} МБ (NFR-06)`); process.exit(1); }
