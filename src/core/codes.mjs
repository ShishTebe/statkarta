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
  if (inp.select === 'overlay') {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
      if (overlayConflict(list[i], list[j])) return `коды ${list[i]} и ${list[j]} занимают одни и те же разряды – наложить нельзя`;
    return null;
  }
  const max = inp.max_codes ?? 1;
  if (list.length > max) return `выбрано ${list.length} кодов, а в бланке ${max === 1 ? 'одно поле' : `полей: ${max}`}`;
  return null;
}
