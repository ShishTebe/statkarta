// Автотесты Фазы 1.5 (критерии A1.5-1 – A1.5-5, A1.5-7 – A1.5-13). Запуск: node --test tests/phase15.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importCore } from '../scripts/bundle.mjs';
import { loadPack } from '../scripts/load-pack.mjs';
import { ROOT, readJson } from '../scripts/lib-data.mjs';

const core = await importCore();
const pack = loadPack({ withPrivate: fs.existsSync(path.join(ROOT, 'data-private/classifiers/2026/spr-17.json')) });
const ix = core.indexPack(pack);
const FX = readJson('tests/fixtures/case-package.json');
const GOLD = readJson('tests/golden/package/compositions.json').compositions;
const clone = (x) => JSON.parse(JSON.stringify(x));

function setBaseFacts(c, cont, facts) {
  for (const [fid, v] of Object.entries(facts ?? {})) core.setFactVersion(c, cont, fid, 'answered', v, null);
}

function baseCase(only = null) {
  const c = core.createCase2({ today: '2026-03-01' });
  setBaseFacts(c, c.case, FX.base.case.facts);
  for (const kind of ['crime', 'person', 'victim']) {
    for (const o of FX.base[core.OBJECT_KINDS[kind]]) {
      if (only && !only[core.OBJECT_KINDS[kind]].includes(o.id)) continue;
      const obj = core.addObject(c, kind, { id: o.id, label: o.label ?? '', attrs: o.attrs ?? {}, crimes: o.crimes ?? [] });
      setBaseFacts(c, obj, o.facts);
    }
  }
  c.damage.attrs = { ...FX.base.damage.attrs };
  setBaseFacts(c, c.damage, FX.base.damage.facts);
  return c;
}

function runEvent(c, e) {
  for (const v of e.add?.victims ?? []) core.addObject(c, 'victim', { id: v.id, attrs: v.attrs, crimes: v.crimes });
  const ev = core.addEvent(c, { type: e.type, date: e.date, attrs: e.attrs ?? {}, refs: e.refs ?? {} });
  core.applyEventFacts(ix, c, ev);
  core.syncPackage(ix, c, ev);
  return ev;
}

const norm = (cards) => cards.map((k) => `${k.form}${k.variant ? `:${k.variant}` : ''}|${['crime', 'person', 'victim'].map((x) => k.of[x] ?? '').join('|')}`).sort();

function chainCase() {
  const c = baseCase();
  const evs = {};
  for (const e of FX.chain) evs[e.id] = runEvent(c, e);
  return { c, evs };
}

test('A1.5-1: состав пакета по каждому событию цепочки эталонного дела совпадает с эталоном', () => {
  const { evs } = chainCase();
  for (const e of FX.chain) assert.deepEqual(norm(core.activeCards(evs[e.id])), norm(GOLD[e.id]), `событие ${e.id} (${e.type})`);
});

test('A1.5-1: ветки окончания и движения дела', () => {
  for (const b of FX.branches) {
    const { c } = chainCase();
    const ev = runEvent(c, b);
    if (b.type === 'ev.split') {
      const nc = core.spawnCase(ix, c, ev);
      assert.deepEqual(norm(core.activeCards(ev)), norm(GOLD[b.id].source_case), 'исходное дело');
      assert.deepEqual(norm(core.activeCards(nc.events[0])), norm(GOLD[b.id].new_case), 'выделенное дело');
      assert.equal(core.factAt(nc, nc.case, 'fact.case.case_number').value, b.attrs.new_case_number);
      assert.deepEqual(nc.crimes.map((x) => x.id), ['crime.2']);
    } else {
      assert.deepEqual(norm(core.activeCards(ev)), norm(GOLD[b.id]), `ветка ${b.id}`);
    }
  }
});

test('A1.5-1: отдельные сценарии – учетный отказ и ВУД в отношении лиц', () => {
  for (const s of FX.separate) {
    const c = baseCase(s.base);
    const ev = runEvent(c, s);
    assert.deepEqual(norm(core.activeCards(ev)), norm(GOLD[s.id]), s.id);
  }
});

