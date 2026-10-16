// Заполнение по другой карточке: чтение заполненной карточки (Word .docx или PDF, напечатанный из Word)
// и перенос ее реквизитов в новую карточку – новый эпизод, новое лицо по тому же преступлению,
// карточка другого дела (замечание заказчика от 16.10.2026).
//
// Чтение идет по карте раскладки бланка в обратную сторону: в .docx – текст фигур бланка по их
// порядковым номерам, в PDF – знаки страницы по координатам мест бланка (data/layout/2026/pdf).
// Значения раскладываются по реквизитам так же, как их раскладывает blank.mjs, только наоборот:
// клетки → код, дата, номер, квалификация. В дело переносится только то, что подтвердил следователь.

import { readZip, entryText } from './zip.mjs';
import { xlsxCellText, XLSX_SHEET } from './xlsxfill.mjs';
import { shapes, shapeText, findTableCell, findParagraph } from './ooxml.mjs';
import { parseToUnicode } from './doctext.mjs';
import { keyCode, optKey } from './pack.mjs';
import { nonzeroPositions } from './codes.mjs';
import { displayOf, lookupOf, factOptions } from './engine.mjs';
import { isoToRu, todayIso } from './text.mjs';
import { addObject, addEvent, factAt, getEvent, setFactVersion } from './model.mjs';
import { scopeOf, modeRequisite, activeCards, addCardManually, profileFillsOf } from './package.mjs';

// Сведения, по которым карточка привязана к своему делу: из карточки другого дела по умолчанию
// не переносятся (номер дела, КРСП, дата возбуждения)
const CARD_CASE_IDS = new Set(['fact.case.case_number', 'fact.case.kusp', 'fact.case.kusp_date', 'fact.case.vud_date', 'fact.case.vud_date.date']);
const CARD_SKIP_FILLS_BY = new Set(['ic', 'court']);
const CARD_SCOPE_RU = { case: 'Сведения дела', crime: 'Сведения эпизода', person: 'Сведения лица', victim: 'Сведения потерпевшего', card: 'Реквизиты карточки' };
export const CARD_IMPORT_SCOPES = CARD_SCOPE_RU;

// текст места без надписей фигур, привязанных к его абзацам (клетки кодов – отдельные места)
const ciXmlText = (body) => [...body.replace(/<w:txbxContent>[\s\S]*?<\/w:txbxContent>/g, '').replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '').matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join('')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const ciSpaces = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Вписанное в бланк: разница текста места в заполненном файле и в чистом бланке (общее начало и
// общий конец отбрасываются, остатки линеек «____» тоже)
export function insertedText(blankText, filledText) {
  const a = ciSpaces(blankText);
  const b = ciSpaces(filledText);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p += 1;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s += 1;
  return b.slice(p, b.length - s).replace(/_{2,}/g, ' ').replace(/^[\s_/]+|[\s_/]+$/g, '').replace(/\s+/g, ' ').trim();
}

// ---------- Word: текст мест бланка ----------

async function ciDocumentXml(bytes) {
  const entries = readZip(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) throw new Error('В файле нет текста документа Word');
  return entryText(doc);
}

function ciPlaceText(xml, place) {
  try {
    const range = place.anchor ? findParagraph(xml, place.anchor) : findTableCell(xml, place);
    return ciXmlText(xml.slice(range.inner[0], range.inner[1]));
  } catch {
    return null;
  }
}

// Какая форма в файле Word: число фигур совпадает с бланком и в тексте есть наименование формы.
// blanks – [{ form, layout, xml }] (xml – document.xml чистого бланка)
export function cardFormOfDocx(xml, blanks, forms) {
  const count = shapes(xml).length;
  const text = ciSpaces(ciXmlText(xml)).toUpperCase();
  const same = blanks.filter((b) => b.xml && shapes(b.xml).length === count);
  const titled = (b) => {
    const t = forms.get(b.form)?.title;
    return t && text.includes(ciSpaces(t).toUpperCase().slice(0, 40));
  };
  return same.find(titled) ?? (same.length === 1 ? same[0] : null) ?? blanks.find((b) => !shapes(b.xml).length && titled(b)) ?? null;
}

// Текст клеток и текстовых мест карточки в .docx
export function docxCardCells(xml, blankXml, layout) {
  const cells = new Map();
  const total = shapes(xml).length;
  for (const f of layout.fields ?? []) {
    const groups = [...(f.groups ?? []), ...(f.parts ?? []).flatMap((p) => [...(p.groups ?? []), ...(p.fills ?? [])])];
    for (const shape of groups.flat()) {
      if (shape >= total || cells.has(shape)) continue;
      // печатный знак бланка в фигуре («/» между группами) значением не считается
      const printed = blankXml ? shapeText(blankXml, shape) : '';
      const text = shapeText(xml, shape);
      cells.set(shape, printed && text.startsWith(printed) ? text.slice(printed.length) : text);
    }
  }
  const texts = {};
  for (const f of layout.fields ?? []) {
    (f.parts ?? []).forEach((p, i) => {
      if (!p.place) return;
      const filled = ciPlaceText(xml, p.place);
      if (filled === null) return;
      const blank = blankXml ? ciPlaceText(blankXml, p.place) ?? '' : '';
      texts[`${f.requisite}|${i}`] = insertedText(blank, filled);
    });
  }
  return { cells, texts };
}

// ---------- Excel: ф. 3 по адресам ячеек листа (ответ В-80) ----------

// Текст ячеек карты раскладки ф. 3; печатный текст ячейки чистого бланка вычитается.
// blank – { sheet, shared } чистой книги
export function xlsxCardCells(sheet, shared, blank, layout) {
  const cells = new Map();
  const texts = {};
  for (const f of layout.fields ?? []) {
    const groups = [...(f.groups ?? []), ...(f.parts ?? []).flatMap((p) => [...(p.groups ?? []), ...(p.fills ?? [])])];
    for (const ref of groups.flat()) {
      if (cells.has(ref)) continue;
      const printed = blank ? xlsxCellText(blank.sheet, blank.shared, ref).trim() : '';
      const text = xlsxCellText(sheet, shared, ref).trim();
      cells.set(ref, printed && text.startsWith(printed) ? text.slice(printed.length) : text);
    }
    (f.parts ?? []).forEach((p, i) => {
      if (!p.place?.cell || p.role === 'signature') return;
      texts[`${f.requisite}|${i}`] = insertedText(blank ? xlsxCellText(blank.sheet, blank.shared, p.place.cell) : '', xlsxCellText(sheet, shared, p.place.cell));
    });
  }
  return { cells, texts };
}

// ---------- PDF: знаки страницы с координатами ----------

function ciPdfIndex(u8) {
  const src = new TextDecoder('latin1').decode(u8);
  const direct = new Map();
  const rx = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = rx.exec(src))) {
    const start = m.index + m[0].length;
    const end = src.indexOf('endobj', start);
    if (end > 0) direct.set(Number(m[1]), { start, end });
  }
  return { u8, src, direct, packed: new Map() };
}

