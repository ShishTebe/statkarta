// Чтение и сборка zip без внешних библиотек (Фаза 1.6, FR-40).
// Сжатие и распаковка – штатными DecompressionStream и CompressionStream ('deflate-raw'),
// которые есть и в браузере, и в Node. Записи, которые не менялись, переносятся в новый архив
// сжатыми, байт в байт: содержимое эталонного бланка не пересобирается.

const SIG_EOCD = 0x06054b50;
const SIG_CD = 0x02014b50;
const SIG_LFH = 0x04034b50;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function through(bytes, stream) {
  const src = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(src).arrayBuffer());
}

export const inflateRaw = (bytes) => through(bytes, new DecompressionStream('deflate-raw'));
export const deflateRaw = (bytes) => through(bytes, new CompressionStream('deflate-raw'));

function findEocd(view, bytes) {
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i -= 1) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  throw new Error('Не найден конец zip-архива: файл поврежден или это не .docx');
}

// Разбор архива. Возвращает записи в исходном порядке; данные хранятся сжатыми.
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view, bytes);
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(p, true) !== SIG_CD) throw new Error('Поврежден каталог zip-архива');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const time = view.getUint16(p + 12, true);
    const date = view.getUint16(p + 14, true);
    const crc = view.getUint32(p + 16, true);
    const compressedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (view.getUint32(offset, true) !== SIG_LFH) throw new Error(`Поврежден заголовок записи ${name}`);
    const lfhNameLen = view.getUint16(offset + 26, true);
    const lfhExtraLen = view.getUint16(offset + 28, true);
    const start = offset + 30 + lfhNameLen + lfhExtraLen;
    entries.push({ name, method, flags, time, date, crc, size, compressedSize,
      data: bytes.subarray(start, start + compressedSize) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Содержимое записи как байты (при необходимости распаковывается).
export async function entryBytes(entry) {
  if (entry.method === 0) return entry.data;
  if (entry.method === 8) return inflateRaw(entry.data);
  throw new Error(`Неизвестный способ сжатия ${entry.method} в записи ${entry.name}`);
}

export async function entryText(entry) {
  return new TextDecoder().decode(await entryBytes(entry));
}

// Замена содержимого записи: данные сжимаются заново, остальные записи не трогаются.
export async function replaceEntry(entries, name, bytes) {
  const i = entries.findIndex((e) => e.name === name);
  if (i < 0) throw new Error(`В архиве нет записи ${name}`);
  const data = await deflateRaw(bytes);
  entries[i] = { ...entries[i], method: 8, flags: entries[i].flags & ~0x08, crc: crc32(bytes),
    size: bytes.length, compressedSize: data.length, data };
  return entries;
}

// Сборка архива из записей (данные уже сжаты).
export function writeZip(entries) {
  const enc = new TextEncoder();
  const names = entries.map((e) => enc.encode(e.name));
  const total = entries.reduce((n, e, i) => n + 30 + names[i].length + e.data.length + 46 + names[i].length, 22);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let p = 0;
  const offsets = [];
  entries.forEach((e, i) => {
    offsets.push(p);
    view.setUint32(p, SIG_LFH, true);
    view.setUint16(p + 4, 20, true);
    view.setUint16(p + 6, e.flags & ~0x08, true);
    view.setUint16(p + 8, e.method, true);
    view.setUint16(p + 10, e.time, true);
    view.setUint16(p + 12, e.date, true);
    view.setUint32(p + 14, e.crc, true);
    view.setUint32(p + 18, e.compressedSize, true);
    view.setUint32(p + 22, e.size, true);
    view.setUint16(p + 26, names[i].length, true);
    view.setUint16(p + 28, 0, true);
    out.set(names[i], p + 30);
    out.set(e.data, p + 30 + names[i].length);
    p += 30 + names[i].length + e.data.length;
  });
  const cdStart = p;
  entries.forEach((e, i) => {
    view.setUint32(p, SIG_CD, true);
    view.setUint16(p + 4, 20, true);
    view.setUint16(p + 6, 20, true);
    view.setUint16(p + 8, e.flags & ~0x08, true);
    view.setUint16(p + 10, e.method, true);
    view.setUint16(p + 12, e.time, true);
    view.setUint16(p + 14, e.date, true);
    view.setUint32(p + 16, e.crc, true);
    view.setUint32(p + 20, e.compressedSize, true);
    view.setUint32(p + 24, e.size, true);
    view.setUint16(p + 28, names[i].length, true);
    view.setUint16(p + 30, 0, true);
    view.setUint16(p + 32, 0, true);
    view.setUint16(p + 34, 0, true);
    view.setUint16(p + 36, 0, true);
    view.setUint32(p + 38, 0, true);
    view.setUint32(p + 42, offsets[i], true);
    out.set(names[i], p + 46);
    p += 46 + names[i].length;
  });
  view.setUint32(p, SIG_EOCD, true);
  view.setUint16(p + 8, entries.length, true);
  view.setUint16(p + 10, entries.length, true);
  view.setUint32(p + 12, p - cdStart, true);
  view.setUint32(p + 16, cdStart, true);
  view.setUint16(p + 20, 0, true);
  return out.subarray(0, p + 22);
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Архив из готовых файлов: [{ name, bytes }] – для пакетной выгрузки бланков события (FR-43).
export async function zipFiles(files) {
  const entries = [];
  for (const f of files) {
    const data = await deflateRaw(f.bytes);
    entries.push({ name: f.name, method: 8, flags: 0x800, time: 0, date: 0x21, crc: crc32(f.bytes),
      size: f.bytes.length, compressedSize: data.length, data });
  }
  return writeZip(entries);
}