test('A1.5-1, FR-37: финальные события и все события пакета задействованы в эталоне', () => {
  const used = new Set([...FX.chain, ...FX.branches, ...FX.separate].map((e) => e.type));
  assert.deepEqual([...used].sort(), pack.events.events.map((e) => e.id).sort());
  const { c } = chainCase();
  const fin = (type, attrs = {}) => core.isFinalEvent(ix, c, { type, attrs, date: '2026-07-01', refs: { crimes: [], persons: [], victims: [] } });
  assert.equal(fin('ev.to_court'), true);
  assert.equal(fin('ev.suspend'), false);
  assert.equal(fin('ev.join'), true);
  assert.equal(fin('ev.transfer', { deregister: true }), true);
  assert.equal(fin('ev.transfer', { deregister: false }), false);
});

test('A1.5-1: ручное добавление и удаление карточки помечены и переживают пересчет состава', () => {
  const { c, evs } = chainCase();
  const ev = evs.E1;
  const added = core.addCardManually(ix, c, ev, { form: '2.1', of: { person: 'person.1' } });
  assert.equal(added.origin, 'manual_add');
  const f5 = ev.cards.find((k) => k.form === '5');
  core.removeCardManually(ev, f5.key);
  core.syncPackage(ix, c, ev);
  assert.ok(ev.cards.find((k) => k.key === added.key), 'добавленная вручную осталась');
  assert.equal(ev.cards.find((k) => k.key === f5.key).removed, true, 'удаленная вручную помечена и не вернулась');
  assert.ok(!core.activeCards(ev).some((k) => k.key === f5.key));
});

// ---- общие заготовки: дело после направления в суд с заполненными сведениями ----
const PROFILE = { organ_name: 'Тестовый следственный отдел', organ_code: '02', unit_code: '02300003', prosecutor_code: '02300010',
  investigator_position: 'следователь', investigator_rank: 'лейтенант юстиции', investigator_fio: 'В.В.В.',
  head_position: 'руководитель отдела', head_fio: 'Г.Г.Г.', retention_months: 6 };
function courtCase() {
  const { c } = chainCase();
  const ev = runEvent(c, FX.branches.find((b) => b.id === 'B-court'));
  return { c, ev };
}

test('A1.5-2: опросник пакета не задает вопрос дважды, у каждого вопроса – карточки и реквизиты', () => {
  const { c, ev } = courtCase();
  const pq = core.packageQuestions(ix, c, ev, PROFILE);
  const items = pq.groups.flatMap((g) => g.items);
  const keys = items.map((x) => x.key);
  assert.equal(new Set(keys).size, keys.length, 'ключи «факт + экземпляр» уникальны');
  let perForm = 0;
  for (const card of core.activeCards(ev)) perForm += core.questionsForForm(ix, core.cardView(ix, c, ev, card, PROFILE), card.form).length;
  assert.ok(items.length < perForm, `вопросов пакета ${items.length} меньше суммы по карточкам ${perForm}`);
  // реквизит закрывается одним фактом; несколько вопросов одного факта допустимы только по разным эпизодам
  // (квалификация лица по двум эпизодам в ф. 2 собирается из обоих)
  const seen = new Map();
  for (const it of items) {
    assert.ok(it.cards.length > 0, `${it.key}: нет карточек`);
    for (const r of it.requisites) {
      const k = `${r.card}|${r.id}`;
      if (seen.has(k)) assert.equal(seen.get(k), it.factId, `реквизит ${k} закрывается разными фактами`);
      seen.set(k, it.factId);
    }
  }
  assert.ok(items.filter((x) => !x.q.core).every((x) => x.requisites.length > 0), 'у каждого вопроса по реквизиту перечислены реквизиты');
  const qual = items.filter((x) => x.factId === 'fact.crime.qualification');
  assert.deepEqual(qual.map((x) => x.inst).sort(), ['crime.1', 'crime.2'], 'квалификация спрашивается по каждому эпизоду один раз');
  assert.ok(qual[0].requisites.some((r) => r.form === '1.1') && qual[0].requisites.some((r) => r.form === 'ipk'));
  const order = pq.groups.map((g) => g.id.split('.')[0].split('|')[0]);
  assert.equal(order[0], 'case', 'группы: дело → эпизоды → лица → потерпевшие → карточки');
});