// Разбор значения словаря PDF «как есть»: вложенные << >>, [ ], строки
function ciSkipValue(s, i) {
  while (/\s/.test(s[i] ?? '')) i += 1;
  const c = s[i];
  if (c === '<' && s[i + 1] === '<') {
    let depth = 0;
    while (i < s.length) {
      if (s[i] === '<' && s[i + 1] === '<') { depth += 1; i += 2; continue; }
      if (s[i] === '>' && s[i + 1] === '>') { depth -= 1; i += 2; if (!depth) return i; continue; }
      if (s[i] === '(') { i = ciSkipValue(s, i); continue; }
      i += 1;
    }
    return i;
  }
  if (c === '[') {
    let depth = 0;
    while (i < s.length) {
      if (s[i] === '[') depth += 1;
      else if (s[i] === ']') { depth -= 1; if (!depth) return i + 1; } else if (s[i] === '(') { i = ciSkipValue(s, i); continue; }
      i += 1;
    }
    return i;
  }
  if (c === '(') {
    let depth = 0;
    while (i < s.length) {
      if (s[i] === '\\') { i += 2; continue; }
      if (s[i] === '(') depth += 1;
      else if (s[i] === ')') { depth -= 1; if (!depth) return i + 1; }
      i += 1;
    }
    return i;
  }
  if (c === '<') return s.indexOf('>', i) + 1;
  if (c === '/') { i += 1; while (i < s.length && !/[\s/<>[\]()]/.test(s[i])) i += 1; return i; }
  const ref = /^\d+\s+\d+\s+R/.exec(s.slice(i, i + 24));
  if (ref) return i + ref[0].length;
  while (i < s.length && !/[\s/<>[\]()]/.test(s[i])) i += 1;
  return i;
}

// Записи словаря верхнего уровня: имя → значение (текстом)
function ciDict(text) {
  const out = new Map();
  const s = String(text ?? '');
  let i = s.indexOf('<<');
  if (i < 0) return out;
  i += 2;
  while (i < s.length) {
    while (/\s/.test(s[i] ?? '')) i += 1;
    if (s[i] === '>' && s[i + 1] === '>') break;
    if (s[i] !== '/') { i += 1; continue; }
    const nameEnd = ciSkipValue(s, i);
    const name = s.slice(i + 1, nameEnd);
    const vEnd = ciSkipValue(s, nameEnd);
    out.set(name, s.slice(nameEnd, vEnd).trim());
    i = vEnd;
  }
  return out;
}

const ciRefNum = (v) => { const m = /^(\d+)\s+\d+\s+R$/.exec(String(v ?? '').trim()); return m ? Number(m[1]) : null; };

async function ciInflate(bytes) {
  const src = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(src).arrayBuffer());
}

async function ciStream(pdf, num) {
  const o = pdf.direct.get(num);
  if (!o) return null;
  const at = pdf.src.indexOf('stream', o.start);
  if (at < 0 || at > o.end) return null;
  const head = pdf.src.slice(o.start, at);
  const dict = ciDict(head);
  let s = at + 6;
  if (pdf.src[s] === '\r') s += 1;
  if (pdf.src[s] === '\n') s += 1;
  const e = pdf.src.indexOf('endstream', s);
  let len = Number(dict.get('Length'));
  if (!Number.isFinite(len)) {
    const lref = ciRefNum(dict.get('Length'));
    len = lref !== null ? Number(await ciObject(pdf, lref)) : NaN;
  }
  const end = len > 0 && s + len <= e ? s + len : e;
  const raw = pdf.u8.subarray(s, end);
  const filter = dict.get('Filter') ?? '';
  if (!filter) return { dict, text: new TextDecoder('latin1').decode(raw) };
  if (!/^\/FlateDecode$|^\[\s*\/FlateDecode\s*\]$/.test(filter)) return { dict, text: '' };
  try {
    return { dict, text: new TextDecoder('latin1').decode(await ciInflate(raw)) };
  } catch {
    return { dict, text: '' };
  }
}

// Объект по номеру: обычный или из потока объектов (/ObjStm – так сохраняет Word)
async function ciObject(pdf, num) {
  const o = pdf.direct.get(num);
  if (o) {
    const at = pdf.src.indexOf('stream', o.start);
    return pdf.src.slice(o.start, at > 0 && at < o.end ? at : o.end).trim();
  }
  if (!pdf.packedReady) {
    pdf.packedReady = true;
    for (const [n, d] of pdf.direct) {
      const head = pdf.src.slice(d.start, Math.min(d.end, d.start + 400));
      if (!/\/Type\s*\/ObjStm/.test(head)) continue;
      const st = await ciStream(pdf, n);
      if (!st?.text) continue;
      const first = Number(st.dict.get('First'));
      const count = Number(st.dict.get('N'));
      const nums = st.text.slice(0, first).trim().split(/\s+/).map(Number);
      for (let i = 0; i < count; i += 1) {
        const from = first + nums[2 * i + 1];
        const to = i + 1 < count ? first + nums[2 * i + 3] : st.text.length;
        if (!pdf.packed.has(nums[2 * i])) pdf.packed.set(nums[2 * i], st.text.slice(from, to).trim());
      }
    }
  }
  return pdf.packed.get(num) ?? null;
}

async function ciResolve(pdf, value) {
  const n = ciRefNum(value);
  return n === null ? value : ciObject(pdf, n);
}

const ciMul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const CI_ID = [1, 0, 0, 1, 0, 0];

async function ciFonts(pdf, resText, cache) {
  const fonts = new Map();
  const res = ciDict(await ciResolve(pdf, resText));
  const fontDict = ciDict(await ciResolve(pdf, res.get('Font') ?? ''));
  for (const [name, ref] of fontDict) {
    const n = ciRefNum(ref);
    if (n !== null && cache.has(n)) { fonts.set(name, cache.get(n)); continue; }
    const fd = ciDict(await ciResolve(pdf, ref));
    const font = { twoByte: /Type0/.test(fd.get('Subtype') ?? ''), map: new Map() };
    const tu = ciRefNum(fd.get('ToUnicode'));
    if (tu !== null) {
      const cmap = (await ciStream(pdf, tu))?.text ?? '';
      font.map = parseToUnicode(cmap);
      if (/begincodespacerange[\s\S]{0,60}<[0-9a-fA-F]{4}>/.test(cmap)) font.twoByte = true;
    }
    if (n !== null) cache.set(n, font);
    fonts.set(name, font);
  }
  return { fonts, xobjects: ciDict(await ciResolve(pdf, res.get('XObject') ?? '')) };
}

function ciDecodeString(tok, font) {
  let bytes = [];
  if (tok.startsWith('<')) {
    const hex = tok.slice(1, -1).replace(/\s+/g, '');
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2).padEnd(2, '0'), 16));
  } else {
    const raw = tok.slice(1, -1);
    for (let i = 0; i < raw.length; i += 1) {
      const c = raw[i];
      if (c !== '\\') { bytes.push(c.charCodeAt(0) & 0xff); continue; }
      const oct = /^[0-7]{1,3}/.exec(raw.slice(i + 1, i + 4));
      if (oct) { bytes.push(parseInt(oct[0], 8) & 0xff); i += oct[0].length; continue; }
      const n = raw[i + 1];
      i += 1;
      if (n === '\n' || n === '\r') continue;
      bytes.push({ n: 10, r: 13, t: 9, b: 8, f: 12 }[n] ?? n.charCodeAt(0));
    }
  }
  let out = '';
  if (font?.twoByte) {
    for (let i = 0; i + 1 < bytes.length; i += 2) out += font.map.get((bytes[i] << 8) | bytes[i + 1]) ?? '';
  } else {
    for (const b of bytes) out += font?.map.get(b) ?? (b < 128 ? String.fromCharCode(b) : new TextDecoder('windows-1251').decode(Uint8Array.of(b)));
  }
  bytes = null;
  return out;
}

