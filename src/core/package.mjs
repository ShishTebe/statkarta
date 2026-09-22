// Пакет карточек по событию (Фаза 1.5): состав по events.json, проекция дела на карточку, опросник пакета,
// памятки с переносами, межкарточный контроль, выставление и карточки «изменить».
// Опросник, памятка и контроль одной карточки – функции engine.mjs, работающие на проекции (без изменений Фазы 1).

const evCache = new WeakMap();
export function eventsIndex(ix) {
  if (evCache.has(ix)) return evCache.get(ix);
  const p = ix.pack.events ?? { events: [], object_attrs: [], transfer_priority: [], mode_codes: {} };
  const out = { byId: new Map(p.events.map((e) => [e.id, e])), list: p.events, attrs: p.object_attrs ?? [],
    priority: p.transfer_priority ?? [], modeCodes: p.mode_codes ?? { requisite: {}, codes: {} },
    profileFacts: p.profile_facts ?? [], profileFills: p.profile_fills ?? [] };
  evCache.set(ix, out);
  return out;
}

const SCOPE_BY_PREFIX = { case: 'case', crime: 'crime', person: 'person', victim: 'victim', victims: 'crime', damage: 'case', court: 'card' };
export function scopeOf(ix, fid) {
  const f = ix.facts.get(fid);
  if (f?.scope) return f.scope;
  if (fid.startsWith('fact.case.record_kind')) return 'card';
  return SCOPE_BY_PREFIX[fid.split('.')[1]] ?? 'card';
}

export function formTitleShort(ix, form, variant) {
  if (form === 'ipk') return variant === 'pr' ? 'ИПК-ПР' : variant === 'lc' ? 'ИПК-ЛЦ' : 'ИПК';
  if (form === 'ipk-in') return 'карта на иностранца';
  return `ф. ${form}`;
}

export function cardTitle(ix, c, card) {
  const objs = ['crime', 'person', 'victim'].filter((k) => card.of[k]).map((k) => objectTitle(c, card.of[k]));
  const mode = card.mode !== 'new' ? ` – ${MODE_RU[card.mode]}` : '';
  return `${formTitleShort(ix, card.form, card.variant)}${objs.length ? `: ${objs.join(', ')}` : ''}${mode}`;
}

export function activeCards(ev) {
  return ev.cards.filter((k) => !k.removed);
}

// ---- объекты события и карточки ----

function eventCrimes(c, ev) {
  return ev.refs.crimes.length ? ev.refs.crimes : c.crimes.map((x) => x.id);
}

export function crimesOfCard(c, ev, card) {
  if (card.of.crime) return [card.of.crime];
  const holder = getObject(c, card.of.person ?? card.of.victim);
  if (holder) {
    const inEvent = new Set(eventCrimes(c, ev));
    const own = holder.crimes.filter((x) => inEvent.has(x));
    return own.length ? own : holder.crimes;
  }
  return eventCrimes(c, ev);
}

export function personOfCard(c, ev, card) {
  if (card.of.person) return card.of.person;
  if (card.of.victim) return null;
  const crime = crimesOfCard(c, ev, card)[0];
  const linked = (id) => getObject(c, id)?.crimes.includes(crime);
  return ev.refs.persons.find(linked) ?? c.persons.find((p) => p.crimes.includes(crime))?.id ?? null;
}

export function victimOfCard(c, ev, card) {
  if (card.of.victim) return card.of.victim;
  const crime = crimesOfCard(c, ev, card)[0];
  const linked = (id) => getObject(c, id)?.crimes.includes(crime);
  return ev.refs.victims.find(linked) ?? c.victims.find((v) => v.crimes.includes(crime))?.id ?? null;
}

// ---- контекст правил событий ----

function eventValue(ev, key) {
  const k = key.slice('event.'.length);
  return k === 'date' ? ev.date : ev.attrs?.[k] ?? null;
}