test('A1.5-3: у каждого перенесенного значения источник «перенос из ф. N, реквизит M»', () => {
  const { c, ev } = courtCase();
  const memos = core.buildPackageMemos(ix, c, ev, PROFILE);
  const transfers = core.packageTransfers(ix, c, ev);
  let n = 0;
  for (const [key, memo] of memos) {
    for (const row of memo.rows) {
      if (!transfers.get(key).has(row.id)) continue;
      const hasValue = Array.isArray(row.value) ? row.value.length : row.value;
      if (!hasValue) continue;
      n++;
      assert.match(row.source, /^Перенос из (ф\. [\d.]+|ИПК-ЛЦ|ИПК-ПР|карта на иностранца), реквизит \S+/, `${memo.cardTitle} р. ${row.number}`);
    }
  }
  assert.ok(n >= 10, `переносов со значением: ${n}`);
  const f2 = [...memos.values()].find((m) => m.memo !== null && m.cardTitle.startsWith('ф. 2: Лицо 1'));
  assert.match(f2.rows.find((r) => r.number === '1').source, /Перенос из ф\. 1\.1, реквизит 1 \(Профиль органа\)/);
});

test('A1.5-4: правка квалификации после отметки «выставлена» не меняет карточку и порождает «изменить»', () => {
  const { c, ev } = courtCase();
  const card = ev.cards.find((k) => k.form === '1.1' && k.of.crime === 'crime.1');
  const before = core.buildCardMemo(ix, c, ev, card, PROFILE);
  core.issueCard(ix, c, ev, card, PROFILE, { today: '2026-07-02' });
  const snap = JSON.stringify(card.issued);
  assert.deepEqual(core.changeProposals(ix, c, PROFILE), []);
  const item = core.packageQuestions(ix, c, ev, PROFILE).groups.flatMap((g) => g.items).find((x) => x.key === 'fact.crime.qualification@crime.1');
  core.setPackageAnswer(c, ev, item, 'answered', 'ч. 1 ст. 161 УК РФ');
  assert.equal(JSON.stringify(card.issued), snap, 'снимок выставленной карточки не изменился');
  assert.equal(card.issued.rows.find((r) => r.number === '7').display, before.rows.find((r) => r.number === '7').display);
  const pr = core.changeProposals(ix, c, PROFILE);
  assert.equal(pr.length, 1);
  assert.ok(pr[0].diff.some((d) => d.number === '7' && /161/.test(d.now)));
  const ch = core.createChangeCard(c, ev.id, card.key);
  assert.equal(ch.mode, 'change');
  const memo = core.buildCardMemo(ix, c, ev, ch, PROFILE);
  assert.match(memo.rows.find((r) => r.number === '2').display, /^2 – изменить/);
  assert.match(memo.rows.find((r) => r.number === '7').display, /161/);
  assert.deepEqual(core.changeProposals(ix, c, PROFILE), [], 'после создания карточки «изменить» предложение снято');
  const prevEvent = FX.chain.at(-1).id;
  assert.ok(prevEvent);
  assert.match(core.journalText(c), /выставлена: ф\. 1\.1 \(Эпизод 1\), режим «учесть»/);
  assert.doesNotMatch(core.journalText(c), /А\.А\.А\.|Б\.Б\.Б\./, 'в журнале нет сведений о лицах');
});