// Лексемы содержимого страницы: числа, имена, строки, массивы, операторы
function* ciTokens(s) {
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === '%') { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i += 1; continue; }
    if (c === '(' || c === '[' || (c === '<' && s[i + 1] === '<') || c === '<' || c === '/') {
      const e = ciSkipValue(s, i);
      yield { v: s.slice(i, e) };
      i = e;
      continue;
    }
    let e = i;
    while (e < s.length && !/[\s/<>[\]()%]/.test(s[e])) e += 1;
    if (e === i) { i += 1; continue; }
    const w = s.slice(i, e);
    i = e;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) { yield { v: w, num: Number(w) }; continue; }
    if (w === 'ID') { const ei = s.indexOf('EI', i); i = ei < 0 ? s.length : ei + 2; continue; }
    yield { op: w };
  }
}

async function ciRunContent(pdf, content, resText, ctm, page, out, cache, depth = 0, keepSpaces = false) {
  const { fonts, xobjects } = await ciFonts(pdf, resText, cache);
  const stack = [];
  let gs = ctm;
  // область обрезки (re … W n): текст за ее пределами на странице не виден – Word так прячет
  // служебные надписи бланка
  let clip = null;
  let path = [];
  let tm = CI_ID;
  let tlm = CI_ID;
  let font = null;
  let size = 0;
  let leading = 0;
  let args = [];
  const emit = (text) => {
    const m = ciMul(tm, gs);
    const scale = Math.hypot(m[2], m[3]) || 1;
    const hidden = clip && (m[4] < clip[0] - 0.5 || m[4] > clip[2] + 0.5 || m[5] < clip[1] - 0.5 || m[5] > clip[3] + 0.5);
    if ((text.trim() || (keepSpaces && text)) && !hidden) out.push({ page: page.index, x: m[4], y: page.h - m[5], size: size * scale, text });
    tm = ciMul([1, 0, 0, 1, text.length * size * 0.5, 0], tm);
  };
  for (const t of ciTokens(content)) {
    if (!t.op) { args.push(t); continue; }
    const n = (k) => args[args.length - k]?.num ?? 0;
    switch (t.op) {
      case 'q': stack.push({ gs, clip }); break;
      case 'Q': { const st = stack.pop(); gs = st?.gs ?? ctm; clip = st ? st.clip : null; break; }
      case 're': {
        const [x, y, w, hh] = [n(4), n(3), n(2), n(1)];
        for (const [px, py] of [[x, y], [x + w, y + hh]]) {
          const tp = ciMul([1, 0, 0, 1, px, py], gs);
          path.push([tp[4], tp[5]]);
        }
        break;
      }
      case 'W': case 'W*': {
        if (path.length) {
          const xs = path.map((p) => p[0]);
          const ys = path.map((p) => p[1]);
          const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
          clip = clip ? [Math.max(clip[0], box[0]), Math.max(clip[1], box[1]), Math.min(clip[2], box[2]), Math.min(clip[3], box[3])] : box;
        }
        break;
      }
      case 'n': case 'f': case 'f*': case 'S': case 's': case 'B': case 'B*': case 'b': case 'b*': case 'F': path = []; break;
      case 'cm': gs = ciMul([n(6), n(5), n(4), n(3), n(2), n(1)], gs); break;
      case 'BT': tm = CI_ID; tlm = CI_ID; break;
      case 'Tf': font = fonts.get(String(args[args.length - 2]?.v ?? '').slice(1)) ?? null; size = n(1); break;
      case 'Tm': tlm = [n(6), n(5), n(4), n(3), n(2), n(1)]; tm = tlm; break;
      case 'Td': tlm = ciMul([1, 0, 0, 1, n(2), n(1)], tlm); tm = tlm; break;
      case 'TD': leading = -n(1); tlm = ciMul([1, 0, 0, 1, n(2), n(1)], tlm); tm = tlm; break;
      case 'TL': leading = n(1); break;
      case 'T*': tlm = ciMul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; break;
      case 'Tj': emit(ciDecodeString(String(args.at(-1)?.v ?? '()'), font)); break;
      case "'": case '"':
        tlm = ciMul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm;
        emit(ciDecodeString(String(args.at(-1)?.v ?? '()'), font));
        break;
      case 'TJ': {
        const arr = String(args.at(-1)?.v ?? '[]');
        let text = '';
        for (const part of ciTokens(arr.slice(1, -1))) {
          if (part.num !== undefined) { if (part.num < -250) text += ' '; continue; }
          if (part.v?.startsWith('(') || part.v?.startsWith('<')) text += ciDecodeString(part.v, font);
        }
        emit(text);
        break;
      }
      case 'Do': {
        if (depth > 4) break;
        const ref = ciRefNum(xobjects.get(String(args.at(-1)?.v ?? '').slice(1)));
        if (ref === null) break;
        const st = await ciStream(pdf, ref);
        if (!st || !/\/Form/.test(st.dict.get('Subtype') ?? '')) break;
        const mtx = (st.dict.get('Matrix') ?? '').replace(/[[\]]/g, '').trim().split(/\s+/).map(Number);
        const m = mtx.length === 6 && mtx.every(Number.isFinite) ? mtx : CI_ID;
        await ciRunContent(pdf, st.text, st.dict.get('Resources') ?? resText, ciMul(m, gs), page, out, cache, depth + 1, keepSpaces);
        break;
      }
      default: break;
    }
    args = [];
  }
}

