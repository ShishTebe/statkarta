// Опросник, производные значения, подсказки, памятка и контроль.

export const PHASE1_FORMS = ['1', '1.1', '2', '3'];
export const STATUS_RU = {
  fill: 'Заполнить', default: 'Умолчание – проверьте', hint: 'Подсказка – проверьте', not_applicable: 'Не заполнять',
  unknown: 'Уточнить', unanswered: 'Нет данных', fills_ic: 'Заполняет ИЦ', fills_registrar: 'Заполняет работник регистрационного учета',
  fills_court: 'Заполняет суд', disabled: 'Не заполняется по условию',
};
export const SELECT_RU = { single: 'один код', multiple: 'несколько кодов', overlay: 'наложение кодов по разрядам' };
const NOT_BY_INVESTIGATOR = new Set(['ic', 'registrar', 'court']);
const LIST_ACT = 'перечни № 4–7 (указание Генпрокуратуры и МВД России от 28.07.2025 № 147)';

export function createCase() {
  return { answers: {}, fills: {}, forms: [], created: todayIso() };
}

export function setAnswer(c, factId, status, value = null) {
  if (!status) delete c.answers[factId];
  else c.answers[factId] = { status, value };
}

// Дополнительные поля реквизита (сумма, количество, время): привязаны к форме и реквизиту
export function setFill(c, formId, reqId, index, value) {
  const k = `${formId}|${reqId}`;
  c.fills ??= {};
  c.fills[k] ??= {};
  if (value === null || value === undefined || value === '') delete c.fills[k][index];
  else c.fills[k][index] = value;
}

function empty(v) {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
}

export function factOptions(ix, factId) {
  for (const f of ix.pack.forms) {
    const m = ix.mapping.get(f.form);
    for (const r of f.requisites) if (m.get(r.id)?.value_from === factId && (r.options.length || r.classifier_no)) return { form: f.form, requisite: r };
  }
  const q = ix.questionByFact.get(factId);
  if (q?.answer?.options) return { form: null, requisite: { options: q.answer.options } };
  return null;
}

function crimeDate(c) {
  return c.answers['fact.crime.crime_date']?.status === 'answered' ? c.answers['fact.crime.crime_date'].value : todayIso();
}

export function deriveAll(ix, c) {
  const out = {};
  const qa = c.answers['fact.crime.qualification'];
  if (qa?.status !== 'answered' || empty(qa.value)) return out;
  const qual = parseQualification(qa.value);
  if (!qual.recognized || !qual.main.length) return out;
  const date = crimeDate(c);
  const dated = c.answers['fact.crime.crime_date']?.status === 'answered';
  const dateNote = dated ? `на дату преступления ${isoToRu(date)}` : `на текущую дату ${isoToRu(date)} (дата преступления не указана)`;
  const keyFor = (factId, code) => {
    const fo = factOptions(ix, factId);
    const o = fo?.requisite.options?.find((x) => x.code === code);
    return o ? optKey(o) : `|${code}`;
  };
  for (const d of ix.pack.rules.derived) {
    if (d.id === 'd.category') {
      const best = mostSevere(ix.uk, qual, date);
      if (!best) continue;
      const how = best.source === 'lists' ? LIST_ACT : best.source === 'conflict' ? `${LIST_ACT}; перечни противоречат друг другу – выбрана более тяжкая` : 'расчет по санкции статьи (в перечнях № 4–7 не найдено)';
      out[d.sets] = { status: 'default', value: [keyFor(d.sets, d.map_codes[best.category])],
        source: `Умолчание: ${CATEGORY_RU[best.category]} по ${refToText(best.ref)}, ${how}, ${dateNote}${best.note ? `. ${best.note}` : ''}` };
    } else if (d.id === 'd.attempt') {
      // несколько эпизодов: стадия – по наиболее тяжкому эпизоду
      const stage = qual.segments > 1 ? (mostSevere(ix.uk, qual, date)?.ref.stage ?? null) : qual.stage;
      if (stage) out[d.sets] = { status: 'default', value: [keyFor(d.sets, String(stage))], source: `Умолчание: в квалификации ${stage === 1 ? 'ч. 1 ст. 30 УК РФ – приготовление' : 'ч. 3 ст. 30 УК РФ – покушение'}${qual.segments > 1 ? ' (по наиболее тяжкому эпизоду)' : ''}` };
      else if (qual.stage) out[d.sets] = { status: 'not_applicable', value: null, source: 'Наиболее тяжкий эпизод окончен; ст. 30 УК РФ указана в другом эпизоде – проверьте' };
      else out[d.sets] = { status: 'not_applicable', value: null, source: 'В квалификации нет ст. 30 УК РФ – преступление окончено' };
    } else if (d.expr?.fn === 'uk.in_list') {
      // подсказки направленности накладываются: коррупционной (10) + экономической (02) = 12
      const listNo = d.expr.args[1];
      if (!inList(ix.uk, qual, listNo, date)) continue;
      const prev = out[d.sets];
      const key = keyFor(d.sets, d.when_true_code);
      if (prev && prev.status === 'hint') {
        if (!prev.value.includes(key)) prev.value.push(key);
        prev.source += `; перечень № ${listNo}`;
      } else {
        out[d.sets] = { status: 'hint', value: [key], source: `Подсказка: статья входит в перечень № ${listNo}` };
      }
    }
  }
  const orient = out['fact.crime.orientation'];
  if (orient?.status === 'hint') orient.source += '. Отнесение по перечням № 2 и № 23 зависит от дополнительных условий перечней (признаки субъекта, мотива, предмета) – проверьте';
  return out;
}

