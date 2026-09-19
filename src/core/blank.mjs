// Заполнение бланка карточки значениями памятки (Фаза 1.6, FR-39 – FR-42).
// Модуль ничего не знает ни о DOM, ни о формате файла: он превращает памятку и карту раскладки
// в список «место бланка → знак» и в список замечаний. Сборкой .docx занимается docx.mjs,
// печатной копией – интерфейс.

import { composeOverlay } from './codes.mjs';
import { keyCode } from './pack.mjs';
import { parseQualification } from './uk.mjs';

const BLANK_FILLED = new Set(['fill', 'default', 'hint']);
// Раздел 1 (работник регистрационного учета) впечатывается, если сведения внесены следователем
// (номер дела, КРСП и т. п. – замечание от 19.09.2026); поля ИЦ и суда в бланк не вписываются.
const BLANK_SKIP_FILLS_BY = new Set(['ic', 'court']);
// Номер из цифр с разделителями («1-24-0230-0001-000045», «№ 1234») раскладывается по клеткам цифрами
const DIGITS_WITH_SEPARATORS = /^[\d\s.,\-–/№]+$/;
// Вид ИПК в заголовке бланка «(лицо – ЛЦ, событие – ПР)»
const IPK_VARIANT_MARK = { lc: 'ЛЦ', pr: 'ПР' };

function blankCodesOf(row) {
  if (!Array.isArray(row.value)) return [];
  const codes = row.value.map(keyCode).filter(Boolean);
  if (row.requisite?.input?.select === 'overlay' && codes.length > 1) return [composeOverlay(codes)];
  return codes;
}

// Значение по клеткам группы: разряды прижимаются вправо, лишние разряды – замечание.
function blankIntoGroup(cells, text) {
  const chars = String(text).split('');
  if (chars.length > cells.length) {
    return { edits: cells.map((shape, i) => ({ shape, text: chars[chars.length - cells.length + i] })),
      overflow: chars.slice(0, chars.length - cells.length).join('') };
  }
  const pad = cells.length - chars.length;
  return { edits: chars.map((ch, i) => ({ shape: cells[pad + i], text: ch })), overflow: '' };
}

function blankDateParts(iso, groups) {
  const [y, m, d] = String(iso).split('-');
  if (!y || !m || !d) return null;
  const year = groups[0] && groups[0].length >= 4 ? y : y.slice(2);
  return [year, m, d];
}

// ---- Составные реквизиты: части с назначением (карта раскладки, поле parts) ----
// role: code – код(ы) реквизита; date – дата из сведений дела; fill – дополнительное поле
// реквизита (код подразделения, сумма и т. п.); qual – ячейка квалификации (статья, знак, часть,
// знак, пункты); text – текстовое место бланка (ячейка таблицы).

function blankFactValue(memo, part) {
  for (const fid of [].concat(part.facts ?? [])) {
    const a = memo?.facts?.[fid];
    if (a?.status === 'answered' && a.value !== null && a.value !== undefined && a.value !== '') return a.value;
  }
  return null;
}

function blankDateDigits(iso, format, time) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return null;
  const [, y, mo, d] = m;
  const hh = time ? String(time).split(':')[0].padStart(2, '0') : '';
  if (format === 'YYMMDD') return `${y.slice(2)}${mo}${d}`;
  if (format === 'DDMMYY') return `${d}${mo}${y.slice(2)}`;
  if (format === 'YYYYMMDDHH') return hh ? `${y}${mo}${d}${hh}` : `${y}${mo}${d}`;
  return `${y}${mo}${d}`;
}

// Ф. 6, раздел 3 (ответ В-27 от 19.09.2026): по строке на эпизод; стадия – приготовление (01),
// покушение (02), оконченное (03); форма соучастия – ст. 35 УК РФ ч. 1–4 (10, 20, 30, 40),
// категория соучастника – ст. 33 УК РФ ч. 2–5 (01–04). Статьи 30, 33, 35 эпизодом не считаются.
const COMPLICITY_33 = { 2: '01', 3: '02', 4: '03', 5: '04' };
const COMPLICITY_35 = { 1: '10', 2: '20', 3: '30', 4: '40' };