// A1.5-5: каждое правило пакета – случай, где срабатывает, и случай, где не срабатывает
const opt = (form, req, code) => [core.optKey(ix.reqs.get(form).get(req).options.find((o) => o.code === code))];
function setCardFact(c, ev, pred, fid, value) {
  const card = ev.cards.find(pred);
  core.setFactVersion(c, card, fid, 'answered', value, ev.id);
}
const PKG_CASES = {
  'c.pkg.f11_each_crime': {
    bad: () => { const { c, ev } = courtCase(); core.removeCardManually(ev, ev.cards.find((k) => k.form === '1.1' && k.of.crime === 'crime.2').key); return { c, ev }; },
    ok: courtCase,
  },
  'c.pkg.f2_each_person': {
    bad: () => { const { c, ev } = courtCase(); core.removeCardManually(ev, ev.cards.find((k) => k.form === '2' && k.of.person === 'person.2').key); return { c, ev }; },
    ok: courtCase,
  },
  'c.pkg.ipk_each_crime': {
    bad: () => { const { c, evs } = chainCase(); core.removeCardManually(evs.E1, evs.E1.cards.find((k) => k.form === 'ipk' && k.of.crime === 'crime.2').key); return { c, ev: evs.E1 }; },
    ok: () => { const { c, evs } = chainCase(); return { c, ev: evs.E1 }; },
  },
  'c.pkg.f5_vs_victims_count': {
    bad: () => { const { c, evs } = chainCase(); core.setFactVersion(c, core.getObject(c, 'crime.1'), 'fact.victims.victims_count', 'answered', '2', evs.E1.id); return { c, ev: evs.E1 }; },
    ok: () => { const { c, evs } = chainCase(); core.setFactVersion(c, core.getObject(c, 'crime.1'), 'fact.victims.victims_count', 'answered', '1', evs.E1.id); return { c, ev: evs.E1 }; },
  },
  'c.pkg.f4_vs_f11_damage': {
    bad: () => { const { c, ev } = courtCase(); setCardFact(c, ev, (k) => k.form === '4', 'fact.f4.r10', opt('4', '10', '01')); return { c, ev }; },
    ok: () => {
      const { c, ev } = courtCase();
      setCardFact(c, ev, (k) => k.form === '4', 'fact.f4.r10', opt('4', '10', '01'));
      setCardFact(c, ev, (k) => k.form === '1.1' && k.of.crime === 'crime.1', 'fact.f1_1.r28', opt('1.1', '28', '01'));
      return { c, ev };
    },
  },
  'c.pkg.f3_vs_f11_decision': {
    bad: () => { const { c, ev } = courtCase(); setCardFact(c, ev, (k) => k.form === '1.1' && k.of.crime === 'crime.1', 'fact.f1_1.r25', ['|100']); return { c, ev }; },
    ok: () => {
      const { c, ev } = courtCase();
      setCardFact(c, ev, (k) => k.form === '1.1' && k.of.crime === 'crime.1', 'fact.f1_1.r25', ['|100']);
      setCardFact(c, ev, (k) => k.form === '3', 'fact.f3.r13', opt('3', '13', '01'));
      return { c, ev };
    },
  },
  'c.pkg.event_after_vud': {
    bad: () => { const { c } = chainCase(); return { c, ev: runEvent(c, { type: 'ev.extend', date: '2026-02-15', refs: {} }) }; },
    ok: () => { const { c, evs } = chainCase(); return { c, ev: evs.E4 }; },
  },
};

for (const chk of pack.rules.checks.filter((x) => x.scope === 'package')) {
  test(`A1.5-5: проверка пакета ${chk.id}`, () => {
    const cs = PKG_CASES[chk.id];
    assert.ok(cs, `нет тестового случая для ${chk.id}`);
    const fired = ({ c, ev }) => core.runPackageChecks(ix, c, ev, core.buildPackageMemos(ix, c, ev, PROFILE)).some((x) => x.id === chk.id);
    assert.equal(fired(cs.bad()), true, 'должна сработать');
    assert.equal(fired(cs.ok()), false, 'не должна сработать');
  });
}

test('A1.5-7: профиль органа подставляется в реквизит «Орган» всех карточек пакета; в профиле нет сведений дела', () => {
  const { c, ev } = courtCase();
  const memos = core.buildPackageMemos(ix, c, ev, PROFILE);
  let n = 0;
  for (const memo of memos.values()) {
    for (const row of memo.rows) {
      const fid = ix.mapping.get(memo.form).get(row.id)?.value_from;
      if (fid === 'fact.case.organ') { n++; assert.match(row.display, /^02 – Следственного комитета/, memo.cardTitle); }
      if (fid === 'fact.case.organ_name') { n++; assert.equal(row.display, PROFILE.organ_name); }
    }
  }
  assert.ok(n >= memos.size - 2, `реквизитов органа заполнено: ${n}`);
  const numbered = [...memos.values()].filter((m) => m.rows.some((r) => ix.mapping.get(m.form).get(r.id)?.value_from === 'fact.case.case_number' && r.display === FX.base.case.facts['fact.case.case_number']));
  assert.ok(numbered.length >= 3, 'номер дела во всех карточках, где он заполняется следователем');
  const dirty = core.sanitizeProfile({ ...PROFILE, case_number: '123', persons: ['x'], qualification: 'ст. 158' });
  assert.deepEqual(Object.keys(dirty).sort(), Object.keys(PROFILE).sort());
});

test('A1.5-8: шифрование дела – пароль, неверный пароль, в записи нет открытых сведений', async () => {
  const { c } = courtCase();
  const rec = await core.encryptCase(c, 'пароль-для-теста', { deleteAfter: '2027-01-01', remindAt: '2026-12-18' });
  const text = JSON.stringify(rec);
  for (const s of ['12602300000000001', 'ст. 158', 'А.А.А.', 'crime.1', 'ev.to_court']) assert.ok(!text.includes(s), `в записи виден фрагмент ${s}`);
  assert.deepEqual(Object.keys(rec).sort(), ['cipher', 'ct', 'delete_after', 'format', 'id', 'kdf', 'remind_at', 'v']);
  assert.ok(rec.kdf.iterations >= 200000);
  assert.deepEqual(await core.decryptCase(rec, 'пароль-для-теста'), c);
  await assert.rejects(core.decryptCase(rec, 'неверный-пароль'), /Неверный пароль/);
  await assert.rejects(core.encryptCase(c, '123'), /не короче 8/);
});

