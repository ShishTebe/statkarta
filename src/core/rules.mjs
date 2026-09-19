// Исполнитель языка правил (docs/RULES_LANGUAGE.md).

function isEmpty(v) {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

function codesOf(v) {
  if (Array.isArray(v)) return v.map(keyCode);
  if (isEmpty(v)) return [];
  return [keyCode(v)];
}

function cmp(a, b) {
  const na = Number(String(a).replace(',', '.'));
  const nb = Number(String(b).replace(',', '.'));
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') return na - nb;
  return String(a).localeCompare(String(b));
}

export function evalExpr(expr, ctx) {
  if (expr === null || typeof expr !== 'object' || Array.isArray(expr)) return expr;
  const val = (x) => resolveValue(x, ctx);
  if ('all' in expr) return expr.all.every((e) => evalExpr(e, ctx));
  if ('any' in expr) return expr.any.some((e) => evalExpr(e, ctx));
  if ('always' in expr) return true;
  if ('exists' in expr) return !isEmpty(val(expr.exists));
  if ('empty' in expr) return isEmpty(val(expr.empty));
  if ('fills_by' in expr) return ctx.requisite?.fills_by === expr.fills_by;
  if ('field_type_in' in expr) return expr.field_type_in.includes(ctx.requisite?.field_type);
  if ('na' in expr) return ctx.status ? ctx.status(expr.na) === 'na' : false;
  if ('not_any_in' in expr) {
    const [a, list] = expr.not_any_in;
    const codes = codesOf(val(a));
    return codes.length > 0 && !codes.some((c) => list.includes(c));
  }
  if ('field_type' in expr) return ctx.requisite?.field_type === expr.field_type;
  if ('eq' in expr) {
    const [a, b] = expr.eq.map(val);
    if (isEmpty(a) || isEmpty(b)) return false;
    const ca = codesOf(a);
    const cb = codesOf(b);
    return cb.some((x) => ca.includes(x));
  }
  for (const op of ['gt', 'gte', 'lt', 'lte']) if (op in expr) {
    const [a, b] = expr[op].map(val);
    if (isEmpty(a) || isEmpty(b)) return false;
    const c = cmp(Array.isArray(a) ? a[0] : a, Array.isArray(b) ? b[0] : b);
    return { gt: c > 0, gte: c >= 0, lt: c < 0, lte: c <= 0 }[op];
  }
  if ('matches' in expr) {
    const [a, rx] = expr.matches;
    const s = val(a);
    return !isEmpty(s) && new RegExp(rx, 'iu').test(String(s));
  }
  if ('any_in' in expr) {
    const [a, list] = expr.any_in;
    return codesOf(val(a)).some((c) => list.includes(c));
  }
  if ('fn' in expr) return callFn(expr.fn, (expr.args ?? []).map(val), ctx);
  throw new Error(`Неизвестный оператор правила: ${JSON.stringify(expr)}`);
}

function resolveValue(x, ctx) {
  if (typeof x === 'string') {
    if (x.startsWith('fact.')) return ctx.fact(x);
    if (x.startsWith('event.')) return ctx.event ? ctx.event(x) : null;
    if (x.startsWith('attr.')) return ctx.attr ? ctx.attr(x) : null;
    if (x === 'req.*') return ctx.requisite ? ctx.req(ctx.requisite.id) : null;
    if (x.startsWith('req.')) return ctx.req(x.slice(4));
    return x;
  }
  if (x && typeof x === 'object' && !Array.isArray(x) && 'fn' in x) return evalExpr(x, ctx);
  return x;
}

function callFn(name, args, ctx) {
  const ix = ctx.ix;
  const q = () => parseQualification(args[0]);
  const date = ctx.fact('fact.crime.crime_date') || todayIso();
  switch (name) {
    case 'uk.category': return mostSevere(ix.uk, q(), date)?.category ?? null;
    case 'uk.category_code': {
      const c = mostSevere(ix.uk, q(), date)?.category;
      return c ? ({ small: '2', medium: '3', grave: '1', especially_grave: '4' })[c] : null;
    }
    case 'uk.stage': return q().stage;
    case 'uk.in_list': return isEmpty(args[0]) ? false : inList(ix.uk, q(), Number(args[1]), date);
    case 'uk.article_in': return q().main.some((r) => args[1].includes(r.article));
    case 'uk.article_in_note': {
      const note = ix.pack.legal.notes.find((n) => n.id === args[1]);
      if (!note || isEmpty(args[0])) return false;
      const listed = parseQualification(note.text).refs;
      return q().main.some((r) => listed.some((l) => l.article === r.article && (!l.parts.length || l.parts.some((p) => r.parts.includes(p))) &&
        (!l.points.length || l.points.some((p) => r.points.includes(p)))));
    }
    case 'classifier.has_code': {
      const r = ctx.requisite;
      if (!r?.classifier_no || isEmpty(args[0])) return true;
      const map = ix.clsCode.get(r.classifier_no);
      return !map || codesOf(args[0]).every((c) => map.has(c));
    }
    case 'form.has_option': {
      const r = ctx.requisite;
      if (!r || isEmpty(args[0]) || !r.options.length) return true;
      // раздел 1: вид номера (УД, материал) вместе с номером – это номер дела текстом, а не код варианта
      if (r.fills_by === 'registrar' && !Array.isArray(args[0])) return true;
      const codes = new Set(r.options.map((o) => o.code));
      return codesOf(args[0]).every((c) => codes.has(c));
    }
    case 'case.has_form': return ctx.caseForms.includes(String(args[0]));
    case 'form.select_ok': {
      const r = ctx.requisite;
      if (!r || isEmpty(args[0]) || !Array.isArray(args[0])) return true;
      return !selectionProblem(r, codesOf(args[0]));
    }
    case 'text.max_len': return isEmpty(args[0]) || String(args[0]).length <= Number(args[1]);
    case 'package.has_form': case 'package.count_cards': case 'package.count_cards_case': case 'package.count_objects': case 'package.req':
      if (!ctx.pkg) throw new Error(`функция ${name} доступна только в проверках пакета`);
      return ctx.pkg[name.slice(8)](...args);
    case 'case.had_card': return ctx.hadCard ? ctx.hadCard(...args) : false;
    default: throw new Error(`Неизвестная функция правила: ${name}`);
  }
}
