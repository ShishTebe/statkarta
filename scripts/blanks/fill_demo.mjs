// Проверочное заполнение бланка по эталонному делу (Фаза 1.6, шаг Ш-5).
// Строит пакет карточек по событию эталонного дела tests/fixtures/case-package.json, заполняет
// бланк выбранной формы и сохраняет .docx. Служебный скрипт: нужен, чтобы посмотреть результат
// в Word; в приложении то же делает экран «Бланк».
//
// Запуск: node scripts/blanks/fill_demo.mjs <форма> <куда.docx> [событие]
import { readFile, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { importCore } from '../bundle.mjs';
import { loadPack } from '../load-pack.mjs';
import { ROOT, readJson } from '../lib-data.mjs';

const FILE_NAME = { '1': 'forma-1', '1.1': 'forma-1-1', '2': 'forma-2', '2.1': 'forma-2-1',
  '4': 'forma-4', '5': 'forma-5', '6': 'forma-6', ipk: 'forma-ipk', 'ipk-in': 'forma-ipk-in' };

const [form, dst, eventId] = process.argv.slice(2);
const core = await importCore();
const pack = loadPack({ withPrivate: fs.existsSync(path.join(ROOT, 'data-private/classifiers/2026/spr-17.json')) });
const ix = core.indexPack(pack);
const FX = readJson('tests/fixtures/case-package.json');

const c = core.createCase2({ today: '2026-03-01' });
const setFacts = (cont, facts) => {
  for (const [fid, v] of Object.entries(facts ?? {})) core.setFactVersion(c, cont, fid, 'answered', v, null);
};
setFacts(c.case, FX.base.case.facts);
for (const kind of ['crime', 'person', 'victim']) {
  for (const o of FX.base[core.OBJECT_KINDS[kind]]) {
    const obj = core.addObject(c, kind, { id: o.id, label: o.label ?? '', attrs: o.attrs ?? {}, crimes: o.crimes ?? [] });
    setFacts(obj, o.facts);
  }
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

const memos = core.buildPackageMemos(ix, c, ev, FX.profile ?? {});
const memo = [...memos.values()].find((m) => m.form === form);
if (!memo) throw new Error(`В пакете нет формы ${form}: есть ${[...memos.values()].map((m) => m.form).join(', ')}`);
const layout = JSON.parse(await readFile(path.join(ROOT, `data/layout/2026/${FILE_NAME[form]}.json`), 'utf8'));
const plan = core.planBlank(memo, layout);
const bytes = new Uint8Array(await readFile(path.join(ROOT, 'data/blanks/2026', layout.blank)));
await writeFile(dst, await core.fillDocx(bytes, layout, plan.edits));
console.log(`карточка: ${memo.cardTitle ?? memo.title}; реквизитов заполнено ${plan.fields.length}, знаков ${plan.edits.length}`);
console.log(`к печати готова: ${plan.ready ? 'да' : 'нет'}; помех ${plan.blockers.length}; замечаний ${plan.warnings.length}`);
for (const b of plan.blockers.slice(0, 6)) console.log('  помеха:', b);
for (const w of plan.notes.slice(0, 6)) console.log('  замечание:', w);
