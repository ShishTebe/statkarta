// Автотесты по замечанию от 09.11.2026: кнопку «Сохранить профиль» закрывала панель Dock.
// Запуск: node --test tests/remarks-2026-11-09.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/ui/app.mjs', 'utf8');
const css = fs.readFileSync('src/ui/styles.css', 'utf8');
const profile = app.slice(app.indexOf('function profileView()'), app.indexOf('// Время ЧЧ:ММ'));

test('профиль: «Сохранить профиль» есть вверху экрана, до панели региона', () => {
  const top = profile.indexOf("class: 'toolbar save-bar'");
  assert.ok(top > 0, 'верхняя строка сохранения');
  assert.ok(top < profile.indexOf('regionPanel()'), 'стоит до панели региона');
  assert.equal(profile.match(/'Сохранить профиль'\)/g)?.length, 2, 'кнопка вверху и внизу');
  assert.ok(profile.includes('for (const s of statuses)'), 'отметка о несохраненных изменениях – в обеих строках состояния');
});

test('запас снизу экрана: последние кнопки прокручиваются выше панели Dock', () => {
  const main = /^main \{[^}]*\}/m.exec(css)?.[0] ?? '';
  assert.match(main, /padding: 1rem 1rem calc\(1rem \+ \d+vh\)/);
  assert.match(css, /@media print \{[\s\S]*?main \{ max-width: none; padding: 0; \}/, 'в печати запаса нет');
});

test('вкладка открывает другой экран сверху', () => {
  assert.ok(/const other = state\.view !== id;[^\n]*if \(other\) scrollTo\(0, 0\)/.test(app));
});
