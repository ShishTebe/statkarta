// Региональные пакеты (ответ В-77, документ 24). Общие данные одинаковы для всех регионов; от региона
// зависят местные коды следственных подразделений в реквизитах «кем расследовано» (ф. 1 р. 40 и др.),
// строка этих кодов в бланках информационного центра и ОКАТО. Пакет региона применяется к пакету
// данных до индексации: regionalPack(pack, regionPack) → новый объект, исходный не меняется.

export const REGION_SCHEMA = 'region/1';

// ОКАТО региона: строки [код, наименование, центр?] → записи справочника с путем по вышестоящим кодам
export function regionOkato(rp) {
  const rows = rp?.okato?.rows ?? [];
  const names = new Map(rows.map((r) => [r[0], r[1]]));
  return {
    no: 'okato', title: 'ОКАТО – Общероссийский классификатор объектов административно-территориального деления',
    edition: rp.edition, source: `${rp.okato?.source ?? ''}; регион ${rp.region} – ${rp.name}`, complete: true, notes: [],
    entries: rows.map(([code, name, center]) => {
      const parents = [...new Set([`${code.slice(0, 2)}000000000`, `${code.slice(0, 5)}000000`, `${code.slice(0, 8)}000`])].filter((p) => p !== code && names.has(p));
      return { code, name, path: parents.map((p) => names.get(p)), section: center ? `центр: ${center}` : undefined };
    }),
  };
}

export function regionPackProblems(rp, index = null) {
  const out = [];
  if (!rp || typeof rp !== 'object') return ['файл не является пакетом региона'];
  if (rp.schema !== REGION_SCHEMA) out.push(`неизвестный формат пакета: ${rp.schema ?? 'не указан'}`);
  if (!/^\d{2}$/.test(String(rp.region ?? ''))) out.push('код региона – две цифры (первые цифры ОКАТО)');
  if (index?.edition && rp.edition !== index.edition) out.push(`редакция пакета ${rp.edition}, а программы – ${index.edition}`);
  if (!Array.isArray(rp.unit_codes)) out.push('нет перечня местных кодов (unit_codes)');
  for (const u of rp.unit_codes ?? []) if (!/^\d{4}$/.test(String(u.code)) || !String(u.value ?? '').trim()) out.push(`местный код «${u.code}»: нужен код из 4 цифр и наименование`);
  const rows = rp.okato?.rows;
  if (!Array.isArray(rows)) out.push('нет ОКАТО региона');
  else if (rows.some((r) => !Array.isArray(r) || !/^\d{11}$/.test(String(r[0])) || String(r[0]).slice(0, 2) !== String(rp.region))) out.push('в ОКАТО есть коды другого региона или не из 11 цифр');
  return out;
}

// Пакет данных с примененным пакетом региона: местные коды – после кода «следственных органов СК РФ»
// в каждом реквизите-цели, ОКАТО – справочником okato
export function regionalPack(pack, rp) {
  const index = pack.regions ?? null;
  if (!rp || !index) return pack;
  const targets = new Map();
  for (const t of index.targets ?? []) targets.set(t.form, [...(targets.get(t.form) ?? []), t.requisite]);
  const forms = pack.forms.map((f) => {
    const reqs = targets.get(f.form);
    if (!reqs || !rp.unit_codes?.length) return f;
    return { ...f, requisites: f.requisites.map((r) => {
      if (!reqs.includes(r.id) && !reqs.includes(r.number)) return r;
      const have = new Set(r.options.map((o) => o.code));
      const at = Math.max(0, r.options.findIndex((o) => o.code === index.after));
      const add = rp.unit_codes.filter((u) => !have.has(u.code)).map((u) => ({ code: u.code, value: u.forms_value?.[f.form] ?? u.value,
        hint: `Местный код региона ${rp.region} (${rp.name}): ${(rp.sources ?? [])[0] ?? 'региональный пакет'}`, region: rp.region }));
      return { ...r, options: [...r.options.slice(0, at + 1), ...add, ...r.options.slice(at + 1)] };
    }) };
  });
  return { ...pack, forms, classifiers: { ...pack.classifiers, okato: regionOkato(rp) }, region: { code: rp.region, name: rp.name, status: rp.status, units: rp.unit_codes?.length ?? 0 } };
}

// Правки текста бланка для региона: в бланках информационного центра региона blank_region напечатана
// его строка местных кодов; для другого региона она заменяется строкой пакета (blank_line) или убирается
export function regionBlankEdits(index, form, rp) {
  if (!index || !rp || rp.region === index.blank_region) return [];
  const line = rp.blank_line?.[form] ?? rp.blank_line?.['*'] ?? '';
  return (index.blank_fragments?.[form] ?? []).map((find) => ({ find, replace: line }));
}
