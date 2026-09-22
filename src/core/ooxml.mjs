// Точечная правка word/document.xml эталонного бланка (Фаза 1.6, FR-40).
// Правило: меняется только содержимое того места, куда вписывается значение. Свойства абзаца и
// шрифта берутся из самого бланка, остальной XML не переписывается. Разбор – сканером по строке,
// без пересборки дерева, чтобы файл отличался от эталона только вписанным текстом.

// Места бланка бывают в двух видах: старые фигуры VML (<v:rect>) и новые фигуры DrawingML
// (<wps:wsp>). В бланках последних лет обе записи лежат рядом: <mc:Choice> с DrawingML и
// <mc:Fallback> с VML. Word печатает DrawingML, поэтому значение вписывается в него, а копия
// в <mc:Fallback> помечается и не используется.
const SHAPE_TAGS = ['v:rect', 'v:shape', 'v:roundrect', 'wps:wsp'];

export function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Границы элемента, начинающегося в позиции start (учитывает вложенность и самозакрытие).
export function elementRange(xml, start) {
  const name = /^<([\w:.-]+)/.exec(xml.slice(start, start + 40))?.[1];
  if (!name) throw new Error('Не удалось определить имя элемента');
  const open = xml.indexOf('>', start);
  if (open < 0) throw new Error(`Не закрыт тег ${name}`);
  if (xml[open - 1] === '/') return { name, start, end: open + 1, selfClosing: true, inner: null };
  let depth = 1;
  let p = open + 1;
  const reOpen = new RegExp(`<${escapeRe(name)}(?=[\\s/>])`, 'g');
  const reClose = new RegExp(`</${escapeRe(name)}>`, 'g');
  while (depth > 0) {
    reOpen.lastIndex = p;
    reClose.lastIndex = p;
    const o = reOpen.exec(xml);
    const c = reClose.exec(xml);
    if (!c) throw new Error(`Не найден закрывающий тег ${name}`);
    if (o && o.index < c.index) {
      const oEnd = xml.indexOf('>', o.index);
      if (xml[oEnd - 1] !== '/') depth += 1;
      p = oEnd + 1;
    } else {
      depth -= 1;
      p = c.index + c[0].length;
      if (depth === 0) return { name, start, end: p, selfClosing: false, inner: [open + 1, c.index] };
    }
  }
  throw new Error(`Не разобран элемент ${name}`);
}

// Все фигуры бланка в порядке документа. Место в карте раскладки задается порядковым номером
// фигуры, а не ее идентификатором: в бланках, пересохраненных из .doc, идентификаторы фигур
// повторяются («Rectangle 36» встречается не один раз). Порядок фигур неизменен, пока неизменен
// сам бланк, а он закреплен контрольной суммой (FR-40).
export function shapes(xml) {
  const re = new RegExp(`<(${SHAPE_TAGS.map(escapeRe).join('|')})(?=[\\s>/])|<mc:Fallback>|</mc:Fallback>`, 'g');
  const out = [];
  let fallback = 0;
  let m = re.exec(xml);
  while (m) {
    if (m[0] === '<mc:Fallback>') { fallback += 1; m = re.exec(xml); continue; }
    if (m[0] === '</mc:Fallback>') { fallback -= 1; m = re.exec(xml); continue; }
    const head = xml.slice(m.index, xml.indexOf('>', m.index) + 1);
    out.push({ index: out.length, start: m.index, tag: m[1],
      kind: m[1] === 'wps:wsp' ? 'dml' : 'vml',
      fallback: fallback > 0,
      id: /\sid="([^"]*)"/.exec(head)?.[1] ?? null,
      spid: /\so:spid="([^"]*)"/.exec(head)?.[1] ?? null,
      picture: /\stype="#_x0000_t75"/.test(head) });
    m = re.exec(xml);
  }
  return out;
}

// Место фигуры по ее порядковому номеру в бланке.
export function findShape(xml, index) {
  const all = shapes(xml);
  const shape = all[index];
  if (!shape) throw new Error(`В бланке нет фигуры № ${index}`);
  return elementRange(xml, shape.start);
}

function firstTag(xml, tag, from, to) {
  const re = new RegExp(`<${escapeRe(tag)}(?=[\\s/>])`, 'g');
  re.lastIndex = from;
  const m = re.exec(xml);
  return m && m.index < to ? m.index : -1;
}

