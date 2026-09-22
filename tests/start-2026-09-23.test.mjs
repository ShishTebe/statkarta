// Автотесты к пересборке старта приложения (23.09.2026): карточки на основании выставленной – корректирующая и отменяющая.
// Запуск: node --test tests/start-2026-09-23.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { importCore } from '../scripts/bundle.mjs';
import { loadPack } from '../scripts/load-pack.mjs';

const core = await importCore();
const pack = loadPack();
const ix = core.indexPack(pack);
const PROFILE = { organ_name: 'Тестовый следственный отдел', organ_code: '02', unit_code: '02300003',
  investigator_position: 'следователь', investigator_rank: 'майор юстиции', investigator_fio: 'И.И. Иванов' };

function quickCase(form, variant = null, of = { crime: 'crime.1' }) {
  const c = core.createCase2({ title: 'Быстрый режим', today: '2026-09-23' });
  core.addObject(c, 'crime');
  core.addObject(c, 'person', { crimes: ['crime.1'] });
  core.addObject(c, 'victim', { crimes: ['crime.1'] });
  const ev = core.addEvent(c, { type: 'ev.manual', date: '2026-09-23', refs: { crimes: ['crime.1'], persons: ['person.1'], victims: ['victim.1'] } });
  const card = core.addCardManually(ix, c, ev, { form, variant, of });
  return { c, ev, card };
}

test('отменяющая карточка: режим «снять», код р. 2 по пакету событий, сведения скопированы', () => {
  const { c, ev, card } = quickCase('1.1');
  const item = core.packageQuestions(ix, c, ev, PROFILE).groups.flatMap((g) => g.items).find((x) => x.key === 'fact.crime.qualification@crime.1');
  core.setPackageAnswer(c, ev, item, 'answered', 'ч. 1 ст. 158 УК РФ');
  core.issueCard(ix, c, ev, card, PROFILE, { today: '2026-09-23' });
  const rm = core.createChangeCard(c, ev.id, card.key, 'remove');
  assert.equal(rm.mode, 'remove');
  assert.equal(rm.based_on, card.key);
  assert.match(rm.key, /#remove1$/);
  const memo = core.buildCardMemo(ix, c, ev, rm, PROFILE);
  assert.match(memo.rows.find((r) => r.number === '2').display, /^3 – снять/);
  assert.match(memo.cardTitle, /снять$/);
  const ch = core.createChangeCard(c, ev.id, card.key);
  assert.equal(ch.mode, 'change');
  assert.match(ch.key, /#change2$/, 'номер следующей карточки на основании той же выставленной');
  assert.deepEqual(core.changeProposals(ix, c, PROFILE), []);
});

test('режим «снять» есть не у каждой формы: ф. 1 – только «учесть» и «изменить», ИПК – «К» и «СУ»', () => {
  assert.equal(core.modeRequisite(ix, '1').codes.remove, undefined);
  assert.equal(core.modeRequisite(ix, '1.1').codes.remove, '3');
  assert.equal(core.modeRequisite(ix, 'ipk').codes.remove, 'СУ');
});

test('быстрый режим: одна карточка любой формы без события собирается и дает памятку', () => {
  const OF = { '1': { crime: 'crime.1' }, '1.1': { crime: 'crime.1' }, '2': { person: 'person.1' }, '2.1': { person: 'person.1' }, '3': {}, '4': {},
    '5': { victim: 'victim.1' }, '6': { person: 'person.1' }, 'ipk-in': { person: 'person.1' } };
  for (const [form, of] of Object.entries(OF)) {
    const { c, ev, card } = quickCase(form, null, of);
    const memo = core.buildCardMemo(ix, c, ev, card, PROFILE);
    assert.ok(memo.rows.length > 0, `ф. ${form}: памятка пуста`);
    assert.equal(core.activeCards(ev).length, 1, `ф. ${form}: в пакете одна карточка`);
  }
  for (const [variant, of] of [['pr', { crime: 'crime.1' }], ['lc', { person: 'person.1', crime: 'crime.1' }]]) {
    const { c, ev, card } = quickCase('ipk', variant, of);
    assert.ok(core.buildCardMemo(ix, c, ev, card, PROFILE).rows.length > 0, `ИПК ${variant}: памятка пуста`);
  }
});