export function factValue(ix, c, factId, derived) {
  const a = c.answers[factId];
  if (a?.status === 'answered') return a.value;
  if (a?.status === 'na') return null;
  const d = (derived ?? deriveAll(ix, c))[factId];
  return d && d.status !== 'not_applicable' ? d.value : null;
}

function ruleCtx(ix, c, derived) {
  return { ix, caseForms: c.forms, fact: (id) => factValue(ix, c, id, derived), status: (id) => c.answers[id]?.status ?? null, req: () => null };
}

export function hintsFor(ix, c, factId, derived) {
  const ctx = ruleCtx(ix, c, derived);
  const out = [];
  for (const h of ix.pack.rules.hints ?? []) {
    if (h.fact !== factId) continue;
    try { if (evalExpr(h.when, ctx)) out.push(h); } catch { /* правило не применимо */ }
  }
  return out;
}

export function disabledReason(ix, c, factId, derived) {
  const ctx = ruleCtx(ix, c, derived);
  for (const a of ix.pack.rules.availability ?? []) {
    if (!a.facts.includes(factId)) continue;
    try { if (evalExpr(a.disabled_when, ctx)) return a; } catch { /* нет данных */ }
  }
  return null;
}

export function notesForRequisite(ix, formId, r, codes = []) {
  const notes = [...(ix.notesByReq.get(`${formId}|${r.number}`) ?? [])];
  if (r.classifier_no) {
    for (const code of codes) for (const n of ix.notesByCode.get(`${r.classifier_no}|${code}`) ?? []) if (!notes.includes(n)) notes.push(n);
  }
  return notes;
}

export function questionsForForm(ix, c, formId) {
  const derived = deriveAll(ix, c);
  const form = ix.forms.get(formId);
  const m = ix.mapping.get(formId);
  const out = [];
  const coreReqs = coreRequisites(ix, formId);
  for (const q of ix.pack.rules.questions.filter((x) => x.core)) {
    const reqs = coreReqs.get(q.sets[0]);
    if (!reqs) continue;
    out.push({ q, factId: q.sets[0], group: 'Общие сведения о деле', requisites: reqs, answer: c.answers[q.sets[0]] ?? null, derived: null, options: q.answer.options ?? [], hints: [], disabled: null, notes: [] });
  }
  const seen = new Map();
  form.requisites.forEach((r, i) => {
    const mp = m.get(r.id);
    if (!mp?.value_from || NOT_BY_INVESTIGATOR.has(r.fills_by)) return;
    const q = ix.questionByFact.get(mp.value_from);
    if (!q || q.core) return;
    if (!seen.has(mp.value_from)) {
      const answer = c.answers[mp.value_from] ?? null;
      const codes = Array.isArray(answer?.value) ? answer.value.map(keyCode) : [];
      const item = { q, factId: mp.value_from, group: sectionTitle(r), order: i, requisites: [], answer,
        derived: derived[mp.value_from] ?? null, options: r.options, requisite: r, input: r.input ?? {},
        hints: hintsFor(ix, c, mp.value_from, derived), disabled: disabledReason(ix, c, mp.value_from, derived),
        notes: notesForRequisite(ix, formId, r, codes) };
      seen.set(mp.value_from, item);
      out.push(item);
    }
    seen.get(mp.value_from).requisites.push({ id: r.id, number: r.number, label: r.label });
  });
  return out;
}

