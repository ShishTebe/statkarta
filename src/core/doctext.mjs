// Прием документа (Фаза 2, FR-07): текст из .docx, .txt или вставки – без внешних библиотек.
// Текст документа живет только в памяти вкладки и в файл дела не сохраняется (NFR-02).

import { readZip, entryText } from './zip.mjs';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });
}

// Абзацы word/document.xml: текст прогонов, табуляции и переносы; поля Word (HYPERLINK и т. п.),
// удаленный при рецензировании текст и запасные копии надписей (mc:Fallback) пропускаются.
export function documentXmlParagraphs(xml) {
  const body = xml
    .replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '')
    .replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, '')
    .replace(/<w:delText[^>]*>[\s\S]*?<\/w:delText>/g, '');
  const out = [];
  for (const p of body.split(/<\/w:p>/)) {
    let text = '';
    const rx = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>|<w:noBreakHyphen\/>/g;
    let m;
    while ((m = rx.exec(p))) {
      if (m[1] !== undefined) text += unescapeXml(m[1]);
      else if (m[0].startsWith('<w:tab')) text += '\t';
      else if (m[0].startsWith('<w:noBreakHyphen')) text += '-';
      else text += '\n';
    }
    out.push(text);
  }
  return out;
}

export async function docxText(bytes) {
  const entries = readZip(bytes);
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) throw new Error('Это не документ Word (.docx): внутри нет word/document.xml');
  return documentXmlParagraphs(await entryText(doc)).join('\n');
}

// .txt: UTF-8 (с BOM и без), иначе Windows-1251 – так сохраняет Блокнот на рабочих компьютерах
export function decodeText(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1251').decode(u8);
  }
}


// ---------- .rtf ----------

const RTF_SPECIAL = { par: '\n', line: '\n', tab: '\t', emdash: '-', endash: '-', bullet: '-', lquote: "'", rquote: "'", ldblquote: '"', rdblquote: '"', nbsp: ' ' };
const SKIP_GROUPS = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'generator', 'listtable', 'listoverridetable', 'rsidtbl', 'xmlnstbl', 'mmathPr', 'header', 'footer', 'footnote', 'field']);

// Текст из .rtf: управляющие слова, escape-последовательности \'hh (кодовая страница) и \uN
export function rtfText(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const src = new TextDecoder('latin1').decode(u8);
  const cp = /\\ansicpg(\d+)/.exec(src)?.[1] ?? '1251';
  const dec = new TextDecoder(`windows-${cp}`, { fatal: false });
  const parts = [];
  let buf = [];
  const flush = () => { if (buf.length) { parts.push(dec.decode(Uint8Array.from(buf))); buf = []; } };
  const put = (str) => { flush(); parts.push(str); };
  let skipDepth = 0;
  const stack = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') { stack.push(skipDepth); continue; }
    if (ch === '}') { skipDepth = stack.pop() ?? 0; continue; }
    if (ch === '\\') {
      const esc = src[i + 1];
      if (esc === "'") { // байт в кодовой странице документа
        const hex = src.slice(i + 2, i + 4);
        i += 3;
        if (!skipDepth) buf.push(parseInt(hex, 16));
        continue;
      }
      if (esc === '\\' || esc === '{' || esc === '}') { i += 1; if (!skipDepth) put(esc); continue; }
      const m = /^([a-zA-Z*]+)(-?\d+)? ?/.exec(src.slice(i + 1));
      if (!m) { i += 1; continue; }
      i += m[0].length;
      const word = m[1];
      const num = m[2] === undefined ? null : Number(m[2]);
      if (word === 'u' && num !== null) {
        if (!skipDepth) put(String.fromCharCode(num < 0 ? num + 65536 : num));
        if (src[i + 1] === "'") i += 4; else if (src[i + 1] === '?') i += 1; // запасной символ
        continue;
      }
      if (SKIP_GROUPS.has(word) || word === '*') { skipDepth = stack.length; continue; }
      if (!skipDepth && word in RTF_SPECIAL) put(RTF_SPECIAL[word]);
      continue;
    }
    if (ch === '\r' || ch === '\n') continue;
    if (!skipDepth) buf.push(u8[i]);
  }
  flush();
  return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

// ---------- .pdf с текстовым слоем ----------

// через Response: так поток читается и в Safari (асинхронный перебор потока там поддерживается не везде)
async function unpack(bytes, format) {
  const src = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(src).arrayBuffer());
}

