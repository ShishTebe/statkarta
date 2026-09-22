// Автотесты по ревизии от 22.09.2026 (версия 0.6.4).
// Запуск: node --test tests/revision-2026-09-22.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importCore } from '../scripts/bundle.mjs';
import { loadPack } from '../scripts/load-pack.mjs';
import { ROOT } from '../scripts/lib-data.mjs';

const core = await importCore();
const pack = loadPack();

test('Заголовки форм: аббревиатуры ИПК и ЛБГ не переводятся в строчные буквы', () => {
  const titles = Object.fromEntries(pack.forms.map((f) => [f.form, core.sentenceCase(f.title)]));
  assert.equal(titles['ipk'], 'Информационно-поисковая карта (ИПК)');
  assert.match(titles['ipk-in'], /иностранными гражданами или ЛБГ,/);
  assert.equal(titles['1'], 'Статистическая карточка на выявленное преступление');
  for (const t of Object.values(titles)) assert.doesNotMatch(t, /\b(ипк|лбг)\b/);
});

test('sentenceCase: частые аббревиатуры справочников сохраняются, обычные слова – в строчные', () => {
  assert.equal(core.sentenceCase('ДТП С УЧАСТИЕМ СОТРУДНИКА ОМОН'), 'ДТП с участием сотрудника ОМОН');
  assert.equal(core.sentenceCase('ГБУЗ «БОЛЬНИЦА»'), 'ГБУЗ «больница»');
  assert.equal(core.sentenceCase('КАТЕГОРИЯ ПРЕСТУПЛЕНИЯ'), 'Категория преступления');
});

test('Шаблоны заявок репозитория есть и не просят сведений реальных дел', () => {
  const dir = path.join(ROOT, '.github/ISSUE_TEMPLATE');
  for (const name of ['oshibka.md', 'zayavka.md']) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.match(text, /^name: /m);
    assert.match(text, /реальн/);
    assert.doesNotMatch(text, /[ё—]/);
  }
});
