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

const isZip = (u8) => u8[0] === 0x50 && u8[1] === 0x4b;
const isOle = (u8) => u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0;
const isRtf = (u8) => u8[0] === 0x7b && u8[1] === 0x5c && u8[2] === 0x72 && u8[3] === 0x74;
const isPdf = (u8) => u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46;

// Вид файла определяется по содержимому, а не по расширению (письма часто приходят с неверным)
export async function fileText(name, bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (isZip(u8)) return { kind: 'docx', text: await docxText(u8) };
  if (isOle(u8)) throw new Error('Файл в старом формате Word (.doc). Откройте его в Word и сохраните как «Документ Word (.docx)», затем загрузите снова');
  if (isRtf(u8)) throw new Error('Формат .rtf пока не принимается (Фаза 3). Сохраните документ в Word как .docx');
  if (isPdf(u8)) throw new Error('Формат .pdf пока не принимается (Фаза 3). Загрузите исходный файл Word (.docx) или вставьте текст');
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
