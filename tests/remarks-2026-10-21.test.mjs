// Автотесты по замечаниям от 21.10.2026: одна дата возбуждения в опроснике ф. 3, перенос прежнего
// ответа в сохраненных делах. Запуск: node --test tests/remarks-2026-10-21.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { importCore } from '../scripts/bundle.mjs';
import { loadPack } from '../scripts/load-pack.mjs';

const core = await importCore();
const ix = core.indexPack(loadPack());
const VUD = 'fact.case.vud_date';

test('ф. 3 р. 6 и карта на иностранца р. 26 берут общую дату возбуждения; отдельного сведения нет', () => {
  assert.equal(ix.mapping.get('3').get('6').value_from, VUD);
  assert.equal(ix.mapping.get('ipk-in').get('26').value_from, VUD);
  assert.equal(ix.facts.has('fact.case.vud_date.date'), false);
  const events = JSON.parse(fs.readFileSync('data/events/2026/events.json', 'utf8')).events;
  assert.ok(!JSON.stringify(events).includes('vud_date.date'));
});

test('опросник ф. 3: дата возбуждения спрашивается один раз и попадает в р. 6', () => {
  for (const type of ['ev.manual', 'ev.extend', 'ev.suspend']) {
    const c = core.createCase2({ today: '2026-10-21' });
    core.addObject(c, 'crime');
    core.addObject(c, 'person', { crimes: ['crime.1'] });
    const ev = core.addEvent(c, { type, date: '2026-10-21', refs: { crimes: ['crime.1'], persons: ['person.1'], victims: [] } });
    if (type !== 'ev.manual') { core.applyEventFacts(ix, c, ev); core.syncPackage(ix, c, ev); }
    const card = ev.cards.find((k) => k.form === '3') ?? core.addCardManually(ix, c, ev, { form: '3', of: {} });
    const items = core.packageQuestions(ix, c, ev, {}).groups.flatMap((g) => g.items).filter((it) => it.cards.includes(card.key));
    const vud = items.filter((it) => /vud_date/.test(it.factId) && !/opt/.test(it.factId));
    assert.equal(vud.length, 1, `${type}: ${vud.map((x) => x.factId).join(', ')}`);
    core.setPackageAnswer(c, ev, vud[0], 'answered', '2026-09-01');
    const memo = core.buildCardMemo(ix, c, ev, card, {});
    assert.equal(memo.rows.find((r) => r.id === '6').value, '2026-09-01', type);
  }
});

test('сохраненное дело: прежний ответ «дата возбуждения» ф. 3 переносится в общую дату', () => {
  const c = core.createCase2({ today: '2026-10-21' });
  c.case.facts['fact.case.vud_date.date'] = [{ event: null, status: 'answered', value: '2026-05-05' }];
  const m = core.migrateCase(JSON.parse(JSON.stringify(c)));
  assert.equal(core.factAt(m, m.case, VUD).value, '2026-05-05');
  assert.equal(m.case.facts['fact.case.vud_date.date'], undefined);
  // если общая дата уже внесена – она остается
  c.case.facts[VUD] = [{ event: null, status: 'answered', value: '2026-06-06' }];
  const m2 = core.migrateCase(JSON.parse(JSON.stringify(c)));
  assert.equal(core.factAt(m2, m2.case, VUD).value, '2026-06-06');
});

test('профиль: подсказки инициалов и фамилии в одном виде – «И.И. Иванов»', () => {
  const app = fs.readFileSync('src/ui/app.mjs', 'utf8');
  assert.ok(!/[А-Я][а-я]+ [А-Я]\.[А-Я]\./.test(app), 'нет вида «Иванов И.И.»');
  for (const ph of ['И.И. Иванов', 'П.П. Петров', 'С.С. Сидоров']) assert.ok(app.includes(`placeholder: '${ph}'`), ph);
});
