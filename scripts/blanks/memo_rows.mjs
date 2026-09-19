// Значения памятки по эталонному делу (служебный просмотр при сверке карт раскладки, Фаза 1.6).
// Запуск: node scripts/blanks/memo_rows.mjs <форма> [событие] [реквизиты через запятую]
import fs from 'node:fs';
import path from 'node:path';
import { importCore } from '../bundle.mjs';
import { loadPack } from '../load-pack.mjs';
import { ROOT, readJson } from '../lib-data.mjs';

export async function demoMemos(eventId) {
  const core = await importCore();
  const pack = loadPack({ withPrivate: fs.existsSync(path.join(ROOT, 'data-private/classifiers/2026/spr-17.json')) });
  const ix = core.indexPack(pack);
  const FX = readJson('tests/fixtures/case-package.json');
  const c = core.createCase2({ today: '2026-03-01' });
  const setFacts = (cont, facts) => { for (const [fid, v] of Object.entries(facts ?? {})) core.setFactVersion(c, cont, fid, 'answered', v, null); };
  setFacts(c.case, FX.base.case.facts);
  for (const kind of ['crime', 'person', 'victim']) {
    for (const o of FX.base[core.OBJECT_KINDS[kind]]) setFacts(core.addObject(c, kind, { id: o.id, label: o.label ?? '', attrs: o.attrs ?? {}, crimes: o.crimes ?? [] }), o.facts);
  }
  c.damage.attrs = { ...FX.base.damage.attrs };
  setFacts(c.damage, FX.base.damage.facts);
  let ev = null;
  for (const e of FX.chain) {
    for (const v of e.add?.victims ?? []) core.addObject(c, 'victim', { id: v.id, attrs: v.attrs, crimes: v.crimes });
    ev = core.addEvent(c, { type: e.type, date: e.date, attrs: e.attrs ?? {}, refs: e.refs ?? {} });
    core.applyEventFacts(ix, c, ev);
    core.syncPackage(ix, c, ev);
    if (eventId && e.id === eventId) break;
  }
  return { core, ix, c, ev, memos: core.buildPackageMemos(ix, c, ev, FX.profile ?? {}) };
}

if (process.argv[1]?.endsWith('memo_rows.mjs')) {
  const [form, eventId = 'E1', only] = process.argv.slice(2);
  const { memos } = await demoMemos(eventId);
  const memo = [...memos.values()].find((m) => m.form === form);
  const want = only ? new Set(only.split(',')) : null;
  for (const r of memo.rows) {
    if (want && !want.has(r.id)) continue;
    console.log(r.id, r.status, JSON.stringify(r.value), '|', r.display.slice(0, 60));
  }
}