// Общие сведения о деле, нужные выбранной форме: факт вносится в ее реквизит (в том числе подсказкой работнику учета),
// проверяется ее контролем или определяет подсказки и умолчания ее реквизитов (дата преступления – для перечней УК на дату)
const DATED_FNS = new Set(['uk.category', 'uk.category_code', 'uk.in_list']);
const coreCache = new WeakMap();
export function coreRequisites(ix, formId) {
  if (!coreCache.has(ix)) coreCache.set(ix, new Map());
  const cache = coreCache.get(ix);
  if (cache.has(formId)) return cache.get(formId);
  const out = new Map();
  const add = (fid, r) => {
    if (!out.has(fid)) out.set(fid, []);
    if (r && !out.get(fid).some((x) => x.id === r.id)) out.get(fid).push({ id: r.id, number: r.number, label: r.label });
  };
  const cores = ix.pack.rules.questions.filter((x) => x.core).map((x) => x.sets[0]);
  const ofFact = (v) => v && cores.find((fid) => v === fid || v.startsWith(`${fid}.`));
  const mapped = new Set();
  for (const r of ix.forms.get(formId).requisites) {
    const mp = ix.mapping.get(formId).get(r.id);
    if (mp?.value_from) mapped.add(mp.value_from);
    const fid = ofFact(mp?.value_from) ?? ofFact(mp?.value_hint_from);
    if (fid) add(fid, r);
  }
  if (formId === '1' && ix.reqs.get('1').has('12')) add('fact.crime.crime_date', ix.reqs.get('1').get('12'));
  const refs = (x) => JSON.stringify(x).match(/fact\.[a-z0-9_.]+/g) ?? [];
  for (const ch of ix.pack.rules.checks) if (ch.forms?.includes(formId)) for (const f of refs([ch.when, ch.assert])) if (cores.includes(f)) add(f);
  const rules = [...ix.pack.rules.derived.map((d) => ({ target: d.sets, expr: d.expr })), ...ix.pack.rules.hints.map((h) => ({ target: h.fact, expr: h.when }))];
  for (const { target, expr } of rules) {
    if (!mapped.has(target)) continue;
    for (const f of refs(expr)) if (cores.includes(f)) add(f);
    if (JSON.stringify(expr).match(/"fn":"([a-z_.]+)"/g)?.some((m) => DATED_FNS.has(m.slice(6, -1)))) add('fact.crime.crime_date');
  }
  cache.set(formId, out);
  return out;
}

function sectionTitle(r) {
  const s = (r.section ?? '').toUpperCase();
  if (r.fills_by === 'head') return 'Заполняет начальник органа';
  if (s.startsWith('РАЗДЕЛ 2')) return 'Сведения, которые вносит лицо, ведущее расследование';
  return 'Заголовок карточки';
}

export function lookupOf(r) {
  return r?.classifier_no ?? r?.input?.lookup ?? null;
}

export function codeTitle(ix, r, code, opt) {
  const no = lookupOf(r);
  if (no) {
    const e = ix.clsCode.get(no)?.get(code);
    if (!e) return no === 'okato' ? 'код не найден в загруженном ОКАТО' : `код не найден в справочнике № ${no}`;
    const path = entryPath(e);
    return normText(path ? `${path}: ${e.name}` : e.name);
  }
  const o = opt ?? r.options.find((x) => x.code === code);
  return o ? normText(o.group ? `${o.group}: ${o.value}` : o.value) : '';
}

export function displayOf(ix, r, value) {
  if (empty(value)) return '';
  if (r.field_type === 'date' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))) return isoToRu(value);
  if (Array.isArray(value)) {
    const parts = value.map((k) => {
      const code = keyCode(k);
      const o = r.options?.find((x) => optKey(x) === k) ?? r.options?.find((x) => x.code === code);
      return { code, title: codeTitle(ix, r, code, o) };
    });
    if (r.input?.select === 'overlay_slots') {
      // код бланка складывается из двух чисел (30 + 01 = 31); слотов бывает несколько
      return overlaySlots(parts.map((p) => p.code)).map((pair) => {
        const titles = pair.map((c) => parts.find((p) => p.code === c)?.title ?? '');
        return `${composeOverlay(pair)} = ${pair.map((c, i) => `${c} (${titles[i]})`).join(' + ')}`;
      }).join('; ');
    }
    if (r.input?.select === 'overlay' && parts.length > 1) {
      return `${composeOverlay(parts.map((p) => p.code))} = ${parts.map((p) => `${p.code} (${p.title})`).join(' + ')}`;
    }
    return parts.map((p) => `${p.code} – ${p.title}`).join('; ');
  }
  return normText(String(value));
}

