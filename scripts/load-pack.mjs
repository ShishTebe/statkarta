// Сборка объекта пакета из data/ для тестов и однофайловой сборки.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson } from './lib-data.mjs';

export function loadPack({ withPrivate = false } = {}) {
  const ED = '2026';
  const formIdx = readJson(`data/forms/${ED}/index.json`).forms;
  const forms = formIdx.map((f) => readJson(`data/forms/${ED}/${f.file}`));
  const classifiers = {};
  for (const c of readJson(`data/classifiers/${ED}/index.json`).classifiers) {
    if (!c.public && !withPrivate) continue;
    const rel = path.posix.normalize(path.posix.join(`data/classifiers/${ED}`, c.file));
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    const d = readJson(rel);
    if (c.no === 17) {
      // компактная запись: словарь ведомств и регионов, строки [код, наименование, ведомство, регион]
      const dict = [];
      const at = new Map();
      const ref = (v) => { if (!at.has(v)) { at.set(v, dict.length); dict.push(v); } return at.get(v); };
      const rows = d.entries.map((e) => [e['Код'], e['Наименование'], ref(e['Ведомство']), ref(e['ОКАТО'])]);
      classifiers[c.no] = { no: d.no, title: d.title, edition: d.edition, compact: { dict, rows } };
    } else {
      classifiers[c.no] = { no: d.no, title: d.title, edition: d.edition, source: d.source, notes: d.notes ?? [], entries: d.entries };
    }
  }
  if (fs.existsSync(path.join(ROOT, `data/classifiers/${ED}/okato.json`))) {
    const ok = readJson(`data/classifiers/${ED}/okato.json`);
    classifiers.okato = { no: 'okato', title: ok.title, edition: ok.edition, source: ok.source, complete: ok.complete, notes: [],
      entries: ok.entries.map((e) => ({ code: e.code, name: e.name, path: e.path, section: e.center ? `центр: ${e.center}` : undefined })) };
  }
  const articles = readJson(`data/uk/${ED}/articles.json`).articles.map((a) => ({
    article: a.article, title: a.title, repealed: a.repealed,
    parts: a.parts.map((p) => ({ part: p.part, category: p.category, category_computed: p.category_computed, lists: p.lists })),
  }));
  const manifest = readJson('data/manifest.json');
  return {
    version: manifest.data_version, edition: ED, generated: manifest.generated, private: withPrivate,
    forms, classifiers,
    uk: { articles },
    legal: { acts: readJson(`data/legal/${ED}/acts.json`).acts, notes: readJson(`data/legal/${ED}/explanations.json`).notes,
      checklist: fs.readFileSync(path.join(ROOT, `data/legal/${ED}/actuality-checklist.md`), 'utf8') },
    rules: {
      facts: readJson(`data/rules/${ED}/facts.json`).facts, questions: readJson(`data/rules/${ED}/questions.json`).questions,
      mapping: readJson(`data/rules/${ED}/mapping.json`).mapping, derived: readJson(`data/rules/${ED}/derived.json`).derived,
      checks: readJson(`data/rules/${ED}/checks.json`).checks,
      hints: readJson(`data/rules/${ED}/hints.json`).hints,
      availability: readJson(`data/rules/${ED}/availability.json`).availability,
      extract: readJson(`data/rules/${ED}/extract.json`).extract,
    },
    documents: readJson(`data/documents/${ED}/documents.json`).documents,
    events: (({ events, object_attrs, transfer_priority, mode_codes, card_common_requisites, profile_facts, profile_fills, profile_signatures }) => ({ events, object_attrs, transfer_priority, mode_codes, card_common_requisites, profile_facts, profile_fills, profile_signatures }))(readJson(`data/events/${ED}/events.json`)),
  };
}
