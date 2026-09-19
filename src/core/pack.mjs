// Индексы пакета данных для ядра.

export function optKey(o) {
  return `${o.group ?? ''}|${o.code}`;
}

export function keyCode(key) {
  const s = String(key);
  return s.includes('|') ? s.slice(s.indexOf('|') + 1) : s;
}

export function indexPack(pack) {
  const ix = {
    pack,
    forms: new Map(),
    reqs: new Map(), // form -> Map(id -> requisite)
    mapping: new Map(), // form -> Map(id -> mapping)
    facts: new Map(),
    questionByFact: new Map(),
    notesByReq: new Map(),
    notesByCode: new Map(),
    classifiers: new Map(),
    clsCode: new Map(), // no -> Map(code -> entry)
    clsUsage: new Map(),
    derivedByFact: new Map(),
  };
  for (const f of pack.forms) {
    ix.forms.set(f.form, f);
    ix.reqs.set(f.form, new Map(f.requisites.map((r) => [r.id, r])));
    ix.mapping.set(f.form, new Map());
    for (const r of f.requisites) if (r.classifier_no) {
      if (!ix.clsUsage.has(r.classifier_no)) ix.clsUsage.set(r.classifier_no, []);
      ix.clsUsage.get(r.classifier_no).push({ form: f.form, id: r.id, number: r.number, label: r.label });
    }
  }
  for (const m of pack.rules.mapping) ix.mapping.get(m.form)?.set(m.requisite, m);
  for (const f of pack.rules.facts) ix.facts.set(f.id, f);
  for (const q of pack.rules.questions) for (const s of q.sets) ix.questionByFact.set(s, q);
  for (const d of pack.rules.derived) ix.derivedByFact.set(d.sets, [...(ix.derivedByFact.get(d.sets) ?? []), d]);
  for (const n of pack.legal.notes) {
    for (const b of n.bindings) {
      const k = `${b.form}|${b.requisite}`;
      if (!ix.notesByReq.has(k)) ix.notesByReq.set(k, []);
      if (!ix.notesByReq.get(k).includes(n)) ix.notesByReq.get(k).push(n);
    }
    if (n.classifier) for (const c of n.classifier.codes ?? []) ix.notesByCode.set(`${n.classifier.no}|${c}`, [...(ix.notesByCode.get(`${n.classifier.no}|${c}`) ?? []), n]);
  }
  for (const [no, c] of Object.entries(pack.classifiers)) {
    if (c.compact && !c.entries) c.entries = c.compact.rows.map(([code, name, v, o]) => ({ code, name, section: `${c.compact.dict[v]}; ${c.compact.dict[o]}` }));
    const key = /^\d+$/.test(no) ? Number(no) : no;
    ix.classifiers.set(key, c);
    ix.clsCode.set(key, new Map(c.entries.map((e) => [String(e.code), e])));
  }
  ix.uk = buildUkIndex(pack.uk.articles);
  return ix;
}

export function optionsOf(ix, formId, reqId) {
  return ix.reqs.get(formId)?.get(reqId)?.options ?? [];
}