function ruleContext(ix, c, ev, extra = {}) {
  return {
    ix, caseForms: [], req: () => null, status: () => null,
    fact: (id) => {
      const scope = scopeOf(ix, id);
      const cont = scope === 'case' ? (id.split('.')[1] === 'damage' ? c.damage : c.case) : extra.crime && scope === 'crime' ? getObject(c, extra.crime) : null;
      // сведения на дату события; если на эту дату их еще нет (событие раньше) – последние известные по делу
      const a = cont ? factAt(c, cont, id, ev.id) ?? factAt(c, cont, id) : null;
      return a?.status === 'answered' ? a.value : null;
    },
    event: (key) => eventValue(ev, key),
    attr: (key) => {
      const [, owner, name] = key.split('.');
      if (owner === 'damage') return c.damage.attrs?.[name] ?? null;
      return getObject(c, extra.object)?.attrs?.[name] ?? null;
    },
    hadCard: (form, variant) => {
      const rank = eventRank(c, ev.id);
      return c.events.some((e) => eventRank(c, e.id) < rank && activeCards(e).some((k) => k.form === form && (!variant || k.variant === variant) &&
        (!extra.crime || k.of.crime === extra.crime)));
    },
    ...extra.ctx,
  };
}

export function isFinalEvent(ix, c, ev) {
  const def = eventsIndex(ix).byId.get(ev.type);
  if (!def) return false;
  if (typeof def.final === 'boolean') return def.final;
  try { return !!evalExpr(def.final, ruleContext(ix, c, ev)); } catch { return false; }
}

// Факты, которые событие задает само (дата возбуждения и т. п.)
export function applyEventFacts(ix, c, ev) {
  const def = eventsIndex(ix).byId.get(ev.type);
  for (const s of def?.sets_facts ?? []) {
    // значение из события (дата) или постоянное значение события (вид в ф. 1 р. 11)
    const v = s.value !== undefined ? s.value : s.from?.startsWith('event.') ? eventValue(ev, s.from) : null;
    if (v !== null && v !== undefined && v !== '') setFactVersion(c, c.case, s.fact, 'answered', v, ev.id);
  }
}

// ---- состав пакета (FR-29, FR-30) ----

function instancesOf(c, ev, per) {
  const crimes = eventCrimes(c, ev);
  const persons = ev.refs.persons;
  const victims = ev.refs.victims;
  switch (per) {
    case 'case': return [{}];
    case 'crime': return ev.refs.crimes.map((crime) => ({ crime }));
    case 'person': return persons.map((person) => ({ person }));
    case 'victim': return victims.map((victim) => ({ victim }));
    case 'person_crime': {
      const inEvent = new Set(crimes);
      return persons.flatMap((person) => (getObject(c, person)?.crimes ?? []).filter((x) => inEvent.has(x)).map((crime) => ({ person, crime })));
    }
    case 'crime_without_person':
      return ev.refs.crimes.filter((crime) => !persons.some((p) => getObject(c, p)?.crimes.includes(crime))).map((crime) => ({ crime }));
    case 'foreign_participant':
      return [...persons.filter((id) => getObject(c, id)?.attrs?.foreign === true).map((person) => ({ person })),
        ...victims.filter((id) => getObject(c, id)?.attrs?.foreign === true).map((victim) => ({ victim }))];
    default: throw new Error(`Неизвестная кратность карточки: ${per}`);
  }
}

export function cardKey(evId, form, variant, of) {
  const o = ['crime', 'person', 'victim'].filter((k) => of[k]).map((k) => of[k]).join('+');
  return `${evId}|${form}${variant ? `:${variant}` : ''}|${o}`;
}

// Начальные значения карточки из события (ф. 3 р. 8: номер дела, с которым соединено, из которого выделено)
function ruleCardFills(rule, ev) {
  const fills = {};
  for (const f of rule.card_fills ?? []) {
    const v = f.from.startsWith('event.') ? eventValue(ev, f.from) : null;
    if (v === null || v === undefined || v === '') continue;
    const k = `${rule.form}|${f.requisite}`;
    fills[k] ??= {};
    fills[k][f.index] = String(v);
  }
  return fills;
}

function ruleCardFacts(rule, ev) {
  const facts = {};
  for (const f of rule.card_facts ?? []) facts[f.fact] = [{ event: ev.id, status: 'answered', value: f.value }];
  return facts;
}

// Реквизиты карточки, которые относятся к событию: на каждое событие – своя карточка ф. 3 со своим
// набором реквизитов (замечание от 19.09.2026). Остальные реквизиты формы в ней не заполняются.
// null – ограничений нет (карточка добавлена вручную или правило события перечня не задает).
export function cardRequisiteScope(ix, card) {
  if (!card.rule) return null;
  const [type, i] = card.rule.split('#');
  const def = eventsIndex(ix).byId.get(type);
  const rule = def?.cards?.[Number(i)];
  if (!rule || (!rule.requisites && !rule.optional_requisites)) return null;
  const common = ix.pack.events?.card_common_requisites?.[card.form] ?? [];
  return { required: new Set([...common, ...(rule.requisites ?? [])]), optional: new Set(rule.optional_requisites ?? []), title: def.title };
}