function blankEpisodeSlot(text, slot, line) {
  const q = parseQualification(text);
  const offenses = q.refs.filter((r) => !['30', '33', '35'].includes(r.article));
  const ref = offenses[line];
  if (!ref) return '';
  if (slot === 'stage') return ref.stage === 1 ? '01' : ref.stage === 2 ? '02' : '03';
  if (slot === 'complicity') {
    const same = q.refs.filter((r) => r.segment === ref.segment);
    const r33 = same.find((r) => r.article === '33');
    const r35 = same.find((r) => r.article === '35');
    if (r35 && COMPLICITY_35[Number(r35.parts[0])]) return COMPLICITY_35[Number(r35.parts[0])];
    if (r33 && COMPLICITY_33[Number(r33.parts[0])]) return COMPLICITY_33[Number(r33.parts[0])];
    return '';
  }
  return null;
}

function blankQualSlot(text, slot, line = 0, episodes = false) {
  if (episodes) {
    const special = blankEpisodeSlot(text, slot, line);
    if (special !== null) return special;
  }
  const refs = episodes
    ? parseQualification(text).refs.filter((r) => !['30', '33', '35'].includes(r.article))
    : parseQualification(text).main;
  const ref = refs[line];
  if (!ref) return '';
  const [article, asign = ''] = ref.article.split('.');
  const [part = '', psign = ''] = (ref.parts[0] ?? '').split('.');
  // пункт с примечанием («е.1»): буквы пунктов – в клетки «п.», цифра примечания – в клетку «зн.»
  // (ответ В-24 от 17.09.2026)
  const letters = ref.points.map((x) => String(x).split('.')[0]).join('');
  const pointSign = ref.points.map((x) => String(x).split('.')[1] ?? '').find(Boolean) ?? '';
  return { article, asign, part, psign, points: letters, point_sign: pointSign }[slot] ?? '';
}

// Знаки части по клеткам: числа прижимаются вправо, буквы пунктов – влево.
function blankIntoCells(cells, text, { align = 'right' } = {}) {
  const chars = String(text).split('');
  if (chars.length > cells.length) return { edits: [], overflow: true };
  const pad = align === 'left' ? 0 : cells.length - chars.length;
  return { edits: chars.map((ch, i) => ({ shape: cells[pad + i], text: ch })), overflow: false };
}