test('A1.5-9: срок хранения – напоминание за 14 дней, удаление после срока, без финального события не удаляется', () => {
  const { c } = courtCase();
  const isFinal = (ev) => core.isFinalEvent(ix, c, ev);
  const at = (today) => core.retentionInfo(c, { months: 6, today, isFinal });
  assert.equal(at('2026-12-01').status, 'active');
  assert.equal(at('2026-12-18').status, 'remind');
  assert.equal(at('2027-01-01').status, 'expired');
  assert.equal(at('2027-01-01').deleteAfter, '2027-01-01');
  const { c: open } = chainCase();
  const info = (today) => core.retentionInfo(open, { months: 6, today, isFinal: (ev) => core.isFinalEvent(ix, open, ev) });
  assert.equal(info('2030-01-01').deleteAfter, null, 'дело без финального события не удаляется');
  assert.equal(info('2026-08-31').status, 'active');
  assert.equal(info('2026-09-01').status, 'ask_active', 'через 6 месяцев – «дело еще ведется?»');
  core.confirmActive(open, '2026-09-01');
  assert.equal(info('2026-09-02').status, 'active');
});

test('A1.5-10: файл дела схемы case/1 открывается с миграцией без потери данных', () => {
  const v1 = readJson('tests/fixtures/case-v1.json');
  const old = { answers: v1.answers, fills: v1.fills, forms: v1.forms, created: v1.created };
  const c = core.migrateCase(clone(old), { scopeOf: (fid) => core.scopeOf(ix, fid) });
  assert.equal(c.schema, 'case/2');
  const ev = c.events[0];
  for (const form of ['1', '2']) {
    const card = ev.cards.find((k) => k.form === form);
    assert.ok(card, `карточка ф. ${form}`);
    // р. 2 «Учесть, изменить, снять» в версии 1.5 заполняется режимом карточки – сравнивается отдельно
    const memoNow = core.buildCardMemo(ix, c, ev, card);
    const auto = new Set(memoNow.rows.filter((r) => r.source?.startsWith('Режим карточки')).map((r) => r.number));
    assert.deepEqual([...auto], ['2'], `ф. ${form}: режим карточки – только р. 2`);
    const was = core.buildMemo(ix, old, form).rows.filter((r) => !auto.has(r.number)).map((r) => [r.number, r.status, r.display]);
    const now = memoNow.rows.filter((r) => !auto.has(r.number)).map((r) => [r.number, r.status, r.display]);
    assert.deepEqual(now, was, `памятка ф. ${form} совпадает с памяткой версии 0.2`);
  }
  assert.throws(() => core.migrateCase({ schema: 'case/9' }), /неизвестной версии/);
});

test('A1.5-11: все 8 форм и обе карты ИПК доступны в режиме «Дело»', () => {
  const forms = pack.forms.map((f) => f.form);
  assert.deepEqual(forms.sort(), ['1', '1.1', '2', '2.1', '3', '4', '5', '6', 'ipk', 'ipk-in'].sort());
  const { c, evs } = chainCase();
  const ev = evs.E7;
  for (const [form, variant] of [['1'], ['1.1'], ['2'], ['2.1'], ['3'], ['4'], ['5'], ['6'], ['ipk', 'lc'], ['ipk', 'pr'], ['ipk-in']]) {
    const of = { 1: { crime: 'crime.1' }, 1.1: { crime: 'crime.1' }, 5: { victim: 'victim.1' }, ipk: variant === 'lc' ? { person: 'person.2', crime: 'crime.1' } : { crime: 'crime.1' } }[form] ?? (['2', '2.1', '6', 'ipk-in'].includes(form) ? { person: 'person.2' } : {});
    const card = core.addCardManually(ix, c, ev, { form, variant, of });
    const memo = core.buildCardMemo(ix, c, ev, card, PROFILE);
    const expected = ix.forms.get(form).requisites.filter((r) => !r.variants || r.variants.includes(variant)).map((r) => r.id);
    assert.deepEqual(memo.rows.map((r) => r.id), expected, `${form} ${variant ?? ''}`);
    assert.ok(core.questionsForForm(ix, core.cardView(ix, c, ev, card, PROFILE), form).length > 0);
  }
});