// Текст страниц PDF кусками с координатами: { pages: [{ w, h }], chunks: [{ page, x, y, size, text }] },
// y – от верха страницы до базовой линии
// keepSpaces – оставлять куски из одних пробелов (пустые клетки печатной копии программы)
export async function pdfTextChunks(bytes, { keepSpaces = false } = {}) {
  const pdf = ciPdfIndex(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (/\/Encrypt\s/.test(pdf.src.slice(-4096)) || /\/Encrypt\s+\d+\s+\d+\s+R/.test(pdf.src)) throw new Error('PDF зашифрован – сохраните карточку в PDF без пароля или откройте файл Word');
  const roots = [...pdf.src.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g)];
  if (!roots.length) throw new Error('Файл PDF не разобран');
  const catalog = ciDict(await ciObject(pdf, Number(roots.at(-1)[1])));
  const pages = [];
  const walk = async (ref, inherited, guard = 0) => {
    if (guard > 50) return;
    const d = ciDict(await ciResolve(pdf, ref));
    const res = d.get('Resources') ?? inherited.res;
    const box = d.get('MediaBox') ?? inherited.box;
    if (/\/Pages\b/.test(d.get('Type') ?? '') || d.has('Kids')) {
      const kids = [...String(d.get('Kids') ?? '').matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => `${m[1]} 0 R`);
      for (const k of kids) await walk(k, { res, box }, guard + 1);
      return;
    }
    pages.push({ dict: d, res, box });
  };
  await walk(catalog.get('Pages'), { res: '', box: '[0 0 595 842]' });
  const chunks = [];
  const cache = new Map();
  const sizes = [];
  for (const [index, p] of pages.entries()) {
    const box = String(p.box ?? '').replace(/[[\]]/g, '').trim().split(/\s+/).map(Number);
    const w = (box[2] ?? 595) - (box[0] ?? 0);
    const hgt = (box[3] ?? 842) - (box[1] ?? 0);
    sizes.push({ w, h: hgt });
    const contents = String(p.dict.get('Contents') ?? '');
    const refs = [...contents.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
    let text = '';
    for (const r of refs) {
      const st = await ciStream(pdf, r);
      if (st) { text += `${st.text}\n`; continue; }
      // ссылка на массив потоков
      const arr = await ciObject(pdf, r);
      for (const m of String(arr ?? '').matchAll(/(\d+)\s+\d+\s+R/g)) text += `${(await ciStream(pdf, Number(m[1])))?.text ?? ''}\n`;
    }
    await ciRunContent(pdf, text, p.res ?? '', CI_ID, { index, h: hgt }, chunks, cache, 0, keepSpaces);
  }
  return { pages: sizes, chunks };
}

// Знаки PDF → клетки бланка по координатам мест (pos – data/layout/2026/pdf/forma-*.json)
export function pdfCardCells(extract, pos) {
  const chunks = extract.chunks;
  // сдвиг полей принтера: по номерам реквизитов в левом поле
  const dxs = [];
  const dys = [];
  let found = 0;
  for (const [label, page, ax, ay] of pos.anchors ?? []) {
    const hit = chunks.find((c) => c.page === page && Math.abs(c.x - ax) < 12 && Math.abs(c.y - c.size * 0.89 - ay) < 12
      && new RegExp(`^0?${label.replace(/\./g, '\\.')}\\.?(\\s|$)`).test(c.text.trim()));
    if (!hit) continue;
    found += 1;
    dxs.push(hit.x - ax);
    dys.push(hit.y - hit.size * 0.89 - ay);
  }
  const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
  const dx = median(dxs);
  const dy = median(dys);
  const share = pos.anchors?.length ? found / pos.anchors.length : 0;
  const byPage = new Map();
  for (const [shape, page, x, top] of pos.cells ?? []) {
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page).push({ shape, x: x + dx, top: top + dy });
  }
  // верх строки куска: базовая линия минус высота прописных (у Times New Roman – 0,89 кегля)
  const topOf = (c) => c.y - c.size * 0.89;
  // печатный текст бланка у клеток («зн.», «/», «п.») – не вписанное значение
  const isPrinted = (c) => (pos.printed ?? []).some(([page, x0, x1, top, text]) => page === c.page
    && c.x >= x0 + dx - 1 && c.x <= x1 + dx + 0.5 && Math.abs(top + dy - topOf(c)) < 2.5 && text.includes(c.text.trim()));
  const cells = new Map();
  const free = [];
  for (const c of chunks) {
    const list = byPage.get(c.page) ?? [];
    const chars = [...c.text];
    const w = c.size * 0.5;
    const top = topOf(c);
    if (isPrinted(c)) continue;
    const hits = [];
    chars.forEach((ch, i) => {
      if (!ch.trim()) return;
      const cx = c.x + (i + 0.5) * w;
      let best = null;
      let bd = Infinity;
      for (const cell of list) {
        const ddx = Math.abs(cell.x - cx);
        const ddy = Math.abs(cell.top - top);
        if (ddx > 3.6 || ddy > 3.5) continue;
        const d = ddx * ddx + ddy * ddy;
        if (d < bd) { bd = d; best = cell; }
      }
      hits.push(best ? { shape: best.shape, ch } : null);
    });
    // в клетки идут только короткие куски, целиком легшие в клетки: печатный текст бланка рядом
    // с клетками сюда не попадает
    const placed = hits.filter(Boolean);
    if (placed.length && placed.length === chars.filter((x) => x.trim()).length && chars.length <= 24) {
      for (const p of placed) cells.set(p.shape, (cells.get(p.shape) ?? '') + p.ch);
    } else free.push(c);
  }
  const texts = {};
  for (const r of pos.regions ?? []) {
    const [x0, y0, x1, y1] = r.box;
    // печатные слова бланка в области («год мес. чис. часы», номер реквизита) вычитаются по месту
    // кусок – печатный, если начинается там же, где слово бланка, и с того же слова (Word печатает
    // надпись бланка одним куском на несколько слов), либо целиком лежит внутри слова бланка
    const printedHere = (c) => (r.blank_words ?? []).some(([wx0, wx1, top, t]) => Math.abs(top + dy - topOf(c)) < 2.5
      && ((Math.abs(c.x - wx0 - dx) < 1.5 && c.text.trim().startsWith(t)) || (c.x >= wx0 + dx - 1.5 && c.x <= wx1 + dx + 0.5 && t.includes(c.text.trim()))));
    const inside = free.filter((c) => c.page === r.page && c.x >= x0 + dx && c.x <= x1 + dx && c.y - c.size * 0.7 >= y0 + dy && c.y <= y1 + dy + 4
      && !printedHere(c));
    const lines = [];
    for (const c of [...inside].sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (lines.length && Math.abs(lines.at(-1).y - c.y) < 2.5) lines.at(-1).items.push(c);
      else lines.push({ y: c.y, items: [c] });
    }
    const text = lines.map((l) => l.items.sort((a, b) => a.x - b.x).map((c) => c.text).join(' ')).join(' ');
    texts[`${r.requisite}|${r.part}`] = r.blank_words ? text.replace(/_{2,}/g, ' ').replace(/\s+/g, ' ').trim() : insertedText(r.blank_text, text);
  }
  return { cells, texts, match: { anchors: pos.anchors?.length ?? 0, found, share, dx, dy } };
}

// ---------- PDF печатной копии программы (ответ В-80) ----------
// Копия – таблица «номер – наименование – клетки»: браузер печатает ее своим шрифтом и масштабом,
// координаты бланка ИЦ к ней не подходят. Зато пустая клетка в копии – неразрывный пробел, и
// знаки строки по порядку чтения ложатся на клетки карты раскладки один к одному.

const CI_NBSP = String.fromCharCode(0xa0);
const CI_COPY_HEAD = /\(форма № ([0-9a-z.-]+), ред\. (\d{4})\)/;

