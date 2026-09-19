// Общие функции для скриптов пакетов данных (без внешних зависимостей).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const SCHEMA_VERSION = 1;

export function readJson(rel) {
  if (!rel.endsWith('.json')) throw new Error(`не JSON: ${rel}`);
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

export function walk(dirRel) {
  const out = [];
  const abs = path.join(ROOT, dirRel);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(dirRel, e.name);
    if (e.isDirectory()) out.push(...walk(rel));
    else if (/\.(json|md|csv)$/.test(e.name)) out.push(rel);
  }
  return out.sort();
}

export function sha256(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
}

// Какой схеме соответствует файл пакета
export function schemaFor(rel) {
  const b = path.posix.basename(rel);
  if (rel.includes('/schema/') || b === 'manifest.json' || b === 'index.json') return null;
  if (/\/forms\/\d{4}\/(forma-|ipk)/.test(rel)) return 'form';
  if (/^data\/classifiers\/\d{4}\/spr-\d+\.json$/.test(rel)) return 'classifier';
  const map = {
    'facts.json': 'facts', 'questions.json': 'questions', 'mapping.json': 'mapping', 'derived.json': 'derived',
    'checks.json': 'checks', 'extract.json': 'extract', 'documents.json': 'documents', 'acts.json': 'legal',
    'explanations.json': 'explanations', 'articles.json': 'uk-articles', 'lists.json': 'uk-lists',
    'hints.json': 'hints', 'availability.json': 'availability', 'events.json': 'events',
  };
  return map[b] ?? null;
}

// Минимальный валидатор JSON Schema: type, enum, required, properties, items, pattern, minLength, minItems
export function validateSchema(value, schema, at = '$', errors = []) {
  if (errors.length > 50) return errors;
  if (schema.enum && !schema.enum.some((v) => v === value)) {
    errors.push(`${at}: значение ${JSON.stringify(value)} не из списка ${JSON.stringify(schema.enum)}`);
    return errors;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
    const ok = types.some((t) => t === actual || (t === 'number' && actual === 'integer'));
    if (!ok) { errors.push(`${at}: ожидался тип ${types.join('|')}, получен ${actual}`); return errors; }
  }
  if (typeof value === 'string') {
    if (schema.minLength && value.length < schema.minLength) errors.push(`${at}: строка короче ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${at}: «${value}» не соответствует шаблону ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) errors.push(`${at}: элементов меньше ${schema.minItems}`);
    if (schema.items) value.forEach((v, i) => validateSchema(v, schema.items, `${at}[${i}]`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of schema.required ?? []) if (!(k in value)) errors.push(`${at}: нет обязательного поля «${k}»`);
    for (const [k, s] of Object.entries(schema.properties ?? {})) if (k in value) validateSchema(value[k], s, `${at}.${k}`, errors);
  }
  return errors;
}

// Шаблоны извлечения пишутся в синтаксисе Python re; в JS \w и \b не видят кириллицу
export function toJsRegex(pattern) {
  const src = pattern.replace(/\\w/g, '[\\p{L}\\p{N}_]').replace(/\\b/g, '(?:(?<![\\p{L}\\p{N}_])|(?![\\p{L}\\p{N}_]))');
  return new RegExp(src, 'imu');
}