function planParts(row, field, memo) {
  const out = { requisite: field.requisite, label: field.label ?? row?.label ?? '', kind: 'parts', edits: [], text: '', notes: [] };
  const fillsOf = memo?.fills?.[`${memo.form}|${field.requisite}`] ?? {};
  const texts = [];
  for (const part of field.parts) {
    const cells = (part.groups ?? []).flat();
    let value = '';
    let align = 'right';
    if (part.role === 'code') {
      if (!row || !BLANK_FILLED.has(row.status)) continue;
      const sub = planField(row, { requisite: field.requisite, label: field.label, groups: part.groups });
      out.edits.push(...sub.edits);
      out.notes.push(...sub.notes);
      if (sub.blocked) out.blocked = true;
      if (sub.text) texts.push(sub.text);
      continue;
    }
    if (part.role === 'date') {
      const iso = blankFactValue(memo, part) ?? (typeof row?.value === 'string' ? row.value : null);
      const time = part.time_fill !== undefined ? fillsOf[part.time_fill] : null;
      value = blankDateDigits(iso, part.format, time) ?? '';
      align = 'left';
    } else if (part.role === 'fill') {
      value = String(fillsOf[part.index] ?? '').replace(part.digits ? /\D/g : /\s+/g, '');
    } else if (part.role === 'fact') {
      const v = blankFactValue(memo, part);
      value = v === null ? '' : String(Array.isArray(v) ? v.map(keyCode).join('') : v).replace(part.digits ? /\D/g : /\s+/g, '');
    } else if (part.role === 'variant') {
      // вид карты (ИПК-ЛЦ, ИПК-ПР) – по варианту карточки пакета
      const text = IPK_VARIANT_MARK[memo?.variant];
      if (!text) continue;
      out.cellEdits = [...(out.cellEdits ?? []), { place: part.place, text, mode: part.mode ?? 'cell', size: part.size ?? null }];
      texts.push(text);
      continue;
    } else if (part.role === 'qual') {
      if (!row || !BLANK_FILLED.has(row.status) || typeof row.value !== 'string') continue;
      value = blankQualSlot(row.value, part.slot, part.line ?? 0, Boolean(part.episodes));
      if (part.slot === 'points') align = 'left';
      if (part.place && value) {
        // клетки «!__!» в тексте бланка (карта на иностранцев)
        const padded = part.slot === 'points' ? value : value.padStart(part.width ?? value.length, ' ');
        out.cellEdits = [...(out.cellEdits ?? []), { place: part.place, text: padded, mode: 'boxes' }];
        texts.push(value);
        continue;
      }
    } else if (part.role === 'signature') {
      const sign = (memo?.signatures ?? []).find((x) => x.id === part.who);
      const on = { investigator: memo?.profileOptions?.blank_sign_investigator !== false,
        head: memo?.profileOptions?.blank_sign_head === true, prosecutor: memo?.profileOptions?.blank_sign_prosecutor === true };
      if (!sign?.value || !on[part.who]) continue;
      out.cellEdits = [...(out.cellEdits ?? []), { place: part.place, text: sign.value, mode: part.mode ?? 'underscores', size: part.size ?? null }];
      texts.push(sign.value);
      continue;
    } else if (part.role === 'date_part') {
      // дата по линейкам «__» ________ 20__ г.: число, месяц словом, год (полностью или две цифры)
      const iso = blankFactValue(memo, part) ?? (row && BLANK_FILLED.has(row.status) ? row.value : null);
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
      if (!m) continue;
      const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
      const text = { day: m[3], month: MONTHS[Number(m[2]) - 1], year: m[1], year2: m[1].slice(2) }[part.part];
      out.cellEdits = [...(out.cellEdits ?? []), { place: part.place, text, mode: 'underscores' }];
      texts.push(text);
      continue;
    } else if (part.role === 'codes_text' || part.role === 'date_text') {
      // бланки-таблицы (ИПК): коды и даты впечатываются текстом в ячейку
      if (!row || !BLANK_FILLED.has(row.status) || row.value === null || row.value === undefined) continue;
      let text = '';
      if (part.role === 'codes_text') text = (Array.isArray(row.value) ? row.value.map(keyCode) : [row.value]).join(', ');
      else {
        const iso = blankFactValue(memo, part) ?? row.value;
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
        text = !m ? String(iso) : part.mode === 'boxes' ? `${m[3]}${m[2]}${m[1]}` : `${m[3]}.${m[2]}.${m[1]}`;
      }
      if (!text) continue;
      out.cellEdits = [...(out.cellEdits ?? []), { place: part.place, text, mode: part.mode ?? 'cell', size: part.size ?? null }];
      texts.push(text);
      continue;
    } else if (part.role === 'text') {
      if (!row || !BLANK_FILLED.has(row.status) || row.value === null || row.value === undefined) continue;
      let text = String(Array.isArray(row.value) ? row.value.join(' ') : row.value).trim();
      // одно значение на два места бланка (имя и отчество): word – 0 первое слово, 'rest' – остальное
      if (part.word !== undefined) {
        const words = text.split(/\s+/);
        text = part.word === 'rest' ? words.slice(1).join(' ') : (words[part.word] ?? '');
        if (!text) continue;
      }
      const max = part.max_len ?? row.requisite?.input?.max_chars ?? null;
      if (max && text.length > max) {
        out.notes.push(`реквизит ${field.requisite}: текст длиннее ${max} знаков – сократите`);
        out.blocked = true;
        continue;
      }
      out.cellEdits = [...(out.cellEdits ?? []), { place: part.place, text, mode: part.mode ?? 'underscores', size: part.size ?? null }];
      texts.push(text);
      continue;
    }
    if (!value) continue;
    const res = blankIntoCells(cells, value, { align });
    if (res.overflow) {
      out.notes.push(`реквизит ${field.requisite}: значение «${value}» не помещается в отведенные бланком клетки`);
      out.blocked = true;
      continue;
    }
    out.edits.push(...res.edits);
    texts.push(value);
  }
  out.text = texts.join(' ');
  if (!out.edits.length && !out.cellEdits?.length && !out.notes.length) out.skip = true;
  return out;
}