test('A1.5-12: порождение пакета и всех памяток события «Направление в суд» – менее 1 секунды', () => {
  const { c } = chainCase();
  const t = performance.now();
  const ev = runEvent(c, FX.branches.find((b) => b.id === 'B-court'));
  const memos = core.buildPackageMemos(ix, c, ev, PROFILE);
  core.runPackageChecks(ix, c, ev, memos);
  core.packageQuestions(ix, c, ev, PROFILE);
  const ms = performance.now() - t;
  assert.ok(ms < 1000, `${ms.toFixed(0)} мс`);
});

test('A1.5-13: типографика пакета событий, форм ИПК, эталонов и новых модулей – без «ё» и «—»', () => {
  const files = ['data/events/2026/events.json', 'data/forms/2026/forma-ipk.json', 'data/forms/2026/forma-ipk-in.json',
    'tests/fixtures/case-package.json', 'tests/golden/package/compositions.json', 'src/core/model.mjs', 'src/core/package.mjs', 'src/core/vault.mjs'];
  if (fs.existsSync(path.join(ROOT, 'data/layout'))) for (const f of fs.readdirSync(path.join(ROOT, 'data/layout'), { recursive: true })) if (String(f).endsWith('.json')) files.push(`data/layout/${f}`);
  for (const f of files) assert.ok(!/[ёЁ—]/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f);
});

// Эталонные памятки: пакеты «Возбуждение дела» (E1), «Установление лица» (E7) и «Направление в суд».
// Пересоздание после проверенного изменения правил: UPDATE_GOLDEN=1 node --test tests/phase15.test.mjs
test('A1.5-11: памятки пакета совпадают с эталонами tests/golden/memo', () => {
  const dir = path.join(ROOT, 'tests/golden/memo');
  const { c, evs } = chainCase();
  const court = runEvent(c, FX.branches.find((b) => b.id === 'B-court'));
  const shot = (ev) => Object.fromEntries([...core.buildPackageMemos(ix, c, ev, PROFILE).values()].map((m) => [m.cardTitle,
    m.rows.map((r) => [r.number, r.status, r.display, r.source ?? ''])]));
  for (const [name, ev] of [['E1-vud', evs.E1], ['E7-person-identified', evs.E7], ['B-court', court]]) {
    const file = path.join(dir, `${name}.json`);
    const now = shot(ev);
    if (process.env.UPDATE_GOLDEN || !fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ golden: `memo/${name}`, status: 'draft', cards: now }, null, 1));
    }
    assert.deepEqual(now, JSON.parse(fs.readFileSync(file, 'utf8')).cards, name);
  }
});

test('В-12, В-13: код и подпись прокурора – только в карточках, отмеченных в профиле; подпись одной строкой', () => {
  const { c, ev } = courtCase();
  const withProc = { ...PROFILE, prosecutor_position: 'заместитель прокурора', prosecutor_rank: 'советник юстиции', prosecutor_fio: 'Д.Д.Д.' };
  assert.equal(core.profileValue(withProc, 'investigator_line'), 'следователь лейтенант юстиции В.В.В.');
  // по умолчанию – только ф. 1 и ф. 1.1 (порядок учета СК)
  const byDefault = core.buildPackageMemos(ix, c, ev, withProc);
  const signs = (title) => ([...byDefault.values()].find((m) => m.cardTitle === title).signatures ?? []).map((s) => s.id);
  assert.deepEqual(signs('ф. 1.1: Эпизод 1'), ['investigator', 'head', 'prosecutor']);
  assert.deepEqual(signs('ф. 3'), ['investigator', 'head']);
  assert.equal([...byDefault.values()].find((m) => m.cardTitle === 'ф. 3').rows
    .some((r) => (r.display ?? '').includes('Код органа прокуратуры')), false, 'в ф. 3 клетки прокуратуры нет');
  // орган, где прокурор подписывает и ф. 3
  const withF3 = { ...withProc, prosecutor_forms: ['1', '1.1', '3'] };
  const memos = core.buildPackageMemos(ix, c, ev, withF3);
  const f3 = [...memos.values()].find((m) => m.cardTitle === 'ф. 3');
  assert.deepEqual((f3.signatures ?? []).map((s) => s.id), ['investigator', 'head', 'prosecutor']);
  assert.equal(f3.signatures.find((s) => s.id === 'prosecutor').value, 'заместитель прокурора советник юстиции Д.Д.Д.');
});