// потоки PDF сжаты zlib (deflate); в старых файлах встречается и «сырой» deflate
const inflate = async (bytes) => {
  try { return await unpack(bytes, 'deflate'); } catch { return unpack(bytes, 'deflate-raw'); }
};

function pdfObjects(u8) {
  const src = new TextDecoder('latin1').decode(u8);
  const out = [];
  const rx = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = rx.exec(src))) {
    const start = m.index + m[0].length;
    const end = src.indexOf('endobj', start);
    if (end < 0) continue;
    out.push({ num: Number(m[1]), head: src.slice(start, Math.min(end, start + 2000)), start, end });
  }
  return { src, out };
}

// Таблица ToUnicode (bfchar, bfrange) – коды символов шрифта в буквы
function parseToUnicode(cmap) {
  const map = new Map();
  const hex = (h) => String.fromCharCode(...(h.match(/.{4}/g) ?? []).map((x) => parseInt(x, 16)));
  for (const block of cmap.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    for (const m of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(m[1], 16), hex(m[2]));
  }
  for (const block of cmap.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    for (const m of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const from = parseInt(m[1], 16);
      const to = parseInt(m[2], 16);
      const dst = parseInt(m[3], 16);
      for (let c = from; c <= to && c - from < 65536; c++) map.set(c, String.fromCharCode(dst + (c - from)));
    }
  }
  return map;
}

function pdfStrings(content, map, twoByte) {
  const text = (raw) => {
    const bytes = [];
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        const oct = /^[0-7]{1,3}/.exec(raw.slice(i + 1, i + 4));
        if (oct) { bytes.push(parseInt(oct[0], 8)); i += oct[0].length; continue; }
        const esc = { n: 10, r: 13, t: 9, b: 8, f: 12 }[n];
        bytes.push(esc ?? n.charCodeAt(0));
        i += 1;
        continue;
      }
      bytes.push(c.charCodeAt(0) & 0xff);
    }
    let out = '';
    if (twoByte) {
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        const code = (bytes[i] << 8) | bytes[i + 1];
        out += map.get(code) ?? '';
      }
    } else {
      for (const b of bytes) out += map.get(b) ?? new TextDecoder('windows-1251').decode(Uint8Array.from([b]));
    }
    return out;
  };
  let out = '';
  const rx = /\((?:\\.|[^\\()])*\)|<([0-9a-fA-F\s]+)>|\bTJ\b|\bTj\b|\bTD\b|\bTd\b|\bT\*\b|\bET\b/g;
  let m;
  while ((m = rx.exec(content))) {
    const tok = m[0];
    if (tok.startsWith('(')) out += text(tok.slice(1, -1));
    else if (tok.startsWith('<')) {
      const hex = tok.slice(1, -1).replace(/\s+/g, '');
      const codes = twoByte ? hex.match(/.{1,4}/g) ?? [] : hex.match(/.{1,2}/g) ?? [];
      for (const c of codes) out += map.get(parseInt(c, 16)) ?? '';
    } else if (tok === 'TD' || tok === 'Td' || tok === 'T*' || tok === 'ET') out += '\n';
  }
  return out;
}

// Похож ли разобранный текст на русский документ: у части PDF шрифты со своими таблицами,
// и текст выходит нечитаемым – такой результат не используется (ответ В-46)
export function looksLikeRussian(text) {
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters < 40) return false;
  const cyr = (text.match(/[А-Яа-я]/gu) ?? []).length;
  const words = (text.match(/[А-Яа-я]{3,}/gu) ?? []).length;
  return cyr / letters > 0.6 && words >= 15;
}

