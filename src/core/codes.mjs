// Позиционные коды: наложение разрядов («2000» + «0030» = «2030»).

export function nonzeroPositions(code) {
  const out = [];
  String(code).split('').forEach((ch, i) => { if (ch !== '0') out.push(i); });
  return out;
}

// Коды конфликтуют, если занимают общие разряды или начинаются с одного разряда (альтернативы)
export function overlayConflict(a, b) {
  const pa = nonzeroPositions(a);
  const pb = nonzeroPositions(b);
  if (!pa.length || !pb.length || String(a).length !== String(b).length) return true;
  const lo = (p) => [Math.min(...p), Math.max(...p)];
  const [a0, a1] = lo(pa);
  const [b0, b1] = lo(pb);
  return a0 === b0 || !(a1 < b0 || b1 < a0);
}

export function composeOverlay(codes) {
  const list = codes.map(String).filter(Boolean);
  if (!list.length) return '';
  const len = list[0].length;
  const digits = Array(len).fill('0');
  for (const c of list) c.split('').forEach((ch, i) => { if (ch !== '0') digits[i] = ch; });
  return digits.join('');
}

// Проверка выбора: не больше полей бланка; при наложении – без конфликтов разрядов
export function selectionProblem(requisite, codes) {
  const inp = requisite?.input ?? {};
  const list = codes.map(String);
  if (!list.length) return null;
  if (inp.select === 'overlay_slots') return overlaySlotsProblem(requisite, list);
  if (inp.select === 'overlay') {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
      if (overlayConflict(list[i], list[j])) return `коды ${list[i]} и ${list[j]} занимают одни и те же разряды – наложить нельзя`;
    return null;
  }
  // «multiple» без max_codes – перечень кодов через запятую в одной ячейке (ИПК): предела нет
  const max = inp.max_codes ?? (inp.select === 'multiple' ? Infinity : 1);
  if (list.length > max) return `выбрано ${list.length} кодов, а в бланке ${max === 1 ? 'одно поле' : `полей: ${max}`}`;
  return null;
}

// Наложение по слотам (р. 31 ф. 1.1): код бланка складывается ровно из двух чисел разных
// разрядов (30 + 01 = 31), таких кодов в реквизите бывает несколько (31, 41, 14).
// Значение реквизита – коды подряд, по два на слот; здесь они разбираются по парам.
// Замечание пользователя от 23.09.2026.
export function overlaySlots(codes) {
  const out = [];
  for (let i = 0; i < codes.length; i += 2) out.push(codes.slice(i, i + 2).filter(Boolean));
  return out.filter((pair) => pair.length);
}

// Разряд кода наложения: номер первого разряда, отличного от нуля («30» – 0, «01» – 1)
export function overlayRank(code) {
  const p = nonzeroPositions(code);
  return p.length ? p[0] : -1;
}

export function overlaySlotsProblem(requisite, codes) {
  const slots = overlaySlots(codes);
  const max = requisite?.input?.max_codes ?? requisite?.input?.fields ?? 1;
  if (slots.length > max) return `выбрано ${slots.length} кодов, а в бланке ${max === 1 ? 'одно поле' : `полей: ${max}`}`;
  for (const pair of slots) {
    if (pair.length < 2) return `код ${pair[0]} не дополнен вторым числом: в бланк ставится сумма двух чисел (например 30 + 01 = 31)`;
    if (overlayRank(pair[0]) === overlayRank(pair[1])) return `коды ${pair[0]} и ${pair[1]} занимают один разряд – сложить их нельзя`;
  }
  return null;
}