function fillsDisplay(c, formId, r, codes) {
  const fl = r.input?.fills ?? [];
  const vals = c.fills?.[`${formId}|${r.id}`] ?? {};
  const out = [];
  fl.forEach((f, i) => {
    const v = vals[i];
    if (empty(v)) return;
    const forCodes = [f.for_code, ...(f.for_codes ?? [])].filter(Boolean);
    if (forCodes.length && codes.length && !forCodes.some((x) => codes.includes(x))) return;
    out.push(`${f.label}: ${v}${f.unit ? ` ${f.unit}` : ''}`);
  });
  return out.join('; ');
}

function lineOfQualification(ix, c, r) {
  const m = /строка (\d)/.exec(r.label);
  if (!m) return null;
  const a = c.answers['fact.crime.qualification'];
  if (a?.status !== 'answered') return { status: 'unanswered', value: null, display: '', source: null };
  const qual = parseQualification(a.value);
  const date = crimeDate(c);
  const sorted = [...qual.main].map((ref) => ({ ref, c: categoryOfRef(ix.uk, ref, date) }))
    .sort((x, y) => (CATEGORY_RANK[y.c.category] ?? 0) - (CATEGORY_RANK[x.c.category] ?? 0));
  const n = Number(m[1]);
  const stage = qual.segments > 1 ? sorted[n - 1]?.ref.stageRef : n === 1 ? qual.refs.find((x) => x.article === '30') : null;
  if (!sorted[n - 1]) return { status: 'not_applicable', value: null, display: '', source: `В квалификации ${sorted.length} ${sorted.length === 1 ? 'статья' : 'статьи'} – строка ${n} не заполняется` };
  const text = refToText(sorted[n - 1].ref) + (stage ? ` (с ${refToText(stage)})` : '');
  return { status: 'fill', value: text, display: text, source: `Квалификация (ответ пользователя), строка ${n} в порядке убывания тяжести` };
}

export function buildMemo(ix, c, formId) {
  const derived = deriveAll(ix, c);
  const form = ix.forms.get(formId);
  const m = ix.mapping.get(formId);
  const rows = form.requisites.map((r) => {
    const mp = m.get(r.id);
    const row = { id: r.id, number: r.number, label: r.label, fills_by: r.fills_by, field_type: r.field_type, classifier_no: r.classifier_no,
      value: null, display: '', source: null, status: 'unanswered', notes: notesForRequisite(ix, formId, r), requisite: r, suggest: [] };
    if (NOT_BY_INVESTIGATOR.has(r.fills_by)) {
      const hint = mp?.value_hint_from ? factValue(ix, c, mp.value_hint_from, derived) : null;
      // Раздел 1: номер дела, КРСП, даты, внесенные следователем, впечатываются в карточку
      // (замечание от 19.09.2026); без сведений реквизит остается работнику учета
      if (r.fills_by === 'registrar' && !empty(hint)) {
        Object.assign(row, { status: 'fill', value: hint, display: displayOf(ix, r, hint), source: 'Сведения дела (раздел 1 – внесено следователем)' });
        return row;
      }
      row.status = `fills_${r.fills_by}`;
      if (!empty(hint)) { row.display = displayOf(ix, r, hint); row.source = 'Сведения дела – подсказка, заполняет не следователь'; }
      return row;
    }
    const fid = mp?.value_from;
    if (fid === 'fact.crime.qualification') {
      const line = lineOfQualification(ix, c, r);
      if (line) return { ...row, ...line };
    }
    const a = fid ? c.answers[fid] : null;
    const d = fid ? derived[fid] : null;
    const dis = fid ? disabledReason(ix, c, fid, derived) : null;
    if (a?.status === 'answered' && !empty(a.value)) {
      Object.assign(row, { status: 'fill', value: a.value, display: displayOf(ix, r, a.value), source: 'Ответ пользователя' });
      if (d?.value && JSON.stringify(d.value) !== JSON.stringify(a.value)) row.warning = `Расходится с ${d.status === 'hint' ? 'подсказкой' : 'умолчанием'}: ${displayOf(ix, r, d.value)}. ${d.source}`;
      if (dis) row.warning = `${row.warning ? `${row.warning}. ` : ''}${dis.reason}`;
    } else if (dis) {
      Object.assign(row, { status: 'disabled', source: dis.reason });
    } else if (a?.status === 'na') {
      Object.assign(row, { status: 'not_applicable', source: 'Ответ пользователя: не применимо' });
    } else if (d) {
      Object.assign(row, { status: d.status, value: d.value, display: displayOf(ix, r, d.value), source: d.source });
    } else if (a?.status === 'unknown') {
      Object.assign(row, { status: 'unknown', source: 'Ответ пользователя: уточнить позже' });
    }
    const codes = Array.isArray(row.value) ? row.value.map(keyCode) : [];
    row.notes = notesForRequisite(ix, formId, r, codes);
    const extra = fillsDisplay(c, formId, r, codes);
    if (extra) row.display = row.display ? `${row.display}; ${extra}` : extra;
    if (extra && !row.source) row.source = 'Дополнительные поля реквизита (ответ пользователя)';
    if (formId === '1' && r.id === '12') {
      const dt = c.answers['fact.crime.crime_date'];
      if (dt?.status === 'answered') {
        row.display = `${row.display ? `${row.display}; ` : ''}дата совершения: ${isoToRu(dt.value)}`;
        row.source = row.source ? `${row.source}; дата – общие сведения о деле` : 'Дата – общие сведения о деле';
      }
    }
    if (fid) row.suggest = hintsFor(ix, c, fid, derived);
    if (row.suggest.length && !['fill', 'not_applicable', 'disabled'].includes(row.status)) {
      row.hint = row.suggest.map((h) => `${h.text} (коды: ${h.codes.slice(0, 12).join(', ')}${h.codes.length > 12 ? '…' : ''})`).join('; ');
    }
    return row;
  });
  const checks = runChecks(ix, c, formId, rows, derived);
  const summary = {};
  for (const r of rows) summary[r.status] = (summary[r.status] ?? 0) + 1;
  // facts и fills – исходные сведения карточки: по ним бланк раскладывает составные реквизиты
  // (дата и время, дополнительные поля, коды из профиля) по своим клеткам (Фаза 1.6)
  return { form: formId, title: form.title, edition: form.edition, rows, checks, summary, built: todayIso(),
    facts: c.answers ?? {}, fills: c.fills ?? {} };
}