// Текст из .pdf с текстовым слоем; для сканов возвращается пустая строка
export async function pdfText(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const { src, out: objs } = pdfObjects(u8);
  const enc = new TextEncoder();
  const raw = (o) => {
    const at = src.indexOf('stream', o.start);
    if (at < 0 || at > o.end) return null;
    const head = src.slice(o.start, at);
    let s = at + 6;
    if (src[s] === '\r') s++;
    if (src[s] === '\n') s++;
    const e = src.indexOf('endstream', s);
    if (e < 0) return null;
    // длина потока берется из его описания: лишние байты в конце ломают распаковку
    const len = Number(/\/Length\s+(\d+)/.exec(head)?.[1] ?? 0);
    const end = len > 0 && s + len <= e ? s + len : e;
    return { bytes: u8.subarray(s, end), flate: /\/FlateDecode/.test(head), head };
  };
  const decoded = async (o) => {
    const r = raw(o);
    if (!r) return '';
    if (!r.flate) return new TextDecoder('latin1').decode(r.bytes);
    try { return new TextDecoder('latin1').decode(await inflate(r.bytes)); } catch { return ''; }
  };
  // потоки распаковываются один раз: среди них и таблицы соответствия (ToUnicode), и содержимое страниц
  const streams = [];
  for (const o of objs) {
    const r = raw(o);
    if (!r || /\/(Image|FontFile\d?)\b/.test(r.head) || r.bytes.length > 4 * 1024 * 1024) continue;
    const content = await decoded(o);
    if (content) streams.push(content);
  }
  let map = new Map();
  let twoByte = false;
  for (const content of streams) {
    if (!/beginbf(char|range)/.test(content)) continue;
    if (/begincodespacerange[\s\S]{0,60}<[0-9a-fA-F]{4}>/.test(content)) twoByte = true;
    for (const [k, v] of parseToUnicode(content)) if (!map.has(k)) map.set(k, v);
  }
  let text = '';
  for (const content of streams) {
    if (!/\bTj\b|\bTJ\b/.test(content)) continue;
    text += `${pdfStrings(content, map, twoByte)}\n`;
  }
  void enc;
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const isZip = (u8) => u8[0] === 0x50 && u8[1] === 0x4b;
const isOle = (u8) => u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0;
const isRtf = (u8) => u8[0] === 0x7b && u8[1] === 0x5c && u8[2] === 0x72 && u8[3] === 0x74;
const isPdf = (u8) => u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46;

// Вид файла определяется по содержимому, а не по расширению (письма часто приходят с неверным)
export const MAX_FILE_BYTES = 30 * 1024 * 1024;

export async function fileText(name, bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length > MAX_FILE_BYTES) throw new Error(`Файл слишком большой (${Math.round(u8.length / 1048576)} МБ): загрузите сам документ, а не том дела`);
  if (isZip(u8)) return { kind: 'docx', text: await docxText(u8) };
  if (isOle(u8)) throw new Error('Файл в старом формате Word (.doc). Откройте его в Word и сохраните как «Документ Word (.docx)», затем загрузите снова');
  if (isRtf(u8)) {
    const text = rtfText(u8);
    if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 20) throw new Error('В файле .rtf не нашелся текст. Откройте его в Word и сохраните как «Документ Word (.docx)»');
    return { kind: 'rtf', text };
  }
  if (isPdf(u8)) {
    const text = await pdfText(u8);
    if (!looksLikeRussian(text)) {
      throw new Error(text.replace(/[^\p{L}\p{N}]/gu, '').length < 40
        ? 'В этом PDF нет текстового слоя: это скан. Распознавание сканов будет в Фазе 4; пока загрузите файл Word (.docx) или вставьте текст'
        : 'Текст этого PDF читается неразборчиво (в файле свои таблицы шрифтов). Откройте его и сохраните как «Документ Word (.docx)» или вставьте текст');
    }
    return { kind: 'pdf', text };
  }
  return { kind: 'txt', text: decodeText(u8), name };
}

// Единый вид текста для разбора: неразрывные пробелы, кавычки-«лапки», дефисы, буква е.
// Длина строки не меняется, поэтому позиции находок совпадают с исходным текстом.
// Особые знаки заданы кодами, чтобы в исходном тексте программы не было их начертаний.
const ch = (...codes) => String.fromCharCode(...codes);
const RX_SPACE = new RegExp(`[${ch(0xa0, 0x2007, 0x202f)}\\t]`, 'g');
const RX_QUOTE = new RegExp(`[${ch(0x201c, 0x201d, 0x201e, 0x2033)}]`, 'g');
const RX_HYPHEN = new RegExp(`[${ch(0x2010, 0x2011, 0x2212)}]`, 'g');
const RX_YO = new RegExp(ch(0x451), 'g');
const RX_YO_CAP = new RegExp(ch(0x401), 'g');

export function normalizeForScan(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, (m) => (m.length === 2 ? ' \n' : '\n'))
    .replace(RX_SPACE, ' ')
    .replace(RX_QUOTE, '"')
    .replace(RX_HYPHEN, '-')
    .replace(RX_YO, ch(0x435)).replace(RX_YO_CAP, ch(0x415));
}