function ciLines(chunks) {
  const lines = [];
  for (const c of [...chunks].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)) {
    const last = lines.at(-1);
    if (last && last.page === c.page && Math.abs(last.y - c.y) < 2) last.items.push(c);
    else lines.push({ page: c.page, y: c.y, items: [c] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

// Печатная копия: [{ form, cells, texts, rows, problems }] по каждой карточке в файле
export function appCopySheets(extract, ix, layouts) {
  const lines = ciLines(extract.chunks);
  const text = (l) => l.items.map((c) => c.text).join('');
  const sheets = [];
  // заголовок карточки может переноситься на вторую строку
  lines.forEach((l, i) => {
    const m = CI_COPY_HEAD.exec(`${text(l)}${lines[i + 1] && lines[i + 1].page === l.page ? ` ${text(lines[i + 1])}` : ''}`.replace(/\s+/g, ' '));
    if (m && (!sheets.length || sheets.at(-1).line < i - 1)) sheets.push({ line: i, form: m[1] });
  });
  const out = [];
  sheets.forEach((sh, si) => {
    const end = sheets[si + 1]?.line ?? lines.length;
    const form = ix.forms.get(sh.form);
    const layout = layouts[sh.form];
    if (!form || !layout) return;
    const own = lines.slice(sh.line, end);
    const pageLeft = new Map();
    for (const l of own) pageLeft.set(l.page, Math.min(pageLeft.get(l.page) ?? Infinity, l.items[0].x));
    const geo = (page) => {
      const left = pageLeft.get(page);
      const w = extract.pages[page]?.w ?? 595;
      // столбцы копии: номер (3,2 rem), наименование, клетки (42 % ширины таблицы)
      return { left, numMax: left + 34, valLeft: left + (w - 2 * left) * 0.58 - 3 };
    };
    // строки реквизитов – по номеру в первом столбце, по порядку реквизитов формы
    const starts = [];
    let at = 0;
    own.forEach((l, i) => {
      const g = geo(l.page);
      const first = l.items[0];
      if (first.x < g.left + 1.5 || first.x > g.numMax) return;
      const num = l.items.filter((c) => c.x < g.numMax).map((c) => c.text).join('').trim();
      const k = form.requisites.findIndex((r, j) => j >= at && r.number === num);
      if (k < 0) return;
      starts.push({ i, req: form.requisites[k] });
      at = k + 1;
    });
    const byReq = new Map((layout.fields ?? []).map((f) => [f.requisite, f]));
    const cells = new Map();
    const texts = {};
    const problems = [];
    starts.forEach((st, k) => {
      const field = byReq.get(st.req.id);
      if (!field) return;
      const from = st.i;
      const page = own[from].page;
      let to = k + 1 < starts.length ? starts[k + 1].i : own.length;
      for (let j = from + 1; j < to; j += 1) {
        // строка раздела или заголовка (с левого края) и новая страница заканчивают реквизит
        if (own[j].page !== page || own[j].items[0].x < geo(own[j].page).left + 1.5) { to = j; break; }
      }
      const g = geo(page);
      const chars = [...own.slice(from, to).flatMap((l) => l.items.filter((c) => c.x >= g.valLeft)).map((c) => c.text).join('')];
      const shapesFlat = (field.parts ? field.parts.flatMap((p) => [...(p.groups ?? []), ...(p.fills ?? [])]) : (field.groups ?? [])).flat();
      if (chars.length < shapesFlat.length) {
        if (chars.some((ch) => ch.trim() && ch !== CI_NBSP)) problems.push(st.req.number);
        return;
      }
      shapesFlat.forEach((shape, n) => { const ch = chars[n]; if (ch && ch !== CI_NBSP && ch.trim()) cells.set(shape, ch); });
      const rest = chars.slice(shapesFlat.length).join('').replace(new RegExp(CI_NBSP, 'g'), ' ').replace(/\s+/g, ' ').trim();
      const textParts = (field.parts ?? []).map((p, n) => [p, n]).filter(([p]) => ['text', 'codes_text', 'date_text'].includes(p.role));
      // имя и отчество – одно значение на два места бланка (word): в копии оно напечатано целиком
      const single = textParts.length === 1 || (textParts.length > 1 && textParts.every(([p]) => p.word !== undefined));
      if (rest && single) texts[`${field.requisite}|${textParts[0][1]}`] = rest;
    });
    out.push({ form: sh.form, cells, texts, rows: starts.length, problems });
  });
  return out;
}

// ---------- клетки → значения реквизитов ----------

// разделители групп («/», «|»), напечатанные в бланке рядом с клетками, значением не считаются
const ciGroupText = (cells, group) => group.map((s) => cells.get(s) ?? '').join('').replace(/[\s/|\\]+/g, '');

function ciCandidates(ix, r) {
  const no = lookupOf(r);
  if (no && ix.clsCode.has(no)) return [...ix.clsCode.get(no).keys()];
  return (r.options ?? []).map((o) => String(o.code));
}

// Код в значение реквизита: ключ варианта бланка или код справочника
function ciKey(ix, r, code) {
  const opts = (r.options ?? []).filter((o) => String(o.code) === code);
  if (opts.length) return { key: optKey(opts[0]), ok: true, ambiguous: opts.length > 1 };
  const no = lookupOf(r);
  if (no) {
    if (!ix.clsCode.has(no)) return { key: `|${code}`, ok: true, unverified: true };
    if (ix.clsCode.get(no).has(code)) return { key: `|${code}`, ok: true };
  }
  return { key: `|${code}`, ok: false };
}

// Код наложения («2030») → коды вариантов («2000» + «0030»): разряды не пересекаются
function ciOverlayParts(code, candidates) {
  if (candidates.includes(code)) return [code];
  const need = nonzeroPositions(code);
  if (!need.length) return null;
  const usable = candidates.filter((c) => c.length === code.length).map((c) => ({ c, pos: nonzeroPositions(c) }))
    .filter((x) => x.pos.length && x.pos.every((i) => x.c[i] === code[i]))
    .sort((a, b) => b.pos.length - a.pos.length);
  const walk = (covered, chosen) => {
    const gap = need.find((i) => !covered.has(i));
    if (gap === undefined) return chosen;
    for (const u of usable) {
      if (!u.pos.includes(gap) || u.pos.some((i) => covered.has(i))) continue;
      const res = walk(new Set([...covered, ...u.pos]), [...chosen, u.c]);
      if (res) return res;
    }
    return null;
  };
  return walk(new Set(), []);
}

// двузначный год: не позже следующего года – 20xx, иначе 19xx (дата рождения ДД.ММ.ГГ в ф. 2)
const ciYear = (yy) => (Number(yy) <= (Number(todayIso().slice(2, 4)) + 1) ? `20${yy}` : `19${yy}`);

function ciDateIso(digits, format) {
  const d = String(digits ?? '').replace(/\D/g, '');
  let y; let m; let day; let hh = null;
  if (format === 'DDMMYY' && d.length === 6) [day, m, y] = [d.slice(0, 2), d.slice(2, 4), ciYear(d.slice(4))];
  else if (format === 'DDMMYYYY' && d.length === 8) [day, m, y] = [d.slice(0, 2), d.slice(2, 4), d.slice(4)];
  else if (d.length >= 8) { [y, m, day] = [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)]; if (d.length >= 10) hh = d.slice(8, 10); } else if (d.length === 6) [y, m, day] = [ciYear(d.slice(0, 2)), d.slice(2, 4), d.slice(4, 6)];
  else return null;
  if (Number(m) < 1 || Number(m) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  return { iso: `${y}-${m}-${day}`, hh };
}

// Коды реквизита из клеток: group – тексты групп клеток
function ciCodes(ix, r, texts, notes) {
  const select = r.input?.select;
  const cands = ciCandidates(ix, r);
  const out = [];
  const keyOf = (code) => {
    const k = ciKey(ix, r, code);
    if (!k.ok) notes.push(`код ${code} не найден среди вариантов реквизита`);
    if (k.ambiguous) notes.push(`код ${code} встречается в реквизите несколько раз – проверьте вариант`);
    return k.key;
  };
  for (const raw of texts) {
    if (select === 'overlay' || select === 'overlay_slots') {
      const parts = ciOverlayParts(raw, cands);
      if (!parts) { notes.push(`код ${raw} не раскладывается на варианты реквизита`); out.push(`|${raw}`); continue; }
      out.push(...parts.map(keyOf));
    } else {
      let code = raw;
      if (!cands.includes(code)) {
        const padded = cands.find((c) => c.length > code.length && c === code.padStart(c.length, '0'));
        if (padded) code = padded;
      }
      out.push(keyOf(code));
    }
  }
  return out;
}

function ciPrimaryFact(ix, form, r) {
  const mp = ix.mapping.get(form)?.get(r.id);
  return mp?.value_from ?? mp?.value_hint_from ?? null;
}

const ciFactOk = (ix, fid) => Boolean(fid) && (ix.facts.has(fid) || /^fact\.f/.test(fid));

function ciQualText(slots) {
  const lines = [...slots.keys()].sort((a, b) => a - b).map((line) => {
    const s = slots.get(line);
    if (!s.article) return null;
    const art = s.asign ? `${s.article}.${s.asign}` : s.article;
    const part = s.part ? (s.psign ? `${s.part}.${s.psign}` : s.part) : '';
    const letters = [...String(s.points ?? '')].filter((x) => /\p{L}/u.test(x));
    const pts = letters.map((x, i) => `«${x}${i === 0 && s.point_sign ? `.${s.point_sign}` : ''}»`);
    return `${pts.length ? `${pts.length > 1 ? 'пп.' : 'п.'} ${pts.join(', ')} ` : ''}${part ? `ч. ${part} ` : ''}ст. ${art} УК РФ`;
  }).filter(Boolean);
  return lines.join(', ');
}

// Реквизиты карточки из прочитанных клеток: строки «реквизит – что переносится»
export function cardValues(ix, form, layout, read) {
  const { cells, texts = {} } = read;
  const reqs = ix.reqs.get(form);
  const mode = modeRequisite(ix, form)?.req ?? null;
  const rows = [];
  for (const field of layout.fields ?? []) {
    const r = reqs?.get(field.requisite);
    if (!r) continue;
    // notes – сомнения чтения (по умолчанию не переносится), hints – справка для проверки
    const row = { id: r.id, number: r.number, label: r.label, entries: [], fills: {}, notes: [], hints: [], raw: [], skip: null };
    const put = (fid, value, label = null) => {
      if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return;
      row.entries.push({ fact: fid, value, label });
    };
    const groupsOf = (g) => (g ?? []).map((x) => ciGroupText(cells, x));
    const fid = ciPrimaryFact(ix, form, r);
    if (!field.parts) {
      const gt = groupsOf(field.groups);
      const filled = gt.filter(Boolean);
      if (!filled.length) continue;
      row.raw = filled;
      const ft = ix.facts.get(fid)?.type ?? null;
      if (r.field_type === 'date' || ft === 'date') {
        const d = gt.length === 1 ? ciDateIso(gt[0], gt[0].length === 6 ? 'YYMMDD' : 'YYYYMMDD')
          : ciDateIso(`${gt[0].length === 2 ? ciYear(gt[0]) : gt[0]}${gt[1] ?? ''}${gt[2] ?? ''}`);
        if (!d) row.notes.push(`дата «${filled.join('.')}» не разобрана`);
        put(fid, d?.iso ?? null);
      } else if (ft ? ['enum', 'classifier'].includes(ft) || (ft === 'text' && lookupOf(r)) : (r.options?.length || lookupOf(r)) && r.fills_by !== 'registrar') {
        const codeLen = Math.max(0, ...ciCandidates(ix, r).map((c) => c.length));
        const fillSpecs = r.input?.fills ?? [];
        let codeTexts = filled;
        if (r.input?.select !== 'multiple' && r.input?.select !== 'overlay' && filled.length > 1 && filled.every((t) => t.length < codeLen)) {
          codeTexts = [filled.join('')]; // один код на несколько групп (ОКАТО 2-3-3-3)
        } else if (fillSpecs.length) {
          // ряды «код – сумма» (р. 25 ф. 1): короткие группы – коды, длинные – суммы при своем коде
          codeTexts = [];
          let last = null;
          gt.forEach((t, i) => {
            if (!t) return;
            if ((field.groups[i]?.length ?? 0) <= Math.max(codeLen, 1) + 1) { codeTexts.push(t); last = t; return; }
            const si = fillSpecs.findIndex((f) => [f.for_code, ...(f.for_codes ?? [])].includes(last));
            if (si >= 0) row.fills[si] = t;
          });
        }
        put(fid, ciCodes(ix, r, codeTexts, row.notes));
      } else {
        put(fid, filled.join(''));
      }
    } else {
      const slots = new Map();
      const words = [];
      field.parts.forEach((part, i) => {
        const gt = groupsOf(part.groups);
        const joined = gt.join('');
        const text = texts[`${field.requisite}|${i}`] ?? '';
        if (joined) row.raw.push(joined);
        if (part.role === 'code' && gt.some(Boolean)) {
          if (ix.facts.get(fid)?.type === 'text' && !lookupOf(r)) { if (!row.entries.some((e) => e.fact === fid)) put(fid, gt.join('')); } else put(fid, ciCodes(ix, r, gt.filter(Boolean), row.notes));
        }
        else if (part.role === 'date' && joined) {
          const d = ciDateIso(joined, part.format === 'DDMMYY' ? 'DDMMYY' : 'YYYYMMDD');
          if (!d) { row.notes.push(`дата «${joined}» не разобрана`); return; }
          const target = (part.facts ?? []).find((x) => ciFactOk(ix, x));
          if (part.date_fill !== undefined) row.fills[part.date_fill] = isoToRu(d.iso);
          else put(target ?? fid, d.iso, target && target !== fid ? 'дата' : null);
          if (d.hh && part.time_fill !== undefined) row.fills[part.time_fill] = `${d.hh}:00`;
        } else if (part.role === 'fill' && joined) row.fills[part.index] = joined;
        else if (part.role === 'fact' && joined) {
          const target = (part.facts ?? []).find((x) => ciFactOk(ix, x));
          const fo = target && ['enum', 'classifier'].includes(ix.facts.get(target)?.type) ? factOptions(ix, target) : null;
          if (target && fo) put(target, ciCodes(ix, fo.requisite, [joined], row.notes));
          else if (target) put(target, joined, part.lead_number ? 'номер' : null);
          if (part.lead_number) row.hints.push('в клетках бланка – только номер до букв: проверьте полный номер');
        } else if (part.role === 'qual') {
          if (!joined) return;
          const line = part.line ?? 0;
          if (!slots.has(line)) slots.set(line, {});
          slots.get(line)[part.slot] = joined;
        } else if (part.role === 'text' && text) {
          if (part.word !== undefined) words.push(text); else put(fid, text);
          row.raw.push(text);
        } else if (part.role === 'codes_text' && text) {
          put(fid, ciCodes(ix, r, text.split(/[\s,;]+/).filter(Boolean), row.notes));
          row.raw.push(text);
        } else if (part.role === 'date_text' && text) {
          const dm = /(\d{2})\.?(\d{2})\.?(\d{4})/.exec(text);
          if (dm) put((part.facts ?? []).find((x) => ciFactOk(ix, x)) ?? fid, `${dm[3]}-${dm[2]}-${dm[1]}`);
          row.raw.push(text);
        } else if (part.role === 'code_rows') {
          (part.groups ?? []).forEach((g, k) => {
            const code = ciGroupText(cells, g);
            if (!code) return;
            put(fid, ciCodes(ix, r, [code], row.notes));
            const sum = part.fills?.[k] ? ciGroupText(cells, part.fills[k]) : '';
            const si = (r.input?.fills ?? []).findIndex((f) => [f.for_code, ...(f.for_codes ?? [])].includes(code));
            if (sum && si >= 0) row.fills[si] = sum;
          });
        }
      });
      if (slots.size) put(fid, ciQualText(slots));
      if (words.length) put(fid, words.join(' '));
      // коды одного реквизита из нескольких частей – одним списком
      const codeEntries = row.entries.filter((e) => e.fact === fid && Array.isArray(e.value));
      if (codeEntries.length > 1) {
        row.entries = row.entries.filter((e) => !codeEntries.includes(e));
        row.entries.unshift({ fact: fid, value: codeEntries.flatMap((e) => e.value), label: null });
      }
    }
    if (!row.entries.length && !Object.keys(row.fills).length) continue;
    if (CARD_SKIP_FILLS_BY.has(r.fills_by)) row.skip = 'заполняет не следователь';
    else if (r.id === mode) row.skip = 'задается видом новой карточки (учесть, изменить, снять)';
    for (const e of row.entries) {
      if (!e.fact) { row.skip ??= 'сведение не переносится между карточками'; continue; }
      e.scope = scopeOf(ix, e.fact);
      e.display = Array.isArray(e.value) || r.field_type === 'date' || /^\d{4}-\d{2}-\d{2}$/.test(String(e.value)) ? displayOf(ix, r, e.value) : String(e.value);
    }
    row.scope = row.entries.find((e) => e.fact)?.scope ?? 'card';
    row.display = [...row.entries.map((e) => (e.label ? `${e.label}: ${e.display}` : e.display)),
      ...Object.entries(row.fills).map(([i, v]) => `${r.input?.fills?.[i]?.label ?? 'поле'}: ${v}`)].filter(Boolean).join('; ');
    row.confidence = row.notes.length ? 'low' : 'high';
    rows.push(row);
  }
  // стадия (р. 16 ф. 1): квалификация в карточке без ст. 30 – восстанавливается по коду стадии
  const qual = rows.flatMap((r) => r.entries).find((e) => e.fact === 'fact.crime.qualification');
  const stage = rows.flatMap((r) => r.entries).find((e) => e.fact === 'fact.crime.attempt');
  if (qual && stage && !/ст\.\s*30\b/.test(qual.value)) {
    const code = keyCode(stage.value?.[0] ?? '');
    if (code === '1' || code === '2') {
      qual.value = `ч. ${code === '1' ? '1' : '3'} ст. 30, ${qual.value}`;
      qual.display = qual.value;
      const row = rows.find((r) => r.entries.includes(qual));
      row.display = row.entries.map((e) => (e.label ? `${e.label}: ${e.display}` : e.display)).join('; ');
    }
  }
  return rows;
}

// ---------- файл карточки целиком ----------

// Прочитать карточку: kind docx | pdf; blanks – [{ form, layout, xml }] (чистые бланки и карты),
// pdfPositions – { форма: координаты }
export async function readCardFile(ix, name, bytes, { blanks, pdfPositions = {} }) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const isPdf = u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46;
  const isZip = u8[0] === 0x50 && u8[1] === 0x4b;
  if (!isPdf && !isZip) {
    const ole = u8[0] === 0xd0 && u8[1] === 0xcf;
    throw new Error(ole ? 'Карточка в старом формате Word (.doc): откройте ее в Word и сохраните как .docx или PDF' : 'Карточку можно загрузить файлом Word (.docx) или PDF');
  }
  if (isZip) {
    const entries = readZip(u8);
    const sheetEntry = entries.find((e) => e.name === XLSX_SHEET);
    if (sheetEntry) {
      const b = blanks.find((x) => x.layout.kind === 'xlsx');
      const sharedEntry = entries.find((e) => e.name === 'xl/sharedStrings.xml');
      const sheet = await entryText(sheetEntry);
      const shared = sharedEntry ? await entryText(sharedEntry) : '';
      const title = ix.forms.get(b?.form)?.title ?? '';
      const own = b && ciSpaces(shared + sheet).toUpperCase().includes(ciSpaces(title).toUpperCase().slice(0, 30));
      if (!own) throw new Error('Книга Excel не похожа на бланк ф. 3 редакции 2026: карточку можно загрузить файлом Word, PDF или книгой ф. 3');
      const read = xlsxCardCells(sheet, shared, b, b.layout);
      return { name, kind: 'xlsx', form: b.form, rows: cardValues(ix, b.form, b.layout, read), match: null };
    }
    const xml = await ciDocumentXml(u8);
    const b = cardFormOfDocx(xml, blanks, ix.forms);
    if (!b) throw new Error('Файл Word не похож на бланк карточки этой редакции: число мест для кодов не совпадает ни с одним бланком. Карточка должна быть заполнена на бланке ИЦ редакции 2026');
    const read = docxCardCells(xml, b.xml, b.layout);
    return { name, kind: 'docx', form: b.form, rows: cardValues(ix, b.form, b.layout, read), match: null };
  }
  const ex = await pdfTextChunks(u8, { keepSpaces: true });
  if (!ex.chunks.some((c) => c.text.trim())) throw new Error('В PDF нет текстового слоя (скан или фото). Загрузите файл Word или PDF, сохраненный из Word');
  // печатная копия программы: заголовок «(форма № …, ред. 2026)»
  const copies = appCopySheets(ex, ix, Object.fromEntries(blanks.map((b) => [b.form, b.layout])));
  if (copies.length) {
    const cp = copies.find((x) => x.rows > 0 && x.cells.size + Object.keys(x.texts).length > 0) ?? copies[0];
    const b = blanks.find((x) => x.form === cp.form);
    const rows = cardValues(ix, cp.form, b.layout, cp);
    for (const n of cp.problems) {
      const r = rows.find((x) => x.number === n);
      if (r) { r.notes.push('клетки строки не разобраны – проверьте значение'); r.confidence = 'low'; }
    }
    return { name, kind: 'copy', form: cp.form, rows, match: { sheets: copies.length, rows: cp.rows, problems: cp.problems } };
  }
  ex.chunks = ex.chunks.filter((c) => c.text.trim());
  const all = ex.chunks.map((c) => c.text).join(' ').toUpperCase().replace(/\s+/g, ' ');
  let best = null;
  for (const b of blanks) {
    const pos = pdfPositions[b.form];
    if (!pos) continue;
    const title = ix.forms.get(b.form)?.title;
    const read = pdfCardCells(ex, pos);
    const titled = title && all.includes(ciSpaces(title).toUpperCase().slice(0, 30));
    const score = read.match.share + (titled ? 0.5 : 0) + (ex.pages.length === pos.pages.length ? 0.1 : 0);
    if (!best || score > best.score) best = { b, read, score };
  }
  if (!best || best.read.match.share < 0.35) {
    throw new Error('PDF не совпадает с бланком карточки: номера реквизитов не на своих местах. Подходит PDF, сохраненный из Word с бланка ИЦ редакции 2026, или PDF печатной копии этой программы версии 0.12 и новее (не скан)');
  }
  return { name, kind: 'pdf', form: best.b.form, rows: cardValues(ix, best.b.form, best.b.layout, best.read), match: best.read.match };
}

// ---------- решения и перенос в дело ----------

// По умолчанию переносится все, что относится к следователю; из карточки другого дела – без
// номера дела, КРСП и даты возбуждения (они свои у нового дела)
export function cardImportDefaults(res, { sameCase = false } = {}) {
  const rows = {};
  for (const r of res.rows) {
    const caseId = r.entries.some((e) => CARD_CASE_IDS.has(e.fact));
    rows[r.id] = { accept: !r.skip && r.confidence !== 'low' && (sameCase || !caseId) };
  }
  return { sameCase, rows, replace: false };
}

// Расхождения с уже внесенными сведениями (дело, эпизод): { number, label, was, now }
export function cardImportConflicts(ix, c, res, decisions, { crime = null } = {}) {
  const out = [];
  const crimeObj = crime && crime !== 'new' ? c.crimes.find((x) => x.id === crime) : null;
  for (const r of res.rows) {
    if (!decisions.rows[r.id]?.accept) continue;
    for (const e of r.entries) {
      const cont = e.fact?.startsWith('fact.damage.') ? c.damage : e.scope === 'case' ? c.case : e.scope === 'crime' ? crimeObj : null;
      if (!cont) continue;
      const cur = factAt(c, cont, e.fact);
      if (cur?.status === 'answered' && JSON.stringify(cur.value) !== JSON.stringify(e.value)) {
        out.push({ number: r.number, label: r.label, was: cur.value, now: e.value, fact: e.fact });
      }
    }
  }
  return out;
}

// Перенос в дело. target: { crime: id | 'new', person и victim: id | 'new' | null, event: id | 'manual',
// form, variant, of – объекты карточки } – какая карточка готовится; profile – профиль органа
// (коды из профиля не затираются)
export function applyCardImport(ix, c, res, decisions, target = {}, profile = {}) {
  const log = { set: [], kept: [], crime: null, person: null, event: null, card: null, cardFacts: 0, skipped: [] };
  const form = target.form ?? res.form;
  let crime = target.crime && target.crime !== 'new' ? c.crimes.find((x) => x.id === target.crime) : null;
  if (!crime) {
    // пустой эпизод (без сведений и событий) занимается первым
    crime = c.crimes.find((x) => !Object.keys(x.facts ?? {}).length && !c.events.some((e) => e.refs.crimes.includes(x.id))) ?? addObject(c, 'crime');
  }
  log.crime = crime.id;
  let person = null;
  if (target.person === 'new') person = addObject(c, 'person', { crimes: [crime.id] });
  else if (target.person) {
    person = c.persons.find((x) => x.id === target.person) ?? null;
    if (person && !person.crimes.includes(crime.id)) person.crimes.push(crime.id);
  }
  log.person = person?.id ?? null;
  let victim = null;
  if (target.victim === 'new') victim = addObject(c, 'victim', { crimes: [crime.id] });
  else if (target.victim) victim = c.victims.find((x) => x.id === target.victim) ?? null;
  const set = (cont, fid, value) => {
    const cur = factAt(c, cont, fid);
    if (cur?.status === 'answered' && JSON.stringify(cur.value) === JSON.stringify(value)) return;
    if (cur?.status === 'answered' && !decisions.replace) { log.kept.push(fid); return; }
    setFactVersion(c, cont, fid, 'answered', value, null);
    log.set.push(fid);
  };
  // событие и карточка: выбранное событие дела или «одна карточка (без события)»
  let ev = target.event && target.event !== 'manual' ? getEvent(c, target.event) : null;
  if (!ev) {
    ev = addEvent(c, { type: 'ev.manual', date: target.date ?? todayIso(), refs: { crimes: [crime.id], persons: person ? [person.id] : [], victims: [] } });
  }
  log.event = ev.id;
  const wantOf = { crime: crime.id, ...(person ? { person: person.id } : {}), ...(victim ? { victim: victim.id } : {}) };
  let card = activeCards(ev).find((k) => k.form === form && (k.variant ?? null) === (target.variant ?? null)
    && (!k.of.crime || k.of.crime === crime.id) && (!person || !k.of.person || k.of.person === person.id));
  if (!card && target.card !== false) {
    const of = {};
    const per = target.of ?? ['crime', ...(person ? ['person'] : [])];
    for (const k of per) if (wantOf[k]) of[k] = wantOf[k];
    card = addCardManually(ix, c, ev, { form, variant: target.variant ?? null, of });
  }
  log.card = card?.key ?? null;
  const fromProfile = new Set(profileFillsOf(ix, form, profile).map((f) => `${f.key}#${f.index}`));
  for (const r of res.rows) {
    if (!decisions.rows[r.id]?.accept || r.skip) continue;
    for (const e of r.entries) {
      if (!e.fact) continue;
      if (e.fact.startsWith('fact.damage.')) set(c.damage, e.fact, e.value);
      else if (e.scope === 'case') set(c.case, e.fact, e.value);
      else if (e.scope === 'crime') set(crime, e.fact, e.value);
      else if (e.scope === 'person') { if (person) set(person, e.fact, e.value); else log.skipped.push(r.number); } else if (e.scope === 'victim') {
        if (victim) set(victim, e.fact, e.value); else log.skipped.push(r.number);
      } else if (e.scope === 'card') {
        // реквизиты, свои у формы (fact.f1.*), переносятся только в карточку той же формы
        if (!card || form !== res.form) { log.skipped.push(r.number); continue; }
        setFactVersion(c, card, e.fact, 'answered', e.value, ev.id);
        log.cardFacts += 1;
      } else log.skipped.push(r.number);
    }
    const fills = Object.entries(r.fills);
    if (!fills.length) continue;
    if (!card || form !== res.form) { if (!log.skipped.includes(r.number)) log.skipped.push(r.number); continue; }
    const k = `${form}|${r.id}`;
    card.fills ??= {};
    card.fills[k] ??= {};
    for (const [i, v] of fills) {
      if (fromProfile.has(`${k}#${i}`)) continue;
      card.fills[k][i] = v;
      log.cardFacts += 1;
    }
  }
  return log;
}
