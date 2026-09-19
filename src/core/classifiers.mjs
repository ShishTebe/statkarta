// Поиск по справочникам: код, фрагмент наименования, опечатки.

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/\u0451/g, 'е').replace(/[«»"()\-–,.;:]/g, ' ').replace(/\s+/g, ' ').trim();

export function scoreEntry(query, code, name, section) {
  const q = norm(query);
  if (!q) return 0;
  const c = String(code);
  const qd = query.trim();
  if (c === qd) return 1000;
  if (/^\d+$/.test(qd)) {
    // неполный номер: начало, окончание или часть кода
    if (c.startsWith(qd)) return 800 - (c.length - qd.length);
    if (c.endsWith(qd)) return 750 - (c.length - qd.length);
    if (c.includes(qd)) return 700 - c.indexOf(qd);
    const stripped = c.replace(/^0+/, '');
    if (stripped && stripped === qd.replace(/^0+/, '')) return 900;
    return 0;
  }
  const hay = norm(`${name} ${section ?? ''}`);
  if (hay.includes(q)) return 500 - Math.min(200, hay.indexOf(q));
  const words = hay.split(' ');
  const qw = q.split(' ').filter(Boolean);
  let total = 0;
  for (const w of qw) {
    let best = 0;
    for (const h of words) {
      if (h.startsWith(w)) best = Math.max(best, 60);
      else if (w.length >= 4) {
        const tol = w.length >= 7 ? 2 : 1;
        const d = lev(w, h.slice(0, w.length + tol), tol);
        if (d <= tol) best = Math.max(best, 40 - d * 10);
      }
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}

export function entryPath(e) {
  return (e.path ?? []).filter(Boolean).join(' / ');
}

export function searchClassifier(entries, query, limit = 30, { includeInactive = false } = {}) {
  const res = [];
  for (const e of entries) {
    if (!includeInactive && e.active === false) continue;
    const s = scoreEntry(query, e.code, e.name, `${e.section ?? ''} ${entryPath(e)}`);
    if (s > 0) res.push({ e, s });
  }
  res.sort((a, b) => b.s - a.s || String(a.e.code).localeCompare(String(b.e.code)));
  return res.slice(0, limit).map((x) => x.e);
}