export function runChecks(ix, c, formId, rows, derived) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const byNumber = new Map(rows.map((r) => [r.number, r]));
  const base = {
    ...ruleCtx(ix, c, derived),
    req: (id) => {
      const r = byId.get(id) ?? byNumber.get(id);
      if (!r || r.status === 'disabled' || r.status === 'not_applicable') return null;
      if (['fills_ic', 'fills_registrar', 'fills_court'].includes(r.status)) return r.value;
      return r.value;
    },
  };
  const results = [];
  for (const chk of ix.pack.rules.checks) {
    // межкарточные правила проверяются только по пакету события (runPackageChecks)
    if (chk.scope === 'package') continue;
    if (!chk.forms.includes('*') && !chk.forms.includes(formId)) continue;
    const rowLevel = JSON.stringify(chk).includes('req.*') || 'fills_by' in chk.when || 'field_type' in chk.when || 'field_type_in' in chk.when;
    try {
      if (rowLevel) {
        const bad = rows.filter((row) => {
          const ctx = { ...base, requisite: row.requisite };
          return evalExpr(chk.when, ctx) && !evalExpr(chk.assert, ctx);
        });
        if (bad.length) results.push({ ...chk, requisites: bad.map((b) => b.number) });
      } else if (evalExpr(chk.when, base) && !evalExpr(chk.assert, base)) {
        results.push({ ...chk, requisites: [] });
      }
    } catch (e) {
      results.push({ ...chk, severity: 'warning', message: `Проверка не выполнена: ${e.message}`, requisites: [] });
    }
  }
  return results;
}

export function memoToText(ix, memo, caseTitle = '') {
  const lines = [`Памятка по заполнению: ${sentenceCase(memo.title)} (форма № ${memo.form}, ред. ${memo.edition})`];
  if (caseTitle) lines.push(caseTitle);
  lines.push(`Составлена ${isoToRu(memo.built)}. Памятка – подсказка, а не карточка: коды проверяет подписант.`, '');
  for (const ch of memo.checks) lines.push(`${ch.severity === 'error' ? 'ОШИБКА' : 'Внимание'}: ${ch.message}${ch.requisites.length ? ` (р. ${ch.requisites.join(', ')})` : ''}`);
  if (memo.checks.length) lines.push('');
  for (const r of memo.rows) {
    lines.push(`${r.number}. ${shortLabel(displayLabel(r.requisite), 120)} – ${STATUS_RU[r.status]}${r.display ? `: ${r.display}` : ''}${r.source ? ` [${r.source}]` : ''}${r.hint ? ` {${r.hint}}` : ''}`);
  }
  return lines.join('\n');
}