function inScope(scope, id) {
  return !scope || scope.required.has(id) || scope.optional.has(id);
}

export function composePackage(ix, c, ev) {
  const def = eventsIndex(ix).byId.get(ev.type);
  if (!def) return [];
  if (def.action === 'spawn_case' && !ev.attrs?.spawned_from) return [];
  const out = [];
  def.cards.forEach((rule, i) => {
    for (const of of instancesOf(c, ev, rule.per)) {
      const ctx = ruleContext(ix, c, ev, { crime: of.crime, object: of.person ?? of.victim ?? of.crime });
      let ok = true;
      if (rule.when) { try { ok = !!evalExpr(rule.when, ctx); } catch { ok = false; } }
      if (!ok) continue;
      const key = cardKey(ev.id, rule.form, rule.variant, of);
      if (out.some((k) => k.key === key)) continue;
      out.push({ key, form: rule.form, variant: rule.variant ?? null, of, mode: 'new', origin: 'rule', rule: `${ev.type}#${i}`, note: rule.note ?? null,
        facts: ruleCardFacts(rule, ev), fills: ruleCardFills(rule, ev), issued: null });
    }
  });
  return out;
}

// Сверка состава по правилам с текущим: ручные добавления и удаления сохраняются, выставленные карточки не трогаются
export function syncPackage(ix, c, ev) {
  const fresh = composePackage(ix, c, ev);
  const keep = [];
  for (const k of ev.cards) {
    if (k.origin !== 'rule' || k.issued || fresh.some((f) => f.key === k.key)) keep.push(k);
  }
  for (const f of fresh) if (!keep.some((k) => k.key === f.key)) keep.push(f);
  const order = eventsIndex(ix).priority;
  ev.cards = keep.sort((a, b) => order.indexOf(a.form) - order.indexOf(b.form) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return ev.cards;
}

export function removeCardManually(ev, key) {
  const k = ev.cards.find((x) => x.key === key);
  if (!k || k.issued) return false;
  if (k.origin === 'rule') k.removed = true; else ev.cards = ev.cards.filter((x) => x.key !== key);
  return true;
}

export function restoreCard(ev, key) {
  const k = ev.cards.find((x) => x.key === key);
  if (k) delete k.removed;
}

export function addCardManually(ix, c, ev, { form, variant = null, of = {} }) {
  const key = `${cardKey(ev.id, form, variant, of)}#manual`;
  if (ev.cards.some((k) => k.key === key && !k.removed)) return null;
  const card = { key, form, variant, of: { ...of }, mode: 'new', origin: 'manual_add', rule: null, note: null, facts: {}, fills: {}, issued: null };
  ev.cards.push(card);
  return card;
}

// Выделение дела: новое дело с копией выбранных объектов (значения на дату события) и пакетом по правилу
export function spawnCase(ix, c, ev, { today = todayIso() } = {}) {
  const nc = createCase2({ edition: c.edition, today });
  nc.title = ev.attrs?.new_case_number ? `Выделенное дело ${ev.attrs.new_case_number}` : 'Выделенное дело';
  const flat = (from, to) => {
    for (const fid of Object.keys(from.facts ?? {})) {
      const a = factAt(c, from, fid, ev.id);
      if (a) to.facts[fid] = [{ event: null, status: a.status, value: a.value }];
    }
  };
  flat(c.case, nc.case);
  flat(c.damage, nc.damage);
  nc.damage.attrs = { ...c.damage.attrs };
  const pick = (kind, ids) => {
    for (const id of ids) {
      const o = getObject(c, id);
      if (!o) continue;
      const copy = addObject(nc, kind, { id: o.id, label: o.label, attrs: o.attrs, crimes: (o.crimes ?? []).filter((x) => ev.refs.crimes.includes(x)) });
      flat(o, copy);
    }
  };
  pick('crime', ev.refs.crimes);
  pick('person', ev.refs.persons);
  pick('victim', ev.refs.victims);
  if (ev.attrs?.new_case_number) nc.case.facts['fact.case.case_number'] = [{ event: null, status: 'answered', value: ev.attrs.new_case_number }];
  const src = factAt(c, c.case, 'fact.case.case_number', ev.id) ?? factAt(c, c.case, 'fact.case.case_number');
  const nev = addEvent(nc, { type: ev.type, date: ev.date, refs: ev.refs,
    attrs: { ...ev.attrs, spawned_from: c.id, ...(src?.status === 'answered' && src.value ? { source_case_number: src.value } : {}) } });
  syncPackage(ix, nc, nev);
  ev.attrs = { ...ev.attrs, spawned_case: nc.id };
  return nc;
}

// ---- проекция дела на карточку ----

export function modeRequisite(ix, form) {
  const mc = eventsIndex(ix).modeCodes;
  const explicit = mc.requisite?.[form];
  const req = explicit ?? mc.requisite?.default ?? '2';
  const mp = ix.mapping.get(form)?.get(req);
  if (!mp?.value_from) return null;
  if (!explicit && !mp.value_from.startsWith('fact.case.record_kind')) return null;
  const codes = mc.codes?.[form] ?? (form === 'ipk' ? null : mc.codes?.default);
  return { req, fact: mp.value_from, codes: codes ?? {} };
}

// Значение профиля: собственное поле или строка подписи «должность звание фамилия И.О.» (уточнение от 16.09.2026, п. В-13)
const SIGN_FIELDS = {
  investigator_line: ['investigator_position', 'investigator_rank', 'investigator_fio'],
  head_line: ['head_position', 'head_rank', 'head_fio'],
  prosecutor_line: ['prosecutor_position', 'prosecutor_rank', 'prosecutor_fio'],
};
export function profileValue(profile, key) {
  if (SIGN_FIELDS[key]) {
    return SIGN_FIELDS[key].map((k) => (profile[k] ?? '').trim()).filter(Boolean).join(' ') || null;
  }
  const v = profile[key];
  return v === undefined || v === null || v === '' ? null : v;
}

export function cardView(ix, c, ev, card, profile = {}) {
  const answers = {};
  const origins = {};
  const put = (cont, fid) => {
    const a = factAt(c, cont, fid, ev.id);
    if (a && !(fid in answers)) answers[fid] = { status: a.status, value: a.value };
  };
  const all = (cont) => { for (const fid of Object.keys(cont?.facts ?? {})) put(cont, fid); };
  all(card);
  const crimes = crimesOfCard(c, ev, card).map((id) => getObject(c, id)).filter(Boolean);
  if (crimes.length > 1) {
    // квалификация по нескольким эпизодам – в одной строке через «;», остальные сведения – первого эпизода
    const quals = crimes.map((o) => factAt(c, o, 'fact.crime.qualification', ev.id)).filter((a) => a?.status === 'answered' && a.value);
    if (quals.length && !answers['fact.crime.qualification']) {
      answers['fact.crime.qualification'] = { status: 'answered', value: quals.map((a) => a.value).join('; ') };
      if (quals.length > 1) origins['fact.crime.qualification'] = `Квалификация по эпизодам ${crimes.map((o) => o.n).join(', ')}`;
    }
  }
  for (const o of crimes) all(o);
  all(getObject(c, personOfCard(c, ev, card)));
  all(getObject(c, victimOfCard(c, ev, card)));
  // карта на иностранца-потерпевшего: анкетные реквизиты лица берутся из сведений потерпевшего
  if (card.of.victim && !card.of.person) {
    const v = getObject(c, card.of.victim);
    for (const fid of Object.keys(v?.facts ?? {})) if (fid.startsWith('fact.person.')) put(v, fid);
  }
  all(c.damage);
  all(c.case);
  // сведения профиля органа подставляются по таблице пакета событий (FR-36)
  for (const pf of eventsIndex(ix).profileFacts) {
    if (answers[pf.fact]) continue;
    const v = profileValue(profile, pf.from);
    if (v === null) continue;
    answers[pf.fact] = { status: 'answered', value: pf.kind === 'code' ? [`|${v}`] : v };
    origins[pf.fact] = 'Профиль органа';
  }
  const mr = modeRequisite(ix, card.form);
  if (mr && !answers[mr.fact]) {
    const code = mr.codes[card.mode];
    const opt = ix.reqs.get(card.form).get(mr.req)?.options.find((o) => o.code === code);
    if (opt) { answers[mr.fact] = { status: 'answered', value: [optKey(opt)] }; origins[mr.fact] = `Режим карточки «${MODE_RU[card.mode]}»`; }
  }
  const forms = [...new Set(c.events.flatMap((e) => activeCards(e).map((k) => k.form)))];
  return { answers, fills: viewFills(ix, card, profile), forms, created: ev.date, origins, variant: card.variant };
}

// Применяется ли правило профиля к форме: перечень карточек может задаваться в профиле (код прокуратуры, подпись прокурора)
function formAllowed(rule, form, profile) {
  if (!rule.forms_from) return true;
  const list = profile[rule.forms_from];
  return (Array.isArray(list) ? list : rule.default_forms ?? []).includes(form);
}

// Подписи из профиля, которые выводятся под памяткой карточки
export function profileSignatures(ix, form, profile) {
  const p = ix.pack.events?.profile_signatures ?? [];
  return p.filter((s) => formAllowed(s, form, profile))
    .map((s) => ({ id: s.id, label: s.label, value: profileValue(profile, s.from) }))
    .filter((s) => s.value);
}

// Дополнительные поля реквизита, которые берутся из профиля (код подразделения, код органа прокуратуры)
export function profileFillsOf(ix, form, profile) {
  const out = [];
  for (const pfl of eventsIndex(ix).profileFills) {
    if (!formAllowed(pfl, form, profile)) continue;
    const v = profileValue(profile, pfl.from);
    if (v === null) continue;
    for (const r of ix.forms.get(form).requisites) {
      const i = (r.input?.fills ?? []).findIndex((f) => f.key === pfl.key);
      if (i >= 0) out.push({ key: `${form}|${r.id}`, index: i, value: v, requisite: r.id });
    }
  }
  return out;
}

function viewFills(ix, card, profile) {
  const fills = {};
  for (const [k, v] of Object.entries(card.fills ?? {})) fills[k] = { ...v };
  for (const f of profileFillsOf(ix, card.form, profile)) {
    fills[f.key] ??= {};
    if (fills[f.key][f.index] === undefined || fills[f.key][f.index] === '') fills[f.key][f.index] = f.value;
  }
  return fills;
}

function inVariant(r, variant) {
  return !r?.variants || !variant || r.variants.includes(variant);
}

// ---- переносы между карточками пакета (FR-32) ----

function instanceOf(ix, c, ev, card, fid) {
  const scope = scopeOf(ix, fid);
  if (scope === 'case') return 'case';
  if (scope === 'crime') return crimesOfCard(c, ev, card).join('+');
  if (scope === 'person') return personOfCard(c, ev, card) ?? card.of.victim ?? '-';
  if (scope === 'victim') return victimOfCard(c, ev, card) ?? '-';
  return card.key;
}

export function packageTransfers(ix, c, ev) {
  const order = eventsIndex(ix).priority;
  const cards = [...activeCards(ev)].sort((a, b) => order.indexOf(a.form) - order.indexOf(b.form));
  const primary = new Map();
  const out = new Map();
  for (const card of cards) {
    const m = new Map();
    for (const r of ix.forms.get(card.form).requisites) {
      if (!inVariant(r, card.variant)) continue;
      const mp = ix.mapping.get(card.form).get(r.id);
      if (mp?.match !== 'shared' || !mp.value_from || ['ic', 'registrar', 'court'].includes(r.fills_by)) continue;
      const k = `${mp.value_from}@${instanceOf(ix, c, ev, card, mp.value_from)}`;
      if (!primary.has(k)) primary.set(k, { form: card.form, variant: card.variant, number: r.number, card: card.key });
      else if (primary.get(k).card !== card.key) m.set(r.id, primary.get(k));
    }
    out.set(card.key, m);
  }
  return out;
}

// ---- памятки пакета (FR-35) ----

export function buildCardMemo(ix, c, ev, card, profile = {}, transfers = null) {
  const view = cardView(ix, c, ev, card, profile);
  const memo = buildMemo(ix, view, card.form);
  memo.rows = memo.rows.filter((r) => inVariant(r.requisite, card.variant));
  const scope = cardRequisiteScope(ix, card);
  const outOfScope = new Set();
  if (scope) {
    for (const row of memo.rows) {
      if (scope.required.has(row.id) || String(row.status).startsWith('fills_')) continue;
      if (scope.optional.has(row.id)) {
        if (['unanswered', 'unknown'].includes(row.status)) Object.assign(row, { status: 'not_applicable', source: `Заполняется при наличии сведений (событие «${scope.title}»)` });
        continue;
      }
      outOfScope.add(row.number);
      Object.assign(row, { status: 'not_applicable', value: null, display: '', source: `Не относится к событию «${scope.title}»`, suggest: [], hint: undefined, warning: undefined });
    }
  }
  const tr = (transfers ?? packageTransfers(ix, c, ev)).get(card.key) ?? new Map();
  const fromProfile = new Map();
  for (const f of profileFillsOf(ix, card.form, profile)) {
    if ((card.fills?.[f.key]?.[f.index] ?? '') !== '') continue;
    const label = ix.reqs.get(card.form).get(f.requisite).input.fills[f.index].label.toLowerCase();
    fromProfile.set(f.requisite, [...(fromProfile.get(f.requisite) ?? []), label]);
  }
  for (const row of memo.rows) {
    const fid = ix.mapping.get(card.form).get(row.id)?.value_from;
    if (fid && view.origins[fid] && row.status === 'fill') row.source = view.origins[fid];
    const prof = fromProfile.get(row.id);
    if (prof) row.source = `Профиль органа: ${prof.join(', ')}${row.source && !row.source.startsWith('Дополнительные поля') ? `; ${row.source}` : ''}`;
    const p = tr.get(row.id);
    if (p && row.value !== null && row.value !== undefined && row.value !== '' && !(Array.isArray(row.value) && !row.value.length)) {
      row.transfer = p;
      row.source = `Перенос из ${formTitleShort(ix, p.form, p.variant)}, реквизит ${p.number}${row.source ? ` (${row.source})` : ''}`;
    }
  }
  memo.summary = {};
  for (const r of memo.rows) memo.summary[r.status] = (memo.summary[r.status] ?? 0) + 1;
  memo.checks = memo.checks.filter((ch) => !ch.requisites.length || ch.requisites.some((n) => !outOfScope.has(n) && memo.rows.some((r) => r.number === n)));
  memo.signatures = profileSignatures(ix, card.form, profile);
  memo.card = card.key;
  memo.cardTitle = cardTitle(ix, c, card);
  memo.variant = card.variant;
  memo.mode = card.mode;
  memo.event = { id: ev.id, type: ev.type, date: ev.date };
  return memo;
}

export function buildPackageMemos(ix, c, ev, profile = {}) {
  const transfers = packageTransfers(ix, c, ev);
  const memos = new Map();
  for (const card of activeCards(ev)) memos.set(card.key, buildCardMemo(ix, c, ev, card, profile, transfers));
  return memos;
}

export function memoState(memo) {
  if (memo.checks.some((x) => x.severity === 'error')) return 'errors';
  if (memo.rows.some((r) => r.status === 'default' || r.status === 'hint')) return 'defaults';
  if (memo.rows.some((r) => ['unanswered', 'unknown'].includes(r.status))) return 'incomplete';
  return 'ready';
}

export function packageText(ix, c, ev, memos, pkgChecks = []) {
  const def = eventsIndex(ix).byId.get(ev.type);
  const parts = [`Пакет карточек: ${def?.title ?? ev.type} от ${isoToRu(ev.date)}. Карточек: ${memos.size}.`];
  for (const ch of pkgChecks) parts.push(`${ch.severity === 'error' ? 'ОШИБКА' : 'Внимание'} (пакет): ${ch.message}${ch.where ? ` – ${ch.where}` : ''}`);
  for (const memo of memos.values()) {
    const sign = (memo.signatures ?? []).map((s) => `${s.label}: ${s.value}`).join('\n');
    parts.push(`\n==== ${memo.cardTitle} ====\n${memoToText(ix, memo)}${sign ? `\n\nПодписи (из профиля органа):\n${sign}` : ''}`);
  }
  return parts.join('\n');
}

// ---- опросник пакета (FR-31) ----

const GROUP_ORDER = { case: 0, crime: 1, person: 2, victim: 3, card: 4 };

export function packageQuestions(ix, c, ev, profile = {}) {
  const items = new Map();
  const cards = activeCards(ev);
  cards.forEach((card, cardIdx) => {
    const view = cardView(ix, c, ev, card, profile);
    const qs = questionsForForm(ix, view, card.form);
    const reqScope = cardRequisiteScope(ix, card);
    for (const qi of qs) {
      const reqs = qi.requisites.filter((r) => inVariant(ix.reqs.get(card.form).get(r.id), card.variant) && inScope(reqScope, r.id));
      if (qi.requisites.length && !reqs.length) continue;
      if (view.origins[qi.factId]?.startsWith('Режим карточки')) continue;
      const scope = scopeOf(ix, qi.factId);
      let insts;
      if (scope === 'case') insts = ['case'];
      else if (scope === 'crime') insts = crimesOfCard(c, ev, card);
      else if (scope === 'person') insts = [personOfCard(c, ev, card) ?? card.of.victim].filter(Boolean);
      else if (scope === 'victim') insts = [victimOfCard(c, ev, card)].filter(Boolean);
      else insts = [card.key];
      for (const inst of insts) {
        const key = `${qi.factId}@${inst}`;
        if (!items.has(key)) {
          const cont = scope === 'card' ? card : scope === 'case' ? (qi.factId.startsWith('fact.damage.') ? c.damage : c.case) : getObject(c, inst);
          const a = factAt(c, cont, qi.factId, ev.id);
          items.set(key, { ...qi, key, scope, inst, cardIdx, answer: a ? { status: a.status, value: a.value } : null,
            origin: view.origins[qi.factId] ?? null, requisites: [], cards: [] });
        }
        const it = items.get(key);
        if (!it.cards.includes(card.key)) it.cards.push(card.key);
        for (const r of reqs) it.requisites.push({ ...r, form: card.form, variant: card.variant, card: card.key, cardTitle: cardTitle(ix, c, card) });
      }
    }
  });
  // реквизит, у которого есть прямой вопрос, не относится к общему вопросу о деле (дата возбуждения и ее реквизиты)
  const direct = new Set();
  for (const it of items.values()) if (!it.q.core) for (const r of it.requisites) direct.add(`${r.card}|${r.id}`);
  for (const it of items.values()) if (it.q.core) it.requisites = it.requisites.filter((r) => !direct.has(`${r.card}|${r.id}`));
  const groups = new Map();
  const groupOf = (it) => {
    if (it.scope === 'case') return { id: 'case', title: 'Дело', order: [0, 0] };
    if (it.scope === 'card') {
      const card = cards[it.cardIdx];
      return { id: card.key, title: `Карточка ${cardTitle(ix, c, card)}`, order: [GROUP_ORDER.card, it.cardIdx] };
    }
    const o = getObject(c, it.inst);
    return { id: it.inst, title: objectTitle(c, it.inst), order: [GROUP_ORDER[it.scope], o?.n ?? 0] };
  };
  for (const it of items.values()) {
    const g = groupOf(it);
    if (!groups.has(g.id)) groups.set(g.id, { ...g, items: [] });
    groups.get(g.id).items.push(it);
  }
  const list = [...groups.values()].sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1]);
  let total = 0;
  let closed = 0;
  for (const g of list) for (const it of g.items) {
    total += it.requisites.length;
    if (it.answer || (it.derived && it.derived.status !== 'not_applicable') || it.origin) closed += it.requisites.length;
  }
  return { groups: list, total, closed };
}