// Абзац с текстом по образцу уже заполненного места бланка.
function paragraph(xml, inner, text) {
  let pPr = '';
  let rPr = '';
  const p = firstTag(xml, 'w:p', inner[0], inner[1]);
  if (p >= 0 && !elementRange(xml, p).selfClosing) {
    const range = elementRange(xml, p);
    const body = xml.slice(range.inner[0], range.inner[1]);
    pPr = /^<w:pPr>[\s\S]*?<\/w:pPr>/.exec(body)?.[0] ?? '';
    const run = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/.exec(body);
    rPr = run ? (/^<w:rPr>[\s\S]*?<\/w:rPr>/.exec(run[1])?.[0] ?? '') : '';
    if (!rPr) rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(pPr)?.[0] ?? '';
  }
  const t = text === '' ? '' : `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  return `<w:p>${pPr}${t}</w:p>`;
}

const TEXTBOX_OPEN = '<v:textbox inset="1pt,1pt,1pt,1pt"><w:txbxContent>';
const TEXTBOX_CLOSE = '</w:txbxContent></v:textbox>';
const DEFAULT_PARA = (text, size) =>
  `<w:p><w:pPr><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:rPr><w:sz w:val="${size}"/></w:rPr></w:pPr>`
  + (text === '' ? '' : `<w:r><w:rPr><w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`)
  + '</w:p>';

// Текст, напечатанный в фигуре (для сверки бланка и вычистки образцов).
export function shapeText(xml, index) {
  const range = findShape(xml, index);
  if (range.selfClosing) return '';
  const body = xml.slice(range.inner[0], range.inner[1]);
  return [...body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join('')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&').trim();
}

// Вписать значение в фигуру (по порядковому номеру или по готовому диапазону).
// Если надписи в фигуре нет, она добавляется по образцу бланка.
// У фигуры DrawingML поля надписи по умолчанию – 0,1 дюйма с каждой стороны; в клетке кода
// шириной 7,2 пункта при таких полях места для знака не остается и Word его не печатает.
// Поэтому у мест, куда вписывается значение, поля обнуляются.
function zeroInsets(xml, range) {
  const re = /<(wps:bodyPr|a:bodyPr)\b[^>]*>/g;
  re.lastIndex = range.start;
  const m = re.exec(xml);
  if (!m || m.index > range.end) return xml;
  const cleaned = m[0].replace(/\s(?:lIns|tIns|rIns|bIns)="[^"]*"/g, '')
    .replace(`<${m[1]}`, `<${m[1]} lIns="0" tIns="0" rIns="0" bIns="0"`);
  if (cleaned === m[0]) return xml;
  return xml.slice(0, m.index) + cleaned + xml.slice(m.index + m[0].length);
}

export function setShapeText(xml, where, text, { size = 18, force = false } = {}) {
  const range = typeof where === 'number' ? findShape(xml, where) : where;
  if (range.selfClosing) {
    const head = xml.slice(range.start, range.end - 2);
    return xml.slice(0, range.start) + `${head}>${TEXTBOX_OPEN}${DEFAULT_PARA(text, size)}${TEXTBOX_CLOSE}</${range.name}>`
      + xml.slice(range.end);
  }
  const box = xml.indexOf('<w:txbxContent>', range.start);
  if (range.name === 'wps:wsp') {
    const zeroed = zeroInsets(xml, range);
    if (zeroed !== xml) return setShapeText(zeroed, findShape(zeroed, shapes(zeroed).findIndex((s) => s.start === range.start)), text, { size, force });
  }
  if (range.name === 'wps:wsp' && (box < 0 || box > range.end)) {
    // У фигуры DrawingML нет надписи – она добавляется перед свойствами текста (<wps:bodyPr>),
    // как это делает сам Word.
    const at = xml.indexOf('<wps:bodyPr', range.start);
    if (at < 0 || at > range.end) throw new Error('В фигуре бланка нет места для надписи');
    return xml.slice(0, at) + `<wps:txbx><w:txbxContent>${DEFAULT_PARA(text, size)}</w:txbxContent></wps:txbx>`
      + xml.slice(at);
  }
  if (box >= 0 && box < range.end) {
    const content = elementRange(xml, box);
    const body = force ? DEFAULT_PARA(text, size) : paragraph(xml, content.inner, text);
    return xml.slice(0, content.inner[0]) + body + xml.slice(content.inner[1]);
  }
  // В бланк входят и рисунки (герб, штрих-код): надпись к ним добавлять нельзя – Word такой
  // файл не открывает. Заполняются только места для значений.
  if (xml.slice(range.start, range.end).includes('<v:imagedata')) {
    throw new Error('Нельзя вписать значение в рисунок бланка');
  }
  // В бланке встречается пустая надпись без содержимого («<v:textbox …/>»). Вторую надпись
  // в такую фигуру добавлять нельзя – Word отказывается открывать файл, – поэтому пустая
  // заменяется на такую же, но с абзацем.
  const empty = xml.indexOf('<v:textbox', range.start);
  if (empty >= 0 && empty < range.end) {
    const el = elementRange(xml, empty);
    const head = el.selfClosing ? `${xml.slice(el.start, el.end - 2)}>` : xml.slice(el.start, xml.indexOf('>', el.start) + 1);
    return xml.slice(0, el.start) + `${head}<w:txbxContent>${DEFAULT_PARA(text, size)}</w:txbxContent></v:textbox>`
      + xml.slice(el.end);
  }
  const tail = xml.lastIndexOf(`</${range.name}>`, range.end);
  return xml.slice(0, tail) + `${TEXTBOX_OPEN}${DEFAULT_PARA(text, size)}${TEXTBOX_CLOSE}` + xml.slice(tail);
}

// Ячейка таблицы (бланки ИПК): номера таблицы, строки и ячейки в порядке документа.
export function findTableCell(xml, { table, row, cell }) {
  let p = 0;
  for (let i = 0; i <= table; i += 1) {
    p = xml.indexOf('<w:tbl>', i === 0 ? 0 : p + 1);
    if (p < 0) throw new Error(`В бланке нет таблицы ${table}`);
    if (i === table) break;
  }
  const tbl = elementRange(xml, p);
  let q = tbl.inner[0];
  for (let i = 0; i <= row; i += 1) {
    q = xml.indexOf('<w:tr', q);
    if (q < 0 || q > tbl.inner[1]) throw new Error(`В таблице ${table} нет строки ${row}`);
    const tr = elementRange(xml, q);
    if (i === row) {
      let c = tr.inner[0];
      for (let j = 0; j <= cell; j += 1) {
        c = xml.indexOf('<w:tc>', c);
        if (c < 0 || c > tr.inner[1]) throw new Error(`В строке ${row} таблицы ${table} нет ячейки ${cell}`);
        const tc = elementRange(xml, c);
        if (j === cell) return tc;
        c = tc.end;
      }
    }
    q = tr.end;
  }
  throw new Error(`Не найдена ячейка ${table}/${row}/${cell}`);
}

export function cellText(xml, path) {
  const tc = findTableCell(xml, path);
  const body = xml.slice(tc.inner[0], tc.inner[1]);
  return [...body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(' ').trim();
}

// Вписать значение в ячейку таблицы: первый абзац ячейки, свойства абзаца сохраняются.
export function setCellText(xml, path, text, { size = null } = {}) {
  const tc = findTableCell(xml, path);
  const p = firstTag(xml, 'w:p', tc.inner[0], tc.inner[1]);
  if (p < 0) throw new Error('В ячейке нет абзаца');
  const range = elementRange(xml, p);
  let para = range.selfClosing ? `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
    : paragraph(xml, range.inner, text);
  // пустая ячейка бланка часто хранит служебный шрифт абзаца (Courier New): значение печатается
  // шрифтом бланка Times New Roman
  para = withRunSize(para, size ?? 20, 'Times New Roman');
  return xml.slice(0, range.start) + para + xml.slice(range.end);
}