// План заполнения одного реквизита: какие знаки в какие места бланка и что проверить руками.
export function planField(row, field, memo = null) {
  if (field.parts) {
    if (row && BLANK_SKIP_FILLS_BY.has(row.fills_by)) return { requisite: field.requisite, skip: true, edits: [], notes: [] };
    return planParts(row, field, memo);
  }
  const groups = field.groups ?? [];
  const out = { requisite: field.requisite, label: field.label ?? row?.label ?? '', kind: 'code',
    edits: [], text: '', notes: [] };
  if (!row || !BLANK_FILLED.has(row.status)) return { ...out, skip: true };
  if (BLANK_SKIP_FILLS_BY.has(row.fills_by)) return { ...out, skip: true };

  const r = row.requisite ?? {};
  if (r.field_type === 'date' && typeof row.value === 'string') {
    out.kind = 'date_cells';
    if (groups.length === 1 && groups[0].length >= 6) {
      // дата одним рядом клеток «год мес. чис.»: 8 клеток – год четырьмя цифрами, 6 – двумя
      const digits = blankDateDigits(row.value, groups[0].length >= 8 ? 'YYYYMMDD' : 'YYMMDD');
      const res = digits ? blankIntoCells(groups[0], digits, { align: 'left' }) : { edits: [], overflow: true };
      if (res.overflow) out.notes.push(`реквизит ${field.requisite}: дата «${row.value}» не разобрана`);
      out.edits.push(...res.edits);
      out.text = digits ?? '';
      return out;
    }
    const parts = blankDateParts(row.value, groups);
    if (!parts) {
      out.notes.push(`реквизит ${field.requisite}: дата «${row.value}» не разобрана`);
      return out;
    }
    parts.forEach((part, i) => {
      if (!groups[i]) {
        out.notes.push(`реквизит ${field.requisite}: в бланке нет места для части даты (${['года', 'месяца', 'числа'][i]})`);
        return;
      }
      const res = blankIntoGroup(groups[i], part);
      out.edits.push(...res.edits);
    });
    out.text = parts.join('.');
    return out;
  }

  const codes = blankCodesOf(row);
  if (codes.length) {
    out.kind = codes.length > 1 ? 'code_list' : 'code';
    const free = [...groups];
    for (const code of codes) {
      let gi = free.findIndex((g) => g.length === code.length);
      if (gi < 0) gi = free.findIndex((g) => g.length >= code.length);
      if (gi < 0 && codes.length === 1 && free.length > 1 && free.flat().length >= code.length) {
        // один код на несколько групп клеток (ОКАТО 11 разрядов – группы 2-3-3-3): разряды идут подряд
        const res = blankIntoGroup(free.flat(), code);
        out.edits.push(...res.edits);
        free.length = 0;
        continue;
      }
      if (gi < 0) {
        // Значение, которое не входит в отведенные бланком клетки, не вписывается: печать
        // закрывается, пока значение не исправлено (ответ заказчика В-19 от 16.09.2026).
        out.notes.push(`реквизит ${field.requisite}: код ${code} не помещается в отведенные бланком клетки`);
        out.blocked = true;
        continue;
      }
      const res = blankIntoGroup(free[gi], code);
      out.edits.push(...res.edits);
      if (res.overflow) out.notes.push(`реквизит ${field.requisite}: в бланк не вошли разряды «${res.overflow}» кода ${code}`);
      free.splice(gi, 1);
    }
    out.text = codes.join(' ');
    return out;
  }

  const value = Array.isArray(row.value) ? row.value.join(' ') : row.value;
  if (value === null || value === undefined || value === '') return { ...out, skip: true };
  const digits = String(value).replace(/\D/g, '');
  if (groups.length && digits && DIGITS_WITH_SEPARATORS.test(String(value).trim())) {
    out.kind = 'number_cells';
    let rest = digits;
    for (const g of [...groups].reverse()) {
      const part = rest.slice(-g.length);
      rest = rest.slice(0, rest.length - part.length);
      const res = blankIntoGroup(g, part);
      out.edits.push(...res.edits);
    }
    if (rest) out.notes.push(`реквизит ${field.requisite}: в бланк не вошли цифры «${rest}»`);
    out.text = digits;
    return out;
  }

  out.kind = 'text';
  out.text = String(value);
  const max = field.max_len ?? r.input?.max_len ?? null;
  if (max && out.text.length > max) {
    out.notes.push(`реквизит ${field.requisite}: текст длиннее ${max} знаков – сократите (в бланк входит ${max})`);
    out.blocked = true;
  }
  if (!field.place) {
    out.notes.push(`реквизит ${field.requisite}: место в бланке не размечено – впишите значение от руки`);
    out.unmapped = true;
  }
  return out;
}

