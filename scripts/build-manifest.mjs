// Сборка data/manifest.json: версии, контрольные суммы, признак публичности.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SCHEMA_VERSION, walk, sha256, schemaFor } from './lib-data.mjs';

const prev = fs.existsSync(path.join(ROOT, 'data/manifest.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'data/manifest.json'), 'utf8')) : null;
const files = [
  ...walk('data').filter((f) => f !== 'data/manifest.json').map((f) => ({ f, pub: true })),
  // blanks/work – рабочая папка разметки (размеченные копии и PDF), в пакет не входит
  ...walk('data-private').filter((f) => !f.includes('/sources/') && !f.includes('/blanks/work/')).map((f) => ({ f, pub: false })),
].map(({ f, pub }) => ({ path: f, sha256: sha256(f), bytes: fs.statSync(path.join(ROOT, f)).size, schema: schemaFor(f), public: pub }));

const manifest = {
  schema_version: SCHEMA_VERSION,
  data_version: '2026.2.1-draft',
  edition: '2026',
  effective_from: '2026-01-01',
  generated: new Date().toISOString().slice(0, 10),
  changelog: 'docs/CHANGELOG.md',
  status: 'draft – требует предметной приемки',
  files,
};
const same = prev && JSON.stringify(prev.files) === JSON.stringify(files);
if (same) manifest.generated = prev.generated;
fs.writeFileSync(path.join(ROOT, 'data/manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`манифест: файлов ${files.length} (публичных ${files.filter((x) => x.public).length}), ${same ? 'без изменений' : 'обновлен'}`);