// размер шрифта впечатанного текста (в полупунктах): длинное значение не должно раздвигать строку бланка
function withRunSize(para, size, font = null) {
  return para.replace(/<w:r>(<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t/, (m, rPr) => {
    let base = (rPr ?? '<w:rPr></w:rPr>').replace(/<w:sz(?:Cs)? w:val="\d+"\/>/g, '');
    if (font) base = base.replace(/<w:rFonts [^>]*\/>/g, '').replace('<w:rPr>', `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>`);
    return `<w:r>${base.replace('</w:rPr>', `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`)}<w:t`;
  });
}

// Убрать фрагмент текста внутри места бланка (вычистка образцов заполнения, риск П-8).
// Текст может быть разбит на несколько прогонов, поэтому фрагмент ищется в собранной строке,
// а удаляется из тех прогонов, на которые он пришелся.
export function stripFragment(xml, range, fragment) {
  const parts = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  re.lastIndex = range.inner[0];
  let m = re.exec(xml);
  while (m && m.index < range.inner[1]) {
    const start = m.index + m[0].indexOf('>') + 1;
    parts.push({ start, end: start + m[1].length, text: m[1] });
    m = re.exec(xml);
  }
  const joined = parts.map((p) => p.text).join('');
  const at = joined.indexOf(fragment);
  if (at < 0) return null;
  let pos = 0;
  const edits = [];
  for (const part of parts) {
    const from = Math.max(at, pos);
    const to = Math.min(at + fragment.length, pos + part.text.length);
    if (to > from) edits.push({ start: part.start + (from - pos), end: part.start + (to - pos) });
    pos += part.text.length;
  }
  let out = xml;
  for (const e of edits.reverse()) out = out.slice(0, e.start) + out.slice(e.end);
  return out;
}

// Вписать значения сразу в несколько мест: [{ shape: № фигуры, text }]. Правки идут с конца
// документа, поэтому найденные позиции остальных фигур не сдвигаются.
export function fillShapes(xml, edits, opts = {}) {
  const all = shapes(xml);
  const list = [...edits].sort((a, b) => b.shape - a.shape);
  let out = xml;
  for (const edit of list) {
    const shape = all[edit.shape];
    if (!shape) throw new Error(`В бланке нет фигуры № ${edit.shape}`);
    out = setShapeText(out, elementRange(out, shape.start), edit.text, opts);
  }
  return out;
}

// Впечатать текст на линейку бланка («____») внутри ячейки таблицы (текстовые реквизиты).
// slot – номер линейки в ячейке (0 – первая), span – сколько линеек подряд занимает значение.
// Разметка бланка не должна сдвинуться (иначе бланк переходит на лишнюю страницу), поэтому:
// – из линейки убирается столько знаков подчеркивания, сколько знаков в тексте, остаток линейки
//   остается как в бланке;
// – текст длиннее линейки печатается уменьшенным шрифтом, чтобы уместиться в ее длину.
// Текст ставится отдельным прогоном с оформлением того прогона, где начиналась линейка.
// Абзац вне таблиц по его тексту (строки подписей руководителя и прокурора в ф. 1, 1.1, 4):
// берется самый вложенный абзац, в собранном тексте которого есть anchor
export function findParagraph(xml, anchor) {
  const rx = /<w:p[ >]/g;
  let m;
  while ((m = rx.exec(xml))) {
    const r = elementRange(xml, m.index);
    const inner = xml.slice(r.start, r.end);
    if (/<w:p[ >]/.test(inner.slice(4))) continue;
    const text = [...inner.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((x) => x[1]).join('');
    if (text.includes(anchor)) return { start: r.start, end: r.end, inner: [r.start, r.end] };
  }
  throw new Error(`В бланке нет абзаца «${anchor}»`);
}

const placeRange = (xml, path) => (path.anchor ? findParagraph(xml, path.anchor) : findTableCell(xml, path));

export function setUnderscoreText(xml, path, text, { slot = 0, span = 1, minHalfPoints = 11, boxes = false, size: fixedSize = null } = {}) {
  const tc = placeRange(xml, path);
  const parts = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  re.lastIndex = tc.inner[0];
  let m = re.exec(xml);
  while (m && m.index < tc.inner[1]) {
    const start = m.index + m[0].indexOf('>') + 1;
    parts.push({ start, end: start + m[1].length, text: m[1] });
    m = re.exec(xml);
  }
  const joined = parts.map((q) => q.text).join('');
  const lines = [...joined.matchAll(boxes ? SLOT_WITH_BOXES : /_{3,}/g)].map((x) => [x.index, x.index + x[0].length]);
  const chosen = lines.slice(slot, slot + span);
  if (!chosen.length) throw new Error(`В ячейке ${path.table}/${path.row}/${path.cell} нет линейки № ${slot + 1}`);
  const capacity = chosen.reduce((n, [a, b]) => n + b - a, 0);
  const value = String(text);
  let budget = Math.min(value.length, capacity);
  const remove = [];
  for (const [a, b] of chosen) {
    if (budget <= 0) break;
    const take = Math.min(budget, b - a);
    remove.push([a, a + take]);
    budget -= take;
  }
  const edits = [];
  let pos = 0;
  for (const q of parts) {
    for (const [a, b] of remove) {
      const from = Math.max(a, pos);
      const to = Math.min(b, pos + q.text.length);
      if (to > from) edits.push({ start: q.start + (from - pos), end: q.start + (to - pos) });
    }
    pos += q.text.length;
  }
  edits.sort((x, y) => y.start - x.start);
  const first = edits.at(-1);
  // оформление прогона, в котором начинается линейка
  const runStart = xml.lastIndexOf('<w:r>', first.start) > xml.lastIndexOf('<w:r ', first.start)
    ? xml.lastIndexOf('<w:r>', first.start) : xml.lastIndexOf('<w:r ', first.start);
  const rPr = /^<w:r\b[^>]*>(<w:rPr>[\s\S]*?<\/w:rPr>)?/.exec(xml.slice(runStart))?.[1] ?? '';
  const baseSize = Number(/<w:sz w:val="(\d+)"/.exec(rPr)?.[1] ?? 20);
  // размер задан картой бланка (р. 12 ф. 1 – 6 пт) или подбирается, чтобы текст уместился на линейках
  const size = fixedSize ?? (value.length > capacity ? Math.max(minHalfPoints, Math.floor(baseSize * capacity / value.length)) : baseSize);
  const ownPr = rPr
    ? rPr.replace(/<w:spacing w:val="[^"]*"\/>/, '').replace(/<w:sz w:val="\d+"\/>/, `<w:sz w:val="${size}"/>`).replace(/<w:szCs w:val="\d+"\/>/, `<w:szCs w:val="${size}"/>`)
      .replace(/<w:u w:val="[^"]*"\/>/, '')
    : `<w:rPr><w:sz w:val="${size}"/></w:rPr>`;
  const withSize = /<w:sz /.test(ownPr) ? ownPr : ownPr.replace('</w:rPr>', `<w:sz w:val="${size}"/></w:rPr>`);
  // если линейка идет сразу за наименованием («УЧЕБЫ____»), значение отделяется пробелом
  const before = joined[chosen[0][0] - 1] ?? ' ';
  const lead = /\s|["«“(]/.test(before) ? '' : ' ';
  let out = xml;
  for (const e of edits) {
    const insert = e === first
      ? `</w:t></w:r><w:r>${withSize}<w:t xml:space="preserve">${lead}${escapeXml(value)}</w:t></w:r><w:r>${rPr}<w:t xml:space="preserve">`
      : '';
    out = out.slice(0, e.start) + insert + out.slice(e.end);
  }
  return out;
}

// Заменить напечатанную подпись и линейку за ней значением: «Фамилия, подпись лица, ведущего
// расследование уголовного дела ______» → «Следователь … И.О. Фамилия» (замечание 22.09.2026).
// Остальной текст места (дата передачи карточки, «____» 20__ г.) остается как в бланке.
export function replaceCaption(xml, path, caption, text, { size = null } = {}) {
  const tc = placeRange(xml, path);
  const parts = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  re.lastIndex = tc.inner[0];
  let m = re.exec(xml);
  while (m && m.index < tc.inner[1]) {
    const start = m.index + m[0].indexOf('>') + 1;
    parts.push({ start, end: start + m[1].length, text: m[1] });
    m = re.exec(xml);
  }
  const joined = parts.map((q) => q.text).join('');
  const at = joined.indexOf(caption);
  if (at < 0) throw new Error(`В месте бланка нет надписи «${caption}»`);
  const tail = /^[\s_]*_+/.exec(joined.slice(at + caption.length));
  const end = at + caption.length + (tail ? tail[0].length : 0);
  const edits = [];
  let pos = 0;
  for (const q of parts) {
    const from = Math.max(at, pos);
    const to = Math.min(end, pos + q.text.length);
    if (to > from) edits.push({ start: q.start + (from - pos), end: q.start + (to - pos) });
    pos += q.text.length;
  }
  edits.sort((x, y) => y.start - x.start);
  const first = edits.at(-1);
  const runStart = Math.max(xml.lastIndexOf('<w:r>', first.start), xml.lastIndexOf('<w:r ', first.start));
  const rPr = /^<w:r\b[^>]*>(<w:rPr>[\s\S]*?<\/w:rPr>)?/.exec(xml.slice(runStart))?.[1] ?? '';
  let ownPr = (rPr || '<w:rPr></w:rPr>').replace(/<w:u w:val="[^"]*"\/>/, '');
  if (size) ownPr = ownPr.replace(/<w:sz(?:Cs)? w:val="\d+"\/>/g, '').replace('</w:rPr>', `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`);
  let out = xml;
  for (const e of edits) {
    const insert = e === first ? `</w:t></w:r><w:r>${ownPr}<w:t xml:space="preserve">${escapeXml(text)} </w:t></w:r><w:r>${rPr}<w:t xml:space="preserve">` : '';
    out = out.slice(0, e.start) + insert + out.slice(e.end);
  }
  return out;
}

// Вписать текст в пустой абзац ячейки (р. 1 ф. 1: первая строка ячейки без линейки)
// Текст в абзац № index ячейки: по умолчанию дописывается в конец абзаца; replace – прежние прогоны
// (например, табуляция линейки подписи) убираются, align – выравнивание абзаца, font – шрифт прогона
export function setCellParagraphText(xml, path, index, text, { size = null, font = null, replace = false, align = null } = {}) {
  const tc = placeRange(xml, path);
  let at = tc.inner[0];
  const rPr = `<w:rPr>${font ? `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>` : ''}${size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : ''}</w:rPr>`;
  for (let i = 0; i <= index; i++) {
    const p = xml.indexOf('<w:p', at);
    if (p < 0 || p > tc.inner[1]) throw new Error(`В ячейке нет абзаца № ${index + 1}`);
    if (i === index) {
      const r = elementRange(xml, p);
      const run = `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
      if (r.selfClosing) return xml.slice(0, r.start) + xml.slice(r.start, r.end - 2) + `>${run}</w:p>` + xml.slice(r.end);
      let para = xml.slice(r.start, r.end);
      if (replace) para = para.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g, '');
      if (align) {
        para = /<w:pPr>/.test(para)
          ? (/<w:jc /.test(para) ? para.replace(/<w:jc w:val="\w+"\/>/, `<w:jc w:val="${align}"/>`) : para.replace('</w:pPr>', `<w:jc w:val="${align}"/></w:pPr>`))
          : para.replace(/^(<w:p(?:\s[^>]*)?>)/, `$1<w:pPr><w:jc w:val="${align}"/></w:pPr>`);
      }
      para = para.slice(0, para.length - '</w:p>'.length) + run + '</w:p>';
      return xml.slice(0, r.start) + para + xml.slice(r.end);
    }
    at = elementRange(xml, p).end;
  }
  return xml;
}

// Дописать значение в ячейку таблицы после напечатанного наименования (бланк без линейки:
// «фамилия ……… 07 /»). Текст ставится отдельным прогоном в конце первого абзаца ячейки,
// с оформлением последнего прогона абзаца.
export function appendCellText(xml, path, text, { size = null } = {}) {
  const tc = findTableCell(xml, path);
  const p = firstTag(xml, 'w:p', tc.inner[0], tc.inner[1]);
  if (p < 0) throw new Error('В ячейке нет абзаца');
  const para = elementRange(xml, p);
  if (para.selfClosing) {
    const head = xml.slice(para.start, para.end - 2);
    return `${xml.slice(0, para.start)}${head}><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>${xml.slice(para.end)}`;
  }
  const body = xml.slice(para.inner[0], para.inner[1]);
  const runs = [...body.matchAll(/<w:r\b[^>]*>(<w:rPr>[\s\S]*?<\/w:rPr>)?/g)];
  // у наименования в бланке бывает разрядка и капитель – значение печатается без них
  let rPr = (runs.at(-1)?.[1] ?? '').replace(/<w:(?:smallCaps|caps|spacing)(?: w:val="[^"]*")?\/>/g, '');
  if (size) rPr = (rPr || '<w:rPr></w:rPr>').replace(/<w:sz(?:Cs)? w:val="\d+"\/>/g, '').replace('</w:rPr>', `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`);
  return `${xml.slice(0, para.inner[1])}<w:r>${rPr}<w:t xml:space="preserve">  ${escapeXml(text)}</w:t></w:r>${xml.slice(para.inner[1])}`;
}

// Вписать значение в начало ячейки (ячейка значения, в конце которой напечатан знак «/»).
export function prependCellText(xml, path, text, { size = null } = {}) {
  const tc = findTableCell(xml, path);
  const p = firstTag(xml, 'w:p', tc.inner[0], tc.inner[1]);
  if (p < 0) throw new Error('В ячейке нет абзаца');
  const para = elementRange(xml, p);
  if (para.selfClosing) return setCellText(xml, path, text, { size });
  const body = xml.slice(para.inner[0], para.inner[1]);
  const pPr = /^<w:pPr>[\s\S]*?<\/w:pPr>/.exec(body)?.[0] ?? '';
  const markPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(pPr)?.[0] ?? '';
  let rPr = markPr.replace(/<w:rFonts [^>]*\/>/g, '').replace(/<w:sz(?:Cs)? w:val="\d+"\/>/g, '');
  rPr = (rPr || '<w:rPr></w:rPr>').replace('<w:rPr>', '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>')
    .replace('</w:rPr>', `<w:sz w:val="${size ?? 20}"/><w:szCs w:val="${size ?? 20}"/></w:rPr>`);
  const at = para.inner[0] + pPr.length;
  return `${xml.slice(0, at)}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)} </w:t></w:r>${xml.slice(at)}`;
}

// Места бланка «!__!__!»: каждая пара подчеркиваний между «!» – клетка для одного знака
// (карта на иностранцев). Линейки и ряды таких клеток нумеруются подряд.
const SLOT_WITH_BOXES = /!(?:__!)+|_{3,}/g;

export function setBoxChars(xml, path, chars, { slot = 0 } = {}) {
  const tc = findTableCell(xml, path);
  const parts = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  re.lastIndex = tc.inner[0];
  let m = re.exec(xml);
  while (m && m.index < tc.inner[1]) {
    const start = m.index + m[0].indexOf('>') + 1;
    parts.push({ start, text: m[1] });
    m = re.exec(xml);
  }
  const joined = parts.map((q) => q.text).join('');
  const slots = [...joined.matchAll(SLOT_WITH_BOXES)];
  const target = slots[slot];
  if (!target || !target[0].startsWith('!')) throw new Error(`В ячейке ${path.table}/${path.row}/${path.cell} место № ${slot + 1} – не клетки`);
  const boxes = [...target[0].matchAll(/__/g)].map((b) => target.index + b.index);
  const list = String(chars).split('');
  if (list.length > boxes.length) throw new Error(`значение «${chars}» длиннее ряда клеток (${boxes.length})`);
  // позиция каждого знака собранной строки в XML (прогон может разбивать «__» на части);
  // подчеркивания клетки заменяются знаком и неразрывным пробелом
  const at = (index) => {
    let pos = 0;
    for (const q of parts) {
      if (index < pos + q.text.length) return q.start + (index - pos);
      pos += q.text.length;
    }
    return -1;
  };
  // знак в клетке – отдельный подчеркнутый прогон, чтобы у клетки осталась нижняя черта
  const underlined = (offset, len, text) => {
    const runStart = Math.max(xml.lastIndexOf('<w:r>', offset), xml.lastIndexOf('<w:r ', offset));
    const rPr = /^<w:r\b[^>]*>(<w:rPr>[\s\S]*?<\/w:rPr>)?/.exec(xml.slice(runStart))?.[1] ?? '';
    const rPrU = (rPr || '<w:rPr></w:rPr>').replace(/<w:u w:val="[^"]*"\/>/, '').replace('</w:rPr>', '<w:u w:val="single"/></w:rPr>');
    return { at: offset, len, text: `</w:t></w:r><w:r>${rPrU}<w:t xml:space="preserve">${text}</w:t></w:r><w:r>${rPr}<w:t xml:space="preserve">` };
  };
  const edits = [];
  list.forEach((ch, i) => {
    const a = at(boxes[i]);
    const b = at(boxes[i] + 1);
    if (a < 0 || b < 0) return;
    if (b === a + 1) edits.push(underlined(a, 2, `${escapeXml(ch)}\u00a0`));
    else edits.push(underlined(a, 1, escapeXml(ch)), underlined(b, 1, '\u00a0'));
  });
  let out = xml;
  for (const e of edits.sort((x, y) => y.at - x.at)) out = `${out.slice(0, e.at)}${e.text}${out.slice(e.at + e.len)}`;
  return out;
}