// План заполнения карточки целиком: что вписать, что мешает печати, что проверить перед подписью.
export function planBlank(memo, layout, { state = null, profile = null } = {}) {
  if (profile) memo = { ...memo, profileOptions: profile };
  const rows = new Map(memo.rows.map((r) => [r.id, r]));
  const fields = [];
  const edits = [];
  const notes = [];
  const cellEdits = [];
  for (const field of layout.fields ?? []) {
    const plan = planField(rows.get(field.requisite), field, memo);
    if (plan.skip) continue;
    fields.push(plan);
    edits.push(...plan.edits);
    cellEdits.push(...(plan.cellEdits ?? []));
    notes.push(...plan.notes);
  }
  const errors = memo.checks.filter((c) => c.severity === 'error');
  const warnings = memo.checks.filter((c) => c.severity !== 'error');
  const unconfirmed = memo.rows.filter((r) => r.status === 'default' || r.status === 'hint');
  const blockers = [];
  for (const e of errors) blockers.push(`Контроль: ${e.text ?? e.message ?? e.id}`);
  for (const r of unconfirmed) blockers.push(`Не подтверждено умолчание: реквизит ${r.number} – ${r.display}`);
  for (const p of fields) if (p.blocked) blockers.push(p.notes.join('; '));
  return { form: layout.form, blank: layout.blank, sha256: layout.blank_sha256,
    state: state ?? (blockers.length ? 'blocked' : 'ready'),
    fields, edits, cellEdits, blockers, notes,
    warnings: [...warnings.map((c) => `Контроль: ${c.text ?? c.message ?? c.id}`),
      ...memo.rows.filter((r) => r.warning).map((r) => `Реквизит ${r.number}: ${r.warning}`), ...notes],
    ready: blockers.length === 0 };
}

// Печатная копия бланка (FR-39): разделы, номера и наименования реквизитов как в бланке,
// ряды клеток с проставленными знаками. Поля ИЦ и суда выводятся пустыми; раздел 1 – пустым,
// если следователь не внес эти сведения (номер дела, КРСП).
// Строки подписи в бланке (ответы заказчика В-14 и В-16 от 16.09.2026): расшифровка подписи
// лица, ведущего расследование, печатается по умолчанию; строки руководителя и прокурора –
// только если это отмечено в профиле органа. Незаполненная строка остается пустой под подпись.
export function blankSignatures(memo, profile = {}) {
  const on = { investigator: profile.blank_sign_investigator !== false,
    head: profile.blank_sign_head === true, prosecutor: profile.blank_sign_prosecutor === true };
  return (memo.signatures ?? []).map((s) => ({ id: s.id, label: s.label,
    value: on[s.id] ? s.value : '', printed: Boolean(on[s.id]) }));
}

export function blankSheet(ix, memo, layout, plan, { profile = {} } = {}) {
  const form = ix.forms.get(memo.form);
  const byReq = new Map((layout.fields ?? []).map((f) => [f.requisite, f]));
  const planned = new Map(plan.fields.map((f) => [f.requisite, f]));
  const chars = new Map(plan.edits.map((e) => [e.shape, e.text]));
  const rows = new Map(memo.rows.map((x) => [x.id, x]));
  const sections = [];
  for (const r of form.requisites) {
    const field = byReq.get(r.id);
    const p = planned.get(r.id);
    const row = rows.get(r.id);
    const title = r.section || '';
    if (!sections.length || sections.at(-1).title !== title) sections.push({ title, rows: [] });
    const layoutGroups = field?.parts ? field.parts.flatMap((p) => p.groups ?? []) : (field?.groups ?? []);
    const groups = layoutGroups.map((g) => g.map((shape) => chars.get(shape) ?? ''));
    // Значение показывается и тогда, когда карта раскладки для формы еще не готова: в этом
    // случае клеток нет, а значение печатается текстом – его вписывают в бланк от руки.
    const plain = !p && row && BLANK_FILLED.has(row.status) && !BLANK_SKIP_FILLS_BY.has(r.fills_by) ? row.display : '';
    sections.at(-1).rows.push({
      id: r.id, number: r.number, label: r.label, fills_by: r.fills_by,
      groups, text: p && (p.kind === 'text' || p.cellEdits?.length) ? (p.cellEdits ?? []).map((x) => x.text).join(' ') || p.text : plain,
      note: p?.notes?.length ? p.notes.join('; ') : '',
      filled: Boolean((p && (p.edits.length || p.text)) || plain),
    });
  }
  return { form: memo.form, title: form.title, edition: form.edition, card: memo.cardTitle ?? '',
    sections, signatures: blankSignatures(memo, profile), blank: layout.blank, ready: plan.ready };
}