export function setPackageAnswer(c, ev, item, status, value = null) {
  let cont;
  if (item.scope === 'card') cont = ev.cards.find((k) => k.key === item.inst);
  else if (item.scope === 'case') cont = item.factId.startsWith('fact.damage.') ? c.damage : c.case;
  else cont = getObject(c, item.inst);
  if (!cont) throw new Error('Экземпляр вопроса не найден');
  setFactVersion(c, cont, item.factId, status, status === 'answered' ? value : null, ev.id);
}

export function setCardFill(ev, cardKeyValue, reqId, index, value) {
  const card = ev.cards.find((k) => k.key === cardKeyValue);
  const k = `${card.form}|${reqId}`;
  card.fills ??= {};
  card.fills[k] ??= {};
  if (value === null || value === undefined || value === '') delete card.fills[k][index];
  else card.fills[k][index] = value;
}

// ---- межкарточный контроль (FR-34) ----

export function runPackageChecks(ix, c, ev, memos) {
  const cards = activeCards(ev);
  const related = (card, crime) => card.of.crime === crime || (!card.of.crime && [card.of.person, card.of.victim].some((id) => id && getObject(c, id)?.crimes.includes(crime)));
  const reqValue = (list, form, req) => {
    for (const card of list.filter((k) => k.form === form)) {
      const row = memos.get(card.key)?.rows.find((r) => r.id === req || r.number === req);
      if (row && row.value !== null && row.value !== undefined && row.value !== '' && !(Array.isArray(row.value) && !row.value.length)) return row.value;
    }
    return null;
  };
  const results = [];
  for (const chk of ix.pack.rules.checks.filter((x) => x.scope === 'package')) {
    const scopes = chk.per === 'crime' ? ev.refs.crimes.map((crime) => ({ crime })) : [{}];
    for (const sc of scopes) {
      const inScope = sc.crime ? cards.filter((k) => related(k, sc.crime)) : cards;
      const pkg = {
        has_form: (form) => cards.some((k) => k.form === form),
        count_cards: (forms) => inScope.filter((k) => forms.includes(k.form)).length,
        count_cards_case: (forms) => c.events.flatMap((e) => activeCards(e)).filter((k) => forms.includes(k.form) && (!sc.crime || related(k, sc.crime))).length,
        count_objects: (kind) => (ev.refs[kind] ?? []).filter((id) => !sc.crime || getObject(c, id)?.crimes.includes(sc.crime)).length,
        req: (form, req) => reqValue(inScope, form, req),
      };
      const ctx = ruleContext(ix, c, ev, { crime: sc.crime, ctx: { pkg } });
      try {
        if (evalExpr(chk.when, ctx) && !evalExpr(chk.assert, ctx)) results.push({ ...chk, where: sc.crime ? objectTitle(c, sc.crime) : null });
      } catch (e) {
        results.push({ ...chk, severity: 'warning', message: `Проверка пакета не выполнена: ${e.message}`, where: null });
      }
    }
  }
  return results;
}

