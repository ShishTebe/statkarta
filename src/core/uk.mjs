// Квалификация и категория тяжести по пакету УК (перечни № 4–7 указания от 28.07.2025 № 147).

export const CATEGORY_RU = { small: 'небольшой тяжести', medium: 'средней тяжести', grave: 'тяжкое', especially_grave: 'особо тяжкое' };
export const CATEGORY_RANK = { small: 1, medium: 2, grave: 3, especially_grave: 4 };
const CAT_LISTS = { 4: 'small', 5: 'medium', 6: 'grave', 7: 'especially_grave' };

// «п. «а» ч. 3 ст. 30, пп. «а», «в» ч. 2 ст. 158 УК РФ» → ссылки
export function parseQualification(text) {
  const src = String(text ?? '').replace(/ /g, ' ').replace(/(\d)ст\./g, '$1 ст.');
  const refs = [];
  // пункт можно писать в кавычках («в») и без них (в), в том числе несколько: «пп. а, в»
  const PT = '(?:«[^»]{1,4}»|"[^"]{1,4}"|[а-яa-z](?![\\p{L}\\d]))';
  const rx = new RegExp(`(?:(пп?\\.|пункт[а-я]*)\\s*(${PT}(?:\\s*(?:,|и)\\s*${PT})*)\\s*)?(?:(чч?\\.|част[а-я]*)\\s*(\\d+(?:\\.\\d+)?(?:\\s*(?:,|и)\\s*\\d+(?:\\.\\d+)?)*)\\s*)?(?:ст\\.|стат[а-я]*)\\s*(\\d+(?:\\.\\d+)?)`, 'giu');
  const stageOf = (r) => (!r ? null : r.parts.includes('1') ? 1 : r.parts.includes('3') ? 2 : null);
  // квалификации нескольких эпизодов (пакет карточек на лицо) разделяются «;» – стадия ст. 30 относится к своему эпизоду
  const segments = src.split(';').filter((s) => /ст\.|стат/i.test(s));
  segments.forEach((seg, i) => {
    const own = [];
    let m;
    rx.lastIndex = 0;
    while ((m = rx.exec(seg))) {
      const points = m[2] ? [...m[2].matchAll(/[«"]([^»"]+)[»"]|(?:^|[,\s])([а-яa-z])(?![\p{L}\d])/giu)].map((x) => x[1] ?? x[2]).filter(Boolean) : [];
      const parts = m[4] ? m[4].match(/\d+(?:\.\d+)?/g) : [];
      own.push({ article: m[5], parts, points });
    }
    const sRef = own.find((r) => r.article === '30');
    for (const r of own) {
      Object.defineProperty(r, 'segment', { value: i, enumerable: false });
      Object.defineProperty(r, 'stageRef', { value: sRef ?? null, enumerable: false });
      Object.defineProperty(r, 'stage', { value: stageOf(sRef), enumerable: false });
    }
    refs.push(...own);
  });
  const stage = stageOf(refs.find((r) => r.article === '30'));
  const main = refs.filter((r) => r.article !== '30');
  return { refs, main, stage, segments: segments.length, recognized: refs.length > 0 };
}

export function buildUkIndex(articles) {
  const idx = new Map();
  for (const a of articles) idx.set(a.article, a);
  return idx;
}

function condOk(c, date) {
  if (c.op === '<') return date < c.date;
  if (c.op === '<=') return date <= c.date;
  if (c.op === '>=') return date >= c.date;
  if (c.op === '>') return date > c.date;
  return false;
}

export function membershipActive(entry, date) {
  const conds = entry.date ?? [];
  if (!conds.length) return true;
  return entry.date_mode === 'any' ? conds.some((c) => condOk(c, date)) : conds.every((c) => condOk(c, date));
}

// Категория одной ссылки на дату: по перечням с приоритетом, иначе расчет по санкции
export function categoryOfRef(ukIdx, ref, date) {
  const a = ukIdx.get(ref.article);
  if (!a) return { category: null, source: 'not_found', note: `Статья ${ref.article} не найдена в пакете УК` };
  const parts = a.parts.filter((p) => (ref.parts.length ? ref.parts.includes(p.part) : true));
  if (!parts.length) return { category: null, source: 'not_found', note: `В ст. ${ref.article} нет части ${ref.parts.join(', ')}` };
  let best = null;
  for (const p of parts) {
    const tiers = { 1: new Set(), 2: new Set(), 3: new Set(), 4: new Set() };
    for (const e of p.lists ?? []) {
      if (!(e.list in CAT_LISTS) || !['unconditional', 'date'].includes(e.kind) || !membershipActive(e, date)) continue;
      const tier = e.date ? (e.scope === 'part' ? 1 : 2) : (e.scope === 'part' ? 3 : 4);
      tiers[tier].add(CAT_LISTS[e.list]);
    }
    const set = [1, 2, 3, 4].map((t) => tiers[t]).find((s) => s.size) ?? new Set();
    let r;
    if (set.size === 1) r = { category: [...set][0], source: 'lists' };
    else if (set.size > 1) r = { category: [...set].sort((x, y) => CATEGORY_RANK[y] - CATEGORY_RANK[x])[0], source: 'conflict' };
    else r = { category: p.category_computed ?? p.category, source: 'computed' };
    // без указания части берем наиболее тяжкую
    if (!best || CATEGORY_RANK[r.category] > CATEGORY_RANK[best.category]) best = { ...r, part: p.part };
  }
  if (!ref.parts.length && parts.length > 1) best.note = 'Часть не указана – взята наиболее тяжкая часть статьи';
  return best;
}

export function mostSevere(ukIdx, qual, date) {
  let best = null;
  for (const ref of qual.main) {
    const c = categoryOfRef(ukIdx, ref, date);
    if (c.category && (!best || CATEGORY_RANK[c.category] > CATEGORY_RANK[best.category])) best = { ...c, ref };
  }
  return best;
}

export function inList(ukIdx, qual, listNo, date) {
  return qual.main.some((ref) => {
    const a = ukIdx.get(ref.article);
    if (!a) return false;
    return a.parts.some((p) => (!ref.parts.length || ref.parts.includes(p.part)) &&
      (p.lists ?? []).some((e) => e.list === listNo && ['unconditional', 'date'].includes(e.kind) && membershipActive(e, date)));
  });
}

export function refToText(ref) {
  const pts = ref.points.length ? `${ref.points.length > 1 ? 'пп.' : 'п.'} ${ref.points.map((p) => `«${p}»`).join(', ')} ` : '';
  const pr = ref.parts.length ? `${ref.parts.length > 1 ? 'чч.' : 'ч.'} ${ref.parts.join(', ')} ` : '';
  return `${pts}${pr}ст. ${ref.article} УК РФ`;
}