// ---- выставление и карточки «изменить» (FR-33, FR-38) ----

function snapshotRows(memo) {
  return memo.rows.filter((r) => !String(r.status).startsWith('fills_')).map((r) => ({ id: r.id, number: r.number, status: r.status, display: r.display }));
}

export function issueCard(ix, c, ev, card, profile = {}, { today = todayIso() } = {}) {
  const memo = buildCardMemo(ix, c, ev, card, profile);
  card.issued = { date: today, rows: snapshotRows(memo) };
  journalAdd(c, { action: 'issued', event: ev.id, event_type: ev.type, event_date: ev.date, form: card.form, variant: card.variant, of: card.of, mode: card.mode, at: today });
  return card.issued;
}

export function unissueCard(c, ev, card, { today = todayIso() } = {}) {
  if (!card.issued) return;
  card.issued = null;
  journalAdd(c, { action: 'unissued', event: ev.id, event_type: ev.type, event_date: ev.date, form: card.form, variant: card.variant, of: card.of, mode: card.mode, at: today });
}

// Выставленные карточки, чьи сведения изменились после отметки (сравнение со снимком)
export function changeProposals(ix, c, profile = {}) {
  const out = [];
  for (const ev of c.events) {
    const transfers = packageTransfers(ix, c, ev);
    for (const card of activeCards(ev)) {
      if (!card.issued) continue;
      const newer = ev.cards.find((k) => k.based_on === card.key && !k.removed);
      if (newer) continue;
      const memo = buildCardMemo(ix, c, ev, card, profile, transfers);
      const now = new Map(snapshotRows(memo).map((r) => [r.id, r]));
      const diff = card.issued.rows.filter((r) => {
        const n = now.get(r.id);
        return n && (n.display !== r.display || n.status !== r.status);
      }).map((r) => ({ number: r.number, was: r.display, now: now.get(r.id).display }));
      if (diff.length) out.push({ event: ev.id, card: card.key, title: cardTitle(ix, c, card), diff });
    }
  }
  return out;
}

// Карточка на основании выставленной: корректирующая (mode «change») или отменяющая (mode «remove»)
export function createChangeCard(c, evId, baseKey, mode = 'change') {
  const ev = getEvent(c, evId);
  const base = ev.cards.find((k) => k.key === baseKey);
  const n = ev.cards.filter((k) => k.based_on === baseKey).length + 1;
  const card = { key: `${baseKey}#${mode}${n}`, form: base.form, variant: base.variant, of: { ...base.of }, mode, origin: 'change',
    based_on: baseKey, rule: null, note: null, facts: JSON.parse(JSON.stringify(base.facts ?? {})), fills: JSON.parse(JSON.stringify(base.fills ?? {})), issued: null };
  ev.cards.push(card);
  return card;
}
