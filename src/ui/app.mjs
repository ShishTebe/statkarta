// Интерфейс СтатКарты: дело, события, пакет карточек (Фаза 1.5).
// Сведения дела живут в памяти вкладки; на устройство попадают только зашифрованными (FR-37, NFR-02).

const PACK = JSON.parse(document.getElementById('pack').textContent);
// Пакет бланков (Фаза 1.6): есть только в локальной сборке – см. решение о публикации бланков.
const BLANKS = JSON.parse(document.getElementById('blanks')?.textContent || 'null');
// Сведения о сборке: версия, вид (offline – один файл, web – PWA, local – со справочником № 17), адрес публикации
const BUILD = JSON.parse(document.getElementById('build')?.textContent || '{}');
const IX = indexPack(PACK);
const EVX = eventsIndex(IX);
const FORM_TITLES = Object.fromEntries(PACK.forms.map((f) => [f.form, sentenceCase(f.title)]));
const FILLS_RU = { investigator: 'лицо, ведущее расследование', registrar: 'работник регистрационного учета органа', ic: 'информационный центр', head: 'начальник органа (согласует руководитель)', court: 'суд' };
const TYPE_RU = { enum: 'выбор кода', classifier: 'справочник', date: 'дата', text: 'текст' };
const KIND_RU = { crimes: 'Эпизоды', persons: 'Лица', victims: 'Потерпевшие' };
const KIND_ADD = { crimes: 'Добавить эпизод', persons: 'Добавить лицо', victims: 'Добавить потерпевшего' };
const KIND_ONE = { crimes: 'crime', persons: 'person', victims: 'victim' };
const STATE_RU = { ready: 'готова', errors: 'есть ошибки', defaults: 'есть умолчания', incomplete: 'есть незаполненные' };
const MANUAL_EVENT = 'ev.manual';

const state = {
  view: 'case', tab: 'objects', kase: null, cases: [], evId: null, cardKey: null, onlyEmpty: false, qualText: null, pendingImport: null,
  profile: profileLoad(), saved: [], notices: [], dirty: false, password: null, printAll: false,
  addEv: null, cls: { no: 2, q: '', sel: null }, blank: { form: '1', req: null, q: '' }, sheet: null, busy: null,
  doc: null, // разбор постановления: только в памяти вкладки, в файл дела не сохраняется
};

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = normText(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(normText(kid)));
  return el;
}

function put(el, ...kids) {
  for (const kid of kids.flat(2)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(normText(kid)));
  return el;
}

const C = () => state.kase;
const curEvent = () => (state.kase && state.evId ? getEvent(state.kase, state.evId) : null);
const eventTitle = (type) => (type === MANUAL_EVENT ? 'Одна карточка (без события)' : EVX.byId.get(type)?.title ?? type);
const formLabel = (form, variant) => `${formTitleShort(IX, form, variant)} – ${FORM_TITLES[form]}`;
const retentionMonths = () => Number(state.profile.retention_months ?? 6);
const isFinal = (ev) => isFinalEvent(IX, C(), ev);

function touch() {
  state.dirty = true;
}

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});

function render() {
  const app = document.getElementById('app');
  app.replaceChildren(header(), h('main', {}, reviewBanner(), state.updateReady ? h('div', { class: 'notice' }, 'Новая версия загружена. ', h('button', { class: 'btn primary small', onclick: applyUpdate }, 'Обновить')) : null, view()),
    state.printAll && state.kase ? packagePrint() : h('div'),
    state.sheet && state.kase ? sheetPrint() : h('div'));
  document.body.classList.toggle('print-all', state.printAll);
  document.body.classList.toggle('print-sheet', Boolean(state.sheet));
}

function rerender() {
  const y = scrollY;
  const active = document.activeElement?.closest?.('[data-fact]')?.getAttribute('data-fact');
  render();
  scrollTo(0, y);
  if (active) document.querySelector(`[data-fact="${CSS.escape(active)}"]`)?.querySelector('input, textarea')?.focus({ preventScroll: true });
}

function header() {
  const tab = (id, label) => h('button', { 'aria-current': state.view === id ? 'page' : null, onclick: () => { state.view = id; render(); } }, label);
  return h('header', { class: 'top' },
    h('div', { class: 'brand' }, 'СтатКарта', h('small', {}, `данные ${PACK.version}, ред. ${PACK.edition}`)),
    h('nav', { class: 'tabs' }, tab('case', 'Дело'), tab('profile', 'Профиль органа'), tab('cls', 'Справочники'), tab('blank', 'Бланки'), tab('legal', 'Нормативная база')),
    h('div', { class: 'spacer' }),
    state.dirty ? h('span', { class: 'badge b-unanswered' }, 'есть несохраненные изменения') : null,
    BUILD.pages && BUILD.kind !== 'local' ? h('button', { class: 'btn', title: `Версия ${BUILD.app}, данные ${BUILD.data}`, onclick: checkUpdates }, 'Проверить обновления') : null,
    h('button', { class: 'btn danger', onclick: deleteCase, disabled: !state.kase }, 'Удалить данные дела'));
}

// ---------- Обновления (FR-21) и напоминание раз в полгода (FR-22) ----------

const REVIEW_KEY = 'statkarta.reviewed';

const newer = (a, b) => {
  const pa = String(a).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = String(b).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue;
    if (pa[i] === undefined) return false;
    if (pb[i] === undefined) return true;
    return typeof pa[i] === 'number' && typeof pb[i] === 'number' ? pa[i] > pb[i] : String(pa[i]) > String(pb[i]);
  }
  return false;
};

// Только по нажатию и только к адресу публикации; сведения дел не передаются (NFR-01, NFR-02)
async function checkUpdates() {
  let remote;
  try {
    const url = BUILD.kind === 'web' ? 'version.json' : `${BUILD.pages}version.json`;
    remote = await (await fetch(url, { cache: 'no-store' })).json();
  } catch {
    state.notices.push('Проверить обновления не удалось: нет связи с адресом публикации. Приложение работает как обычно.');
    render();
    return;
  }
  const fresh = newer(remote.app, BUILD.app) || newer(remote.data, BUILD.data);
  if (!fresh) {
    state.notices.push(`Обновлений нет: у вас версия ${BUILD.app}, данные ${BUILD.data}.`);
  } else if (BUILD.kind === 'web') {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    state.notices.push(`Вышла версия ${remote.app} (данные ${remote.data}). Сохраните открытое дело и нажмите «Обновить» – сохраненные дела и профиль органа не затрагиваются.`);
    state.updateReady = true;
  } else {
    state.notices.push(`Вышла версия ${remote.app} (данные ${remote.data}). Скачайте новый файл statkarta-offline.html со страницы выпусков и замените им старый: ${BUILD.releases}`);
  }
  render();
}

async function applyUpdate() {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg?.waiting) reg.waiting.postMessage('skip-waiting');
  setTimeout(() => location.reload(), 300);
}

// Последняя «точка сверки» – 01.01 или 01.07 текущего года, не позже сегодняшнего дня
function reviewBoundary(today = todayIso()) {
  const y = today.slice(0, 4);
  return today >= `${y}-07-01` ? `${y}-07-01` : `${y}-01-01`;
}

function reviewNeeded() {
  let last = null;
  try {
    last = localStorage.getItem(REVIEW_KEY);
    // первый запуск: сверка начинается со следующей даты 01.01 или 01.07
    if (!last) { localStorage.setItem(REVIEW_KEY, todayIso()); return false; }
  } catch { return false; }
  return last < reviewBoundary();
}

function icsFile() {
  const ev = (md, title) => ['BEGIN:VEVENT', `UID:statkarta-review-${md}@statkarta`, `DTSTAMP:${todayIso().replace(/-/g, '')}T000000Z`,
    `DTSTART;VALUE=DATE:${todayIso().slice(0, 4)}${md}`, 'RRULE:FREQ=YEARLY', `SUMMARY:${title}`,
    'DESCRIPTION:Проверьте актуальность карточек и справочников: чек-лист в СтатКарте\\, раздел «Нормативная база».', 'END:VEVENT'];
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//StatKarta//RU', 'CALSCALE:GREGORIAN',
    ...ev('0101', 'СтатКарта: сверка карточек и справочников (01.01)'), ...ev('0701', 'СтатКарта: сверка карточек и справочников (01.07)'), 'END:VCALENDAR'].join('\r\n');
}

function reviewBanner() {
  if (!reviewNeeded()) return null;
  return h('div', { class: 'notice review' },
    h('strong', {}, 'Проверьте актуальность карточек и справочников. '),
    `С ${isoToRu(reviewBoundary())} могли измениться формы, справочники и разъяснения. Сверьтесь с чек-листом и обновите приложение, если вышла новая версия. `,
    h('div', { class: 'row toolbar' },
      h('button', { class: 'btn', onclick: () => { state.view = 'legal'; render(); } }, 'Чек-лист проверки'),
      h('button', { class: 'btn primary', onclick: () => { try { localStorage.setItem(REVIEW_KEY, todayIso()); } catch { /* нет хранилища */ } render(); } }, `Проверено ${isoToRu(todayIso())}`),
      h('button', { class: 'btn', onclick: () => downloadBytes('СтатКарта – напоминания.ics', new TextEncoder().encode(icsFile()), 'text/calendar') }, 'Напоминания в календарь (.ics)')));
}

async function deleteCase() {
  if (!confirm('Удалить все сведения по открытому делу, включая сохраненную на устройстве копию? Действие необратимо.')) return;
  const id = state.kase?.id;
  state.kase = null;
  state.evId = null;
  state.cardKey = null;
  state.password = null;
  state.dirty = false;
  if (id) { try { await storeDelete(id); } catch { /* хранилище недоступно */ } }
  await refreshSaved();
  render();
}

function view() {
  if (state.view === 'cls') return clsView();
  if (state.view === 'blank') return blankView();
  if (state.view === 'legal') return legalView();
  if (state.view === 'profile') return profileView();
  return state.kase ? caseShell() : startView();
}

// ---------- Начало работы, сохраненные дела ----------

async function refreshSaved() {
  const list = await storeList();
  const today = todayIso();
  const keep = [];
  for (const r of list) {
    if (r.delete_after && today >= r.delete_after) {
      await storeDelete(r.id);
      state.notices.push(`Сохраненное дело удалено: истек срок хранения ${isoToRu(r.delete_after)}.`);
      continue;
    }
    if (r.remind_at && today >= r.remind_at) {
      state.notices.push(r.delete_after
        ? `Сохраненное дело будет удалено ${isoToRu(r.delete_after)} – выгрузите файл, если он нужен.`
        : 'По сохраненному делу полгода нет финального события. Откройте дело и подтвердите, что оно еще ведется.');
    }
    keep.push(r);
  }
  state.saved = keep;
}

function startView() {
  const wrap = h('div');
  put(wrap, h('div', { class: 'notice' },
    'Памятка – подсказка, а не карточка: коды и сведения проверяет и подписывает лицо, составляющее карточку. ',
    'Сведения дела не покидают устройство: на диск они попадают только зашифрованными под паролем.'));
  for (const n of state.notices) put(wrap, h('div', { class: 'notice' }, n));
  put(wrap, h('div', { class: 'panel' }, h('h2', {}, 'Начало работы'),
    h('div', { class: 'row toolbar' },
      h('button', { class: 'btn primary', onclick: newCase }, 'Новое дело'),
      h('button', { class: 'btn', onclick: () => { newCase(); state.tab = 'document'; render(); } }, 'Новое дело по постановлению о ВУД'),
      h('button', { class: 'btn', onclick: newSingleCard }, 'Одна карточка (быстрый режим)'),
      h('button', { class: 'btn', onclick: importCaseFile }, 'Открыть файл дела')),
    h('p', { class: 'small muted' }, 'Новое дело – объекты учета, события и пакеты карточек. По постановлению о ВУД – программа найдет в нем номер дела, даты, КРСП, квалификацию и лицо, вы подтвердите. Быстрый режим – одна карточка без события, как в версии 0.2.')));
  if (state.pendingImport) {
    put(wrap, h('div', { class: 'panel' }, h('h2', {}, 'Открыть файл дела'),
      h('p', { class: 'small' }, 'Файл зашифрован: введите пароль, которым он был выгружен.'),
      h('div', { class: 'row' },
        h('input', { type: 'password', class: 'search', style: 'max-width:16rem', placeholder: 'Пароль', 'data-pwd': 'import',
          onkeydown: (e) => { if (e.key === 'Enter') openImported(); } }),
        h('button', { class: 'btn primary', onclick: openImported }, 'Открыть'),
        h('button', { class: 'btn', onclick: () => { state.pendingImport = null; render(); } }, 'Отмена')),
      state.pendingImport.error ? h('div', { class: 'err' }, state.pendingImport.error) : null));
  }
  const rows = state.saved.map((r) => h('tr', {},
    h('td', {}, `Дело, сохранено на устройстве${r.delete_after ? `; удаление после ${isoToRu(r.delete_after)}` : ''}`),
    h('td', {}, h('div', { class: 'row' },
      h('input', { type: 'password', class: 'search', style: 'max-width:12rem', placeholder: 'Пароль', 'data-pwd': r.id }),
      h('button', { class: 'btn small', onclick: () => openSaved(r) }, 'Открыть'),
      h('button', { class: 'btn small danger', onclick: async () => { if (confirm('Удалить сохраненную копию дела?')) { await storeDelete(r.id); await refreshSaved(); render(); } } }, 'Удалить')))));
  put(wrap, h('div', { class: 'panel' }, h('h2', {}, `Сохраненные дела (${state.saved.length})`),
    state.saved.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'memo' }, h('tbody', {}, ...rows)))
      : h('p', { class: 'muted small' }, 'Сохраненных дел нет. В хранилище браузера дела лежат только в зашифрованном виде.')));
  return wrap;
}

function newCase() {
  const c = createCase2({ title: 'Дело' });
  addObject(c, 'crime');
  state.kase = c;
  state.evId = null;
  state.tab = 'objects';
  state.password = null;
  touch();
  render();
}

function newSingleCard() {
  const c = createCase2({ title: 'Одна карточка' });
  addObject(c, 'crime');
  addObject(c, 'person', { crimes: ['crime.1'] });
  addObject(c, 'victim', { crimes: ['crime.1'] });
  state.kase = c;
  const ev = addEvent(c, { type: MANUAL_EVENT, date: todayIso(), refs: { crimes: ['crime.1'], persons: ['person.1'], victims: ['victim.1'] } });
  addCardManually(IX, c, ev, { form: '1', of: { crime: 'crime.1' } });
  state.evId = ev.id;
  state.tab = 'event';
  state.password = null;
  touch();
  render();
}

async function openSaved(rec) {
  const pwd = document.querySelector(`[data-pwd="${CSS.escape(rec.id)}"]`)?.value ?? '';
  try {
    const obj = await decryptCase(rec, pwd);
    state.kase = migrateCase(obj, { scopeOf: (fid) => scopeOf(IX, fid) });
    state.password = pwd;
    state.evId = state.kase.events.at(-1)?.id ?? null;
    state.tab = state.evId ? 'event' : 'objects';
    state.dirty = false;
    render();
  } catch (e) {
    alert(e.message);
  }
}

async function importCaseFile() {
  const text = await pickFile();
  if (!text) return;
  try {
    const rec = JSON.parse(text);
    if (rec?.format !== 'statkarta-case') throw new Error('Это не файл дела СтатКарты');
    state.pendingImport = { rec, error: null };
  } catch (e) {
    state.pendingImport = null;
    alert(e.message === 'Это не файл дела СтатКарты' ? e.message : 'Файл не читается');
  }
  render();
}

async function openImported() {
  const pwd = document.querySelector('[data-pwd="import"]')?.value ?? '';
  try {
    const obj = await decryptCase(state.pendingImport.rec, pwd);
    state.kase = migrateCase(obj, { scopeOf: (fid) => scopeOf(IX, fid) });
    state.password = pwd;
    state.evId = state.kase.events.at(-1)?.id ?? null;
    state.tab = state.evId ? 'event' : 'objects';
    state.pendingImport = null;
    touch();
  } catch (e) {
    state.pendingImport.error = e.message;
  }
  render();
}

// ---------- Дело: оболочка ----------

function caseShell() {
  const c = C();
  const wrap = h('div');
  for (const n of state.notices) put(wrap, h('div', { class: 'notice' }, n));
  const ret = retentionInfo(c, { months: retentionMonths(), today: todayIso(), isFinal, reopens: (ev) => defOf(ev.type)?.reopens === true });
  if (ret.status === 'remind') put(wrap, h('div', { class: 'notice' }, `Срок хранения дела истекает ${isoToRu(ret.deleteAfter)}: после этой даты сохраненная копия удаляется.`));
  if (ret.status === 'expired') put(wrap, h('div', { class: 'notice' }, `Срок хранения дела истек ${isoToRu(ret.deleteAfter)}. Сохраненная копия удалена; открытое дело закройте после выгрузки.`));
  if (ret.status === 'ask_active') put(wrap, h('div', { class: 'notice' }, 'По делу полгода нет финального события. Дело еще ведется? ',
    h('button', { class: 'btn small', onclick: () => { confirmActive(C()); touch(); render(); } }, 'Да, ведется')));
  const tab = (id, label) => h('button', { 'aria-pressed': String(state.tab === id), onclick: () => { state.tab = id; render(); } }, label);
  put(wrap, h('div', { class: 'toolbar' },
    h('div', { class: 'seg' }, tab('document', 'Постановление о ВУД'), tab('objects', 'Объекты дела'), tab('event', 'События и пакет'), tab('questions', 'Опросник пакета'), tab('memos', 'Памятки пакета'), tab('save', 'Сохранение и журнал')),
    h('span', { class: 'muted small' }, `${c.title || 'Дело'}: эпизодов ${c.crimes.length}, лиц ${c.persons.length}, потерпевших ${c.victims.length}, событий ${c.events.length}`)));
  if (state.tab === 'document') put(wrap, documentView());
  else if (state.tab === 'objects') put(wrap, objectsView());
  else if (state.tab === 'event') put(wrap, eventsView());
  else if (state.tab === 'questions') put(wrap, packageQuestionsView());
  else if (state.tab === 'memos') put(wrap, memosView());
  else put(wrap, saveView());
  return wrap;
}

// ---------- Постановление о ВУД (Фаза 2): извлечение и подтверждение ----------

const EXTRACT_RULES = PACK.rules.extract ?? [];

function parseDocText(name, text) {
  const res = extractVud(text, EXTRACT_RULES);
  state.doc = { name, res, dec: res.ok ? defaultDecisions(res) : null, error: null, conflicts: null };
  render();
}

async function loadDocFile() {
  const f = await pickFileBytes('.docx,.txt,.doc,.rtf,.pdf');
  if (!f) return;
  try {
    const { text } = await fileText(f.name, f.bytes);
    parseDocText(f.name, text);
  } catch (e) {
    state.doc = { name: f.name, res: null, dec: null, error: e.message };
    render();
  }
}

function sourceNode(fr) {
  return h('span', { class: 'src' }, fr.before ? `…${fr.before.slice(-50)}` : '', h('mark', {}, fr.match.length > 160 ? `${fr.match.slice(0, 160)}…` : fr.match), fr.after ? `${fr.after.slice(0, 50)}…` : '');
}

function confBadge(conf) {
  return h('span', { class: `badge ${conf === 'high' ? 'b-fill' : conf === 'medium' ? 'b-default' : 'b-unknown'}` }, CONFIDENCE_RU[conf]);
}

function docValueInput(f, d) {
  const fid = f.field;
  const kind = EXTRACT_RULES.find((r) => r.id === f.rule)?.kind;
  if (kind === 'enum') return h('span', {}, factOptionLabel(fid, d.value) ?? f.display);
  if (kind === 'date') return h('input', { type: 'date', value: d.value ?? '', onchange: (e) => { d.value = e.target.value || null; } });
  const long = kind === 'fabula' || String(d.value ?? '').length > 70;
  return h(long ? 'textarea' : 'input', { class: 'search', rows: long ? 4 : null, value: long ? null : d.value ?? '', onchange: (e) => { d.value = e.target.value.trim() || null; } }, long ? d.value ?? '' : null);
}

function factOptionLabel(fid, value) {
  const q = PACK.rules.questions.find((x) => x.sets?.includes(fid));
  const code = Array.isArray(value) ? String(value[0]).split('|').pop() : null;
  return q?.answer?.options?.find((o) => o.code === code)?.value ?? null;
}

function documentView() {
  const box = h('div');
  const doc = state.doc;
  const pasteId = 'doc-paste';
  put(box, h('div', { class: 'panel' }, h('h2', {}, 'Постановление о возбуждении уголовного дела'),
    h('p', { class: 'small muted' }, 'Загрузите файл Word (.docx) или текст (.txt), либо вставьте текст постановления. Программа найдет сведения по шаблонам и покажет, откуда каждое взято; в дело попадет только то, что вы подтвердите. Текст постановления не сохраняется в деле и не покидает устройство.'),
    h('div', { class: 'row toolbar' },
      h('button', { class: 'btn primary', onclick: loadDocFile }, 'Загрузить файл'),
      doc ? h('button', { class: 'btn', onclick: () => { state.doc = null; render(); } }, 'Очистить') : null),
    h('details', { class: 'notes' }, h('summary', {}, 'Вставить текст'),
      h('textarea', { id: pasteId, class: 'search', rows: 8, placeholder: 'Текст постановления целиком' }),
      h('div', { class: 'row toolbar' }, h('button', { class: 'btn', onclick: () => {
        const t = document.getElementById(pasteId)?.value ?? '';
        if (t.trim()) parseDocText('вставленный текст', t);
      } }, 'Разобрать текст')))));
  if (!doc) return box;
  if (doc.error) { put(box, h('div', { class: 'notice' }, `${doc.name}: ${doc.error}`)); return box; }
  const { res, dec } = doc;
  if (!res.ok) { put(box, h('div', { class: 'notice' }, `${doc.name}: ${res.reason}`)); return box; }
  const panel = h('div', { class: 'panel' }, h('h2', {}, `Найдено в документе «${doc.name}»`),
    h('p', { class: 'small muted' }, `Разбор занял ${res.ms} мс. Отметка «В дело» стоит у сведений высокой и средней уверенности; низкая – только после вашей проверки. Значение можно исправить.`));
  for (const w of res.warnings) put(panel, h('div', { class: 'item warning small' }, w));
  const rows = res.fields.map((f) => {
    const d = dec.fields[f.key];
    const info = f.field === null;
    return h('tr', {},
      h('td', {}, info ? h('span', { class: 'muted small' }, 'для сведения')
        : h('input', { type: 'checkbox', checked: d.accept, 'aria-label': `Перенести: ${f.label}`, onchange: (e) => { d.accept = e.target.checked; } })),
      h('td', {}, h('strong', {}, f.label), f.note ? h('div', { class: 'src' }, f.note) : null),
      h('td', {}, info ? f.display : docValueInput(f, d)),
      h('td', {}, confBadge(f.confidence)),
      h('td', {}, sourceNode(f.fragment)));
  });
  put(panel, h('div', { class: 'table-wrap' }, h('table', { class: 'memo doc-found' },
    h('thead', {}, h('tr', {}, h('th', {}, 'В дело'), h('th', {}, 'Сведение'), h('th', {}, 'Значение'), h('th', {}, 'Уверенность'), h('th', {}, 'Откуда взято'))),
    h('tbody', {}, ...rows))));
  put(box, panel);
  const ep = h('div', { class: 'panel' }, h('h2', {}, `Эпизоды по резолютивной части (${res.episodes.length})`),
    h('p', { class: 'small muted' }, 'Каждый пункт «Возбудить уголовное дело» – эпизод. Эпизод с той же квалификацией, что уже есть в деле, не дублируется.'));
  const erows = res.episodes.map((e, i) => {
    const d = dec.episodes[i];
    const p = e.person;
    return h('tr', {},
      h('td', {}, h('input', { type: 'checkbox', checked: d.accept, 'aria-label': `Эпизод ${i + 1}`, onchange: (ev) => { d.accept = ev.target.checked; } })),
      h('td', {}, h('input', { class: 'search', value: d.qualification, onchange: (ev) => { d.qualification = ev.target.value.trim(); } })),
      h('td', {}, p ? h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: d.person, onchange: (ev) => { d.person = ev.target.checked; } }),
        ` ${p.names.surname} ${p.names.first_name} ${p.names.patronymic}${p.birth ? `, ${isoToRu(p.birth)} г. р.` : ''}`,
        p.nominativeFound ? null : h('div', { class: 'src' }, p.nominativeGuessed ? `в тексте: «${p.genitive}»; именительный падеж восстановлен по окончаниям – проверьте` : `в тексте: «${p.genitive}» – проверьте падеж`))
        : h('span', { class: 'muted small' }, e.unknownPerson ? 'в отношении неустановленного лица' : 'по факту')),
      h('td', {}, confBadge(e.confidence)),
      h('td', {}, sourceNode(e.fragment)));
  });
  put(ep, h('div', { class: 'table-wrap' }, h('table', { class: 'memo doc-found' },
    h('thead', {}, h('tr', {}, h('th', {}, 'В дело'), h('th', {}, 'Квалификация'), h('th', {}, 'Лицо'), h('th', {}, 'Уверенность'), h('th', {}, 'Откуда взято'))),
    h('tbody', {}, ...erows))));
  put(box, ep);
  if (res.victims?.length) {
    const vp = h('div', { class: 'panel' }, h('h2', {}, `Потерпевшие – подсказка (${res.victims.length})`),
      h('p', { class: 'small muted' }, 'Найдены по оборотам «потерпевшему …», «причинив … вред». Отметьте тех, кого добавить в дело: потерпевший связывается с эпизодами этого постановления. Падеж и написание проверьте.'));
    const vrows = res.victims.map((v, i) => {
      const d = dec.victims[i];
      return h('tr', {},
        h('td', {}, h('input', { type: 'checkbox', checked: d.accept, 'aria-label': `Потерпевший ${i + 1}`, onchange: (ev) => { d.accept = ev.target.checked; } })),
        h('td', {}, h('input', { class: 'search', value: d.label, onchange: (ev) => { d.label = ev.target.value.trim(); } }),
          v.how === 'именительный' ? null : h('div', { class: 'src' }, `в тексте: «${v.text}»${v.how === 'восстановлен' ? '; падеж восстановлен по окончаниям' : ''} – проверьте`)),
        h('td', {}, confBadge(v.confidence)),
        h('td', {}, sourceNode(v.fragment)));
    });
    put(vp, h('div', { class: 'table-wrap' }, h('table', { class: 'memo doc-found' },
      h('thead', {}, h('tr', {}, h('th', {}, 'В дело'), h('th', {}, 'Потерпевший'), h('th', {}, 'Уверенность'), h('th', {}, 'Откуда взято'))),
      h('tbody', {}, ...vrows))));
    put(box, vp);
  }
  const act = h('div', { class: 'panel' });
  if (doc.conflicts?.length) {
    put(act, h('h3', {}, 'Эти сведения уже внесены в деле и отличаются'),
      ...doc.conflicts.map((cf) => h('label', { class: 'plist small' },
        h('input', { type: 'checkbox', checked: Boolean(dec.replace[cf.field]), onchange: (e) => { dec.replace[cf.field] = e.target.checked; } }),
        ` заменить: ${cf.label} – в деле «${shortText(cf.was)}», в постановлении «${shortText(cf.now)}»`)),
      h('p', { class: 'small muted' }, 'Без отметки «заменить» остается значение, внесенное в деле.'));
  }
  put(act, h('div', { class: 'row toolbar' },
    h('button', { class: 'btn primary', onclick: () => {
      if (doc.conflicts === null) {
        doc.conflicts = importConflicts(C(), res, dec);
        if (doc.conflicts.length) { render(); return; }
      }
      const log = importVud(IX, C(), res, dec);
      touch();
      state.notices.push(`Из постановления перенесено сведений: ${log.set.length}; эпизодов: ${log.crimes.length}; лиц: ${log.persons.length}; потерпевших: ${log.victims.length}${log.kept.length ? `; оставлено как было в деле: ${log.kept.length}` : ''}${log.event ? (log.reusedEvent ? '; событие «Возбуждение уголовного дела» дополнено' : '; создано событие «Возбуждение уголовного дела»') : '; событие не создано – нет даты возбуждения или эпизодов'}.`);
      if (log.event) state.evId = log.event;
      state.doc = null;
      state.tab = log.event ? 'event' : 'objects';
      render();
      scrollTo(0, 0);
    } }, doc.conflicts?.length ? 'Перенести с выбранными заменами' : 'Перенести в дело'),
    h('span', { class: 'muted small' }, 'Затем проверьте событие «Возбуждение уголовного дела» и ответьте на вопросы опросника пакета.')));
  put(box, act);
  return box;
}

function shortText(v) {
  const s = Array.isArray(v) ? v.join(', ') : String(v ?? '');
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

function syncAll() {
  for (const ev of C().events) if (ev.type !== MANUAL_EVENT) syncPackage(IX, C(), ev);
  touch();
}

// ---------- Объекты дела ----------

function objectAttrs(kind) {
  return EVX.attrs.filter((a) => a.object === kind);
}

function objectsView() {
  const c = C();
  const box = h('div');
  put(box, h('div', { class: 'panel' }, h('h2', {}, 'Дело'),
    h('label', { class: 'small' }, 'Обозначение дела (для списка сохраненных дел на этом устройстве)',
      h('input', { type: 'text', class: 'search', value: c.title, onchange: (e) => { c.title = e.target.value.trim(); touch(); } })),
    h('p', { class: 'small muted' }, 'Номер дела, орган и остальные сведения спрашиваются в опроснике пакета; орган подставляется из профиля.')));
  for (const list of ['crimes', 'persons', 'victims']) {
    const kind = KIND_ONE[list];
    const panel = h('div', { class: 'panel' }, h('h2', {}, KIND_RU[list]));
    for (const o of c[list]) {
      const row = h('div', { class: 'card' },
        h('div', { class: 'q' }, objectTitle(c, o.id)),
        h('div', { class: 'row' },
          h('label', { class: 'small' }, 'Краткое обозначение (инициалы, если нужно) ',
            h('input', { type: 'text', value: o.label ?? '', style: 'max-width:14rem', onchange: (e) => { o.label = e.target.value.trim(); touch(); rerender(); } })),
          ...objectAttrs(kind).map((a) => h('label', { class: 'small', title: a.source_note },
            h('input', { type: 'checkbox', checked: o.attrs?.[a.id] === true, onchange: (e) => { o.attrs = { ...o.attrs, [a.id]: e.target.checked }; syncAll(); rerender(); } }), ` ${a.label}`)),
          h('button', { class: 'btn small danger', onclick: () => { if (!removeObject(c, o.id)) alert('На этот объект есть выставленная карточка – удалить нельзя'); else { syncAll(); rerender(); } } }, 'Удалить')));
      if (kind !== 'crime') {
        put(row, h('div', { class: 'row small' }, 'Эпизоды: ', ...c.crimes.map((cr) => h('label', { class: 'small' },
          h('input', { type: 'checkbox', checked: o.crimes.includes(cr.id), onchange: (e) => {
            o.crimes = e.target.checked ? [...o.crimes, cr.id] : o.crimes.filter((x) => x !== cr.id);
            syncAll(); rerender();
          } }), ` ${objectTitle(c, cr.id)}`)), c.crimes.length ? null : h('span', { class: 'muted' }, 'сначала добавьте эпизод')));
      }
      put(panel, row);
    }
    put(panel, h('button', { class: 'btn', onclick: () => { addObject(c, kind); syncAll(); rerender(); } }, KIND_ADD[list]));
    put(box, panel);
  }
  const dmg = h('div', { class: 'panel' }, h('h2', {}, 'Ущерб по делу'),
    h('p', { class: 'small muted' }, 'От этих признаков зависит, попадет ли в пакет ф. 4 (практика учета СК России, уточнение от 16.09.2026, п. 11).'),
    ...objectAttrs('damage').map((a) => h('div', {}, h('label', { class: 'small', title: a.source_note },
      h('input', { type: 'checkbox', checked: c.damage.attrs?.[a.id] === true, onchange: (e) => { c.damage.attrs = { ...c.damage.attrs, [a.id]: e.target.checked }; syncAll(); rerender(); } }), ` ${a.label}`))));
  put(box, dmg);
  return box;
}

// ---------- События и состав пакета ----------

function defOf(type) {
  return EVX.byId.get(type) ?? null;
}

function eventsView() {
  const c = C();
  const box = h('div');
  const rows = c.events.map((ev) => {
    const cards = activeCards(ev);
    const issued = cards.filter((k) => k.issued).length;
    return h('tr', { class: state.evId === ev.id ? 'sel' : '', onclick: () => { state.evId = ev.id; state.cardKey = null; render(); } },
      h('td', { class: 'num' }, isoToRu(ev.date)),
      h('td', {}, eventTitle(ev.type), isFinal(ev) ? h('span', { class: 'badge b-unknown' }, ' финальное') : null),
      h('td', { class: 'small' }, `карточек ${cards.length}${issued ? `, выставлено ${issued}` : ''}`));
  });
  put(box, h('div', { class: 'panel' }, h('h2', {}, 'События дела'),
    c.events.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Дата'), h('th', {}, 'Событие'), h('th', {}, 'Пакет'))), h('tbody', {}, ...rows)))
      : h('p', { class: 'muted small' }, 'Событий нет. Добавьте событие – программа предложит состав пакета карточек.'),
    addEventForm()));
  const ev = curEvent();
  if (ev) put(box, packageView(ev));
  return box;
}

function addEventForm() {
  const c = C();
  state.addEv ??= { type: 'ev.vud', date: todayIso(), attrs: {}, refs: { crimes: [], persons: [], victims: [] } };
  const a = state.addEv;
  const def = defOf(a.type);
  const box = h('div', { class: 'card' }, h('div', { class: 'q' }, 'Новое событие'));
  const typeSel = h('select', { onchange: (e) => { a.type = e.target.value; a.attrs = {}; rerender(); } },
    ...EVX.list.map((d) => h('option', { value: d.id, selected: d.id === a.type }, d.title)),
    h('option', { value: MANUAL_EVENT, selected: a.type === MANUAL_EVENT }, eventTitle(MANUAL_EVENT)));
  const dateInp = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'ДД.ММ.ГГГГ', style: 'max-width:10rem',
    value: a.date ? isoToRu(a.date) : '', onchange: (e) => { a.date = ruToIso(e.target.value.trim()) ?? ''; rerender(); } });
  put(box, h('div', { class: 'row' }, typeSel, dateInp, todayButton((iso) => { a.date = iso; rerender(); })));
  if (def?.hint) put(box, h('div', { class: 'hint small' }, def.hint));
  for (const at of def?.attrs ?? []) {
    const ctl = at.type === 'enum'
      ? h('select', { onchange: (e) => { a.attrs[at.id] = e.target.value || null; rerender(); } },
        h('option', { value: '' }, 'не выбрано'), ...at.options.map((o) => h('option', { value: o.code, selected: a.attrs[at.id] === o.code }, o.value)))
      : at.type === 'boolean'
        ? h('input', { type: 'checkbox', checked: a.attrs[at.id] === true, onchange: (e) => { a.attrs[at.id] = e.target.checked; rerender(); } })
        : h('input', { type: 'text', value: a.attrs[at.id] ?? '', onchange: (e) => { a.attrs[at.id] = e.target.value.trim(); rerender(); } });
    put(box, h('div', { class: 'row small' }, h('span', {}, at.label), ctl));
  }
  for (const list of ['crimes', 'persons', 'victims']) {
    const mode = def ? def.refs?.[list] ?? 'optional' : 'optional';
    if (mode === 'none') continue;
    put(box, h('div', { class: 'row small' }, h('span', {}, `${KIND_RU[list]}${mode === 'required' ? ' (нужно указать)' : ''}: `),
      ...c[list].map((o) => h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: a.refs[list].includes(o.id),
        onchange: (e) => { a.refs[list] = e.target.checked ? [...a.refs[list], o.id] : a.refs[list].filter((x) => x !== o.id); rerender(); } }), ` ${objectTitle(c, o.id)}`)),
      c[list].length ? null : h('span', { class: 'muted' }, 'нет объектов')));
  }
  const problems = [];
  if (!a.date) problems.push('укажите дату события');
  for (const at of def?.attrs ?? []) if (at.required && (a.attrs[at.id] === undefined || a.attrs[at.id] === null || a.attrs[at.id] === '')) problems.push(`укажите: ${at.label.toLowerCase()}`);
  for (const list of ['crimes', 'persons', 'victims']) if (def?.refs?.[list] === 'required' && !a.refs[list].length) problems.push(`выберите: ${KIND_RU[list].toLowerCase()}`);
  put(box, h('div', { class: 'row' },
    h('button', { class: 'btn primary', disabled: problems.length > 0, onclick: addEventNow }, 'Добавить событие'),
    problems.length ? h('span', { class: 'small muted' }, problems.join('; ')) : null));
  return box;
}

function addEventNow() {
  const c = C();
  const a = state.addEv;
  // Лицо, указанное в событии, но не связанное ни с одним эпизодом, связывается с эпизодами события:
  // иначе эпизод считается «без лица» и при ВУД в отношении лица выходит ИПК-ПР (замечание от 19.09.2026)
  const linked = [];
  if (a.refs.crimes?.length) {
    for (const pid of a.refs.persons ?? []) {
      const p = getObject(c, pid);
      if (p && !p.crimes.length) { p.crimes = [...a.refs.crimes]; linked.push(objectTitle(c, pid)); }
    }
  }
  if (linked.length) state.notices.push(`${linked.join(', ')}: связано с эпизодами события. Связь лица с эпизодами меняется на вкладке «Объекты дела».`);
  const ev = addEvent(c, { type: a.type, date: a.date, attrs: a.attrs, refs: a.refs });
  if (a.type !== MANUAL_EVENT) {
    applyEventFacts(IX, c, ev);
    const def = defOf(a.type);
    if (def?.action === 'spawn_case') {
      const nc = spawnCase(IX, c, ev);
      state.cases.push(nc);
      state.notices.push(`Выделено дело${a.attrs.new_case_number ? ` № ${a.attrs.new_case_number}` : ''}: пакет карточек по нему составлен в отдельном деле. Откройте его в разделе «Сохранение и журнал».`);
    } else syncPackage(IX, c, ev);
  }
  state.evId = ev.id;
  state.addEv = null;
  touch();
  render();
}

function objectOptions(c, kind) {
  return c[kind === 'crime' ? 'crimes' : kind === 'person' ? 'persons' : 'victims'];
}

function packageView(ev) {
  const c = C();
  const box = h('div', { class: 'panel' });
  put(box, h('h2', {}, `Пакет карточек: ${eventTitle(ev.type)} от ${isoToRu(ev.date)}`));
  const def = defOf(ev.type);
  if (def) put(box, h('div', { class: 'src' }, `Состав по правилам пакета данных. Источник: ${def.source_note}`));
  if (ev.attrs?.vud_mode === 'person') {
    const alone = ev.refs.crimes.filter((cr) => !ev.refs.persons.some((p) => getObject(c, p)?.crimes.includes(cr)));
    if (alone.length) {
      put(box, h('div', { class: 'notice' }, `Дело возбуждено в отношении лица, но с эпизодами ${alone.map((x) => objectTitle(c, x)).join(', ')} лицо события не связано – по ним выставляется ИПК-ПР. `,
        ev.refs.persons.length ? 'Отметьте эпизоды у лица на вкладке «Объекты дела».' : 'Укажите лицо в событии (удалите событие и добавьте заново с лицом).'));
    }
  }
  const rows = ev.cards.map((k) => h('tr', { class: k.removed ? 'dim' : '' },
    h('td', {}, cardTitle(IX, c, k), k.note ? h('div', { class: 'src' }, k.note) : null),
    h('td', { class: 'small' }, MODE_RU[k.mode]),
    h('td', { class: 'small' }, ORIGIN_RU[k.origin] ?? k.origin, k.removed ? ' – убрана вручную' : ''),
    h('td', { class: 'small' }, k.issued ? `выставлена ${isoToRu(k.issued.date)}` : '–'),
    h('td', {}, k.issued ? null : k.removed
      ? h('button', { class: 'btn small', onclick: () => { restoreCard(ev, k.key); touch(); rerender(); } }, 'Вернуть')
      : h('button', { class: 'btn small', onclick: () => { removeCardManually(ev, k.key); touch(); rerender(); } }, 'Убрать'))));
  put(box, h('div', { class: 'table-wrap' }, h('table', { class: 'memo' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Карточка'), h('th', {}, 'Режим'), h('th', {}, 'Происхождение'), h('th', {}, 'Отметка'), h('th', {}, ''))),
    h('tbody', {}, ...rows))));
  for (const oc of def?.optional_cards ?? []) {
    const add = (of, title) => h('button', { class: 'btn small', onclick: () => { addCardManually(IX, c, ev, { form: oc.form, of }); touch(); rerender(); } },
      `Добавить ${formTitleShort(IX, oc.form)}${title ? `: ${title}` : ''}`);
    put(box, h('div', { class: 'hint small' }, oc.note ?? 'Карточка выставляется по обстоятельствам.', ' ',
      oc.per === 'case' ? add({}, null) : objectOptions(c, oc.per).map((o) => add({ [oc.per]: o.id }, objectTitle(c, o.id)))));
  }
  put(box, addCardForm(ev));
  put(box, h('div', { class: 'row' },
    h('button', { class: 'btn primary', onclick: () => { state.tab = 'questions'; render(); } }, 'Опросник пакета'),
    h('button', { class: 'btn', onclick: () => { state.tab = 'memos'; render(); } }, 'Памятки пакета'),
    ev.cards.some((k) => k.issued) ? null : h('button', { class: 'btn small danger', onclick: () => {
      if (!confirm('Удалить событие и его карточки?')) return;
      C().events = C().events.filter((x) => x.id !== ev.id);
      state.evId = C().events.at(-1)?.id ?? null;
      touch(); render();
    } }, 'Удалить событие')));
  return box;
}

function addCardForm(ev) {
  const c = C();
  state.addCard ??= { form: '1', variant: '', crime: '', person: '', victim: '' };
  const a = state.addCard;
  const variants = IX.forms.get(a.form).variants ?? [];
  const sel = (label, key, options) => h('label', { class: 'small' }, `${label} `,
    h('select', { onchange: (e) => { a[key] = e.target.value; rerender(); } }, h('option', { value: '' }, 'нет'),
      ...options.map((o) => h('option', { value: o.id, selected: a[key] === o.id }, objectTitle(c, o.id)))));
  return h('div', { class: 'card' }, h('div', { class: 'q' }, 'Добавить карточку вручную'),
    h('div', { class: 'row' },
      h('select', { onchange: (e) => { a.form = e.target.value; a.variant = ''; rerender(); } },
        ...PACK.forms.map((f) => h('option', { value: f.form, selected: a.form === f.form }, formLabel(f.form)))),
      variants.length ? h('select', { onchange: (e) => { a.variant = e.target.value; rerender(); } },
        h('option', { value: '' }, 'вариант карты'), ...variants.map((v) => h('option', { value: v.id, selected: a.variant === v.id }, v.title))) : null,
      sel('Эпизод', 'crime', c.crimes), sel('Лицо', 'person', c.persons), sel('Потерпевший', 'victim', c.victims),
      h('button', { class: 'btn', onclick: () => {
        const of = {};
        for (const k of ['crime', 'person', 'victim']) if (a[k]) of[k] = a[k];
        const card = addCardManually(IX, c, ev, { form: a.form, variant: a.variant || null, of });
        if (!card) alert('Такая карточка уже есть в пакете');
        touch(); rerender();
      } }, 'Добавить')));
}

// ---------- Опросник пакета ----------

function packageQuestionsView() {
  const ev = curEvent();
  if (!ev) return h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'Выберите событие на вкладке «События и пакет».'));
  const pq = packageQuestions(IX, C(), ev, state.profile);
  const box = h('div', { class: 'panel questions' });
  put(box, h('div', { class: 'toolbar' },
    h('strong', {}, `Закрыто реквизитов: ${pq.closed} из ${pq.total}`),
    h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: state.onlyEmpty, onchange: (e) => { state.onlyEmpty = e.target.checked; rerender(); } }), ' только без ответа'),
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn primary', onclick: () => { state.tab = 'memos'; render(); scrollTo(0, 0); } }, 'Памятки пакета')));
  put(box, h('button', { class: 'btn primary floating', onclick: () => { state.tab = 'memos'; render(); scrollTo(0, 0); } }, 'Памятки'));
  for (const g of pq.groups) {
    const items = g.items.filter((it) => !(state.onlyEmpty && (it.answer || it.derived || it.origin)));
    if (!items.length) continue;
    put(box, h('h3', { class: 'group' }, g.title));
    for (const it of items) put(box, card(it, ev));
  }
  return box;
}

function answerItem(it, ev, status, value) {
  setPackageAnswer(C(), ev, it, status, value);
  touch();
  rerender();
}

function card(it, ev) {
  const { q, answer: a, derived: d } = it;
  const type = q.answer.type;
  const dis = it.disabled;
  const cls = dis ? 'na' : a?.status === 'answered' ? 'answered' : a?.status === 'na' ? 'na' : a?.status === 'unknown' ? 'unknown' : d || it.origin ? 'derived' : '';
  const title = it.requisite ? displayLabel(it.requisite) : normText(q.text);
  const byCard = new Map();
  for (const r of it.requisites) byCard.set(r.cardTitle, [...(byCard.get(r.cardTitle) ?? []), `р. ${r.number}`]);
  const why = byCard.size ? `Закрывает: ${[...byCard].map(([t, ns]) => `${t} – ${ns.join(', ')}`).join('; ')}` : normText(q.why);
  const el = h('div', { class: `card ${cls}`, 'data-fact': it.key },
    h('div', { class: 'q' }, title), h('div', { class: 'why' }, why));
  const req = it.requisite;
  const inp = it.input ?? {};
  const modeText = inp.select === 'multiple' ? `Можно выбрать до ${inp.max_codes} кодов (полей в бланке: ${inp.max_codes})`
    : inp.select === 'overlay' ? 'Коды накладываются по разрядам: можно выбрать несколько кодов разных разрядов, например 2000 + 0030 = 2030'
      : inp.select === 'single' ? 'Выбирается один код' : null;
  if (modeText) put(el, h('div', { class: 'mode small' }, modeText));
  if (it.origin) put(el, h('div', { class: 'hint small' }, `Подставлено: ${it.origin}. Ответ здесь заменит подстановку.`));
  if (dis) put(el, h('div', { class: 'hint disabled-reason' }, h('strong', {}, 'Не заполняется: '), dis.reason, h('div', { class: 'src' }, dis.source_note)));
  const body = h('div', { class: dis ? 'inactive' : '' });
  const clsNo = lookupOf(req) ?? q.answer.classifier_no;
  if (it.factId === 'fact.crime.qualification') put(body, qualificationInput(it, ev));
  else if (type === 'classifier' || clsNo) put(body, classifierInput(it, ev, clsNo));
  else if (it.options.length) put(body, enumInput(it, ev));
  else if (type === 'date' || req?.field_type === 'date') put(body, dateInput(it, ev));
  else put(body, textInput(it, ev));
  if (inp.fills?.length) put(body, fillsInput(it, ev));
  if (dis) body.querySelectorAll('input, textarea, button').forEach((x) => { x.disabled = true; });
  put(el, body);
  if (it.hints?.length && !dis) put(el, ...it.hints.map((hn) => hintBlock(it, ev, hn, clsNo)));
  if (d && a?.status !== 'answered' && !dis) {
    const shown = d.value ? displayValue(it, d.value) : 'не заполнять';
    put(el, h('div', { class: 'hint' }, h('strong', {}, d.status === 'hint' ? 'Подсказка: ' : 'Умолчание: '), shown, h('div', { class: 'src' }, d.source),
      d.value ? h('button', { class: 'btn small', onclick: () => answerItem(it, ev, 'answered', [...d.value]) }, 'Принять') : null));
  }
  if (a?.status === 'na') put(el, h('div', { class: 'hint' }, 'Отмечено: не применимо – реквизит не заполняется.'));
  if (a?.status === 'unknown') put(el, h('div', { class: 'hint' }, 'Отмечено: уточнить позже.'));
  const problem = req && Array.isArray(a?.value) ? selectionProblem(req, a.value.map(keyCode)) : null;
  if (problem) put(el, h('div', { class: 'err' }, `Выбор не соответствует бланку: ${problem}`));
  put(el, h('div', { class: 'row' },
    h('button', { class: 'btn small', disabled: !!dis, onclick: () => answerItem(it, ev, 'na') }, 'Не применимо'),
    h('button', { class: 'btn small', disabled: !!dis, onclick: () => answerItem(it, ev, 'unknown') }, 'Уточнить позже'),
    a ? h('button', { class: 'btn small', onclick: () => answerItem(it, ev, null) }, 'Сбросить') : null,
    it.notes?.length ? h('details', { class: 'notes' }, h('summary', {}, `Разъяснения и примечания (${it.notes.length})`), ...it.notes.map(noteNode)) : null,
    req?.raw ? h('details', { class: 'notes' }, h('summary', {}, 'Текст реквизита в бланке'), h('div', { class: 'raw' }, req.raw)) : null));
  return el;
}

function noteNode(n) {
  const act = PACK.legal.acts.find((x) => x.id === n.act);
  return h('blockquote', {}, n.text, h('div', { class: 'src' }, act ? `${act.title}${act.date ? `, ${isoToRu(act.date)}` : ''}` : n.act));
}

function hintBlock(it, ev, hn, clsNo) {
  const title = (code) => {
    if (clsNo) { const e = IX.clsCode.get(clsNo)?.get(code); return e ? e.name : ''; }
    return it.options.find((o) => o.code === code)?.value ?? '';
  };
  return h('div', { class: 'hint suggest' }, h('strong', {}, 'Подсказка по статье и обстоятельствам: '), hn.text,
    h('div', { class: 'chips' }, ...hn.codes.map((code) => h('button', { class: 'chip', title: title(code), onclick: () => addCode(it, ev, `|${code}`) }, `${code} ${shortLabel(title(code), 40)}`))),
    h('div', { class: 'src' }, hn.source_note));
}

function displayValue(it, value) {
  if (!Array.isArray(value)) return /^\d{4}-\d{2}-\d{2}$/.test(value) ? isoToRu(value) : normText(value);
  if (it.requisite) return displayOf(IX, it.requisite, value);
  return value.map((k) => {
    const o = it.options.find((x) => optKey(x) === k) ?? it.options.find((x) => x.code === keyCode(k));
    return o ? `${o.code} – ${o.value}` : keyCode(k);
  }).join('; ');
}

function currentKeys(it) {
  return it.answer?.status === 'answered' && Array.isArray(it.answer.value) ? it.answer.value : [];
}

// Коды по возрастанию: «0010» < «0200», «2» < «10» – числом, если коды из цифр
const byCode = (a, b) => keyCode(a).localeCompare(keyCode(b), 'ru', { numeric: true });

function addCode(it, ev, key) {
  const inp = it.input ?? {};
  let keys = currentKeys(it).filter((k) => k !== key);
  const code = keyCode(key);
  if (inp.select === 'overlay') keys = keys.filter((k) => !overlayConflict(keyCode(k), code));
  else if ((inp.max_codes ?? 1) <= 1) keys = [];
  else if (keys.length >= inp.max_codes) keys = keys.slice(keys.length - inp.max_codes + 1);
  const next = [...keys, key];
  // несколько кодов в одном реквизите – в карточку по возрастанию кода (замечание от 19.09.2026)
  if (inp.select === 'multiple') next.sort(byCode);
  answerItem(it, ev, 'answered', next);
}

function removeCode(it, ev, key) {
  const next = currentKeys(it).filter((k) => k !== key);
  answerItem(it, ev, next.length ? 'answered' : null, next);
}

function blockedBy(it, code) {
  const inp = it.input ?? {};
  const keys = currentKeys(it).map(keyCode).filter((c) => c !== code);
  if (inp.select === 'overlay') return keys.find((k) => overlayConflict(k, code)) ?? null;
  return null;
}

function composedLine(it) {
  const keys = currentKeys(it);
  if ((it.input?.select !== 'overlay') || keys.length < 2) return null;
  return h('div', { class: 'composed' }, h('strong', {}, `Код в карточку: ${composeOverlay(keys.map(keyCode))}`), ` = ${keys.map(keyCode).join(' + ')}`);
}

function enumInput(it, ev) {
  const keys = currentKeys(it);
  const inp = it.input ?? {};
  const wrap = h('div');
  const opts = h('div', { class: 'opts' });
  let group;
  const single = inp.select === 'single';
  for (const o of it.options) {
    if ((o.group ?? null) !== (group ?? null)) { group = o.group ?? null; if (group) put(opts, h('div', { class: 'og' }, group)); }
    const k = optKey(o);
    const checked = keys.includes(k);
    const blocker = !checked ? blockedBy(it, o.code) : null;
    const full = inp.select === 'multiple' && !checked && keys.length >= inp.max_codes;
    // смысл кода: полная формулировка из пакета формы или основание по ссылке на УПК РФ
    const tip = o.hint ?? legalRefHint(o.value);
    const tipText = tip ? h('span', { class: 'opt-tip', hidden: true }, tip) : null;
    put(opts, h('label', { class: blocker || full ? 'blocked' : '', title: blocker ? `Тот же разряд, что у выбранного кода ${blocker}: сначала снимите его` : full ? `В бланке ${inp.max_codes} полей` : tip || null },
      h('input', { type: single ? 'radio' : 'checkbox', name: `r-${it.key}`, checked, onchange: (e) => (e.target.checked ? addCode(it, ev, k) : removeCode(it, ev, k)) }),
      h('span', {}, h('span', { class: 'code' }, o.code), ' ', sentenceCase(o.value),
        tip ? h('button', { class: 'tip-btn', type: 'button', title: tip, 'aria-label': 'Что означает код', onclick: (e) => { e.preventDefault(); tipText.hidden = !tipText.hidden; } }, '?') : null,
        tipText)));
  }
  if (it.options.length > 14) {
    put(wrap, h('label', { class: 'small filter' }, 'Найти вариант по слову или коду (поиск по списку ниже, в карточку не вносится): ',
      h('input', { type: 'text', placeholder: 'например: давност или 52', class: 'search', oninput: (e) => {
        const q = e.target.value.toLowerCase();
        for (const lab of opts.querySelectorAll('label')) lab.hidden = q && !lab.textContent.toLowerCase().includes(q);
      } })));
  }
  put(wrap, opts, composedLine(it));
  return wrap;
}

function classifierInput(it, ev, no) {
  const c = IX.classifiers.get(no);
  const wrap = h('div');
  if (!c) { put(wrap, h('div', { class: 'muted small' }, `${no === 'okato' ? 'ОКАТО' : `Справочник № ${no}`} не входит в эту сборку – введите код вручную.`), textInput(it, ev)); return wrap; }
  if (no === 'okato' && !c.complete) put(wrap, h('div', { class: 'hint small' }, `Загружен неполный ОКАТО: ${c.source}. Для поиска по всем населенным пунктам нужен официальный файл Росстата.`));
  const keys = currentKeys(it);
  const entryLine = (en) => [h('span', { class: 'code' }, en.code), ' ', entryPath(en) ? h('span', { class: 'muted' }, `${entryPath(en)}: `) : null, en.name,
    en.active === false ? h('span', { class: 'badge b-unknown' }, ' нет в ред. 2026') : null, en.notes?.length ? h('span', { class: 'badge b-default', title: en.notes.join('\n') }, ' примечание') : null];
  const chips = h('div', { class: 'chips' }, ...keys.map((k) => {
    const e = IX.clsCode.get(no).get(keyCode(k));
    return h('span', { class: 'chip' }, `${keyCode(k)} – ${e ? (entryPath(e) ? `${entryPath(e)}: ${e.name}` : e.name) : 'нет в справочнике'}`,
      h('button', { 'aria-label': 'Убрать', onclick: () => removeCode(it, ev, k) }, '×'));
  }));
  const results = h('div', { class: 'results', hidden: true });
  const showList = (list, note) => {
    results.hidden = !list.length && !note;
    results.replaceChildren(...(note ? [h('div', { class: 'small muted pad' }, note)] : []), ...list.map((en) => {
      const blocker = blockedBy(it, en.code);
      return h('button', { class: blocker ? 'blocked' : '', title: blocker ? `Тот же разряд, что у выбранного кода ${blocker}` : null, onclick: () => addCode(it, ev, `|${en.code}`) }, ...entryLine(en));
    }));
  };
  const search = h('input', { type: 'text', class: 'search', placeholder: no === 'okato' ? 'Поиск по ОКАТО: код (можно часть) или название района, населенного пункта' : `Поиск по справочнику № ${no}: код (можно часть или окончание) или слово`, oninput: (e) => {
    const v = e.target.value.trim();
    if (!v) { results.hidden = true; return; }
    const found = searchClassifier(c.entries, v, 60);
    showList(found, found.length ? `Найдено: ${found.length}${found.length === 60 ? ' и более – уточните запрос' : ''}` : 'Ничего не найдено');
  } });
  const all = h('button', { class: 'btn small', onclick: () => {
    const list = c.entries.filter((e) => e.active !== false).sort((a, b) => byCode(a.code, b.code));
    showList(list, `Все позиции справочника № ${no} (${list.length}), по возрастанию кода`);
  } }, 'Показать все варианты');
  put(wrap, chips, h('div', { class: 'row' }, search, all), results, composedLine(it));
  const noteList = keys.flatMap((k) => IX.clsCode.get(no).get(keyCode(k))?.notes ?? []);
  if (noteList.length) put(wrap, h('div', { class: 'hint' }, h('strong', {}, 'Примечание к выбранному коду: '), [...new Set(noteList)].join(' ')));
  return wrap;
}

function fillsInput(it, ev) {
  const targets = it.requisites.filter((r) => (IX.reqs.get(r.form).get(r.id)?.input?.fills ?? []).length);
  if (!targets.length) return h('div');
  const first = targets[0];
  const card0 = ev.cards.find((k) => k.key === first.card);
  const vals = card0?.fills?.[`${first.form}|${first.id}`] ?? {};
  const codes = currentKeys(it).map(keyCode);
  const wrap = h('div', { class: 'fills' });
  (it.input.fills ?? []).forEach((f, i) => {
    const forCodes = [f.for_code, ...(f.for_codes ?? [])].filter(Boolean);
    const active = !forCodes.length || forCodes.some((x) => codes.includes(x));
    put(wrap, h('label', { class: `fill ${active ? '' : 'blocked'}` }, h('span', {}, f.label, forCodes.length ? h('span', { class: 'muted' }, ` (для кода ${forCodes.join(', ')})`) : null),
      h('input', { type: 'text', inputmode: f.type === 'number' ? 'decimal' : null, value: vals[i] ?? '', placeholder: f.unit ?? '', disabled: !active,
        onchange: (e) => { for (const t of targets) setCardFill(ev, t.card, t.id, i, e.target.value.trim()); touch(); rerender(); } }),
      f.unit ? h('span', { class: 'muted' }, f.unit) : null,
      f.type === 'date' && active ? todayButton((iso) => { for (const t of targets) setCardFill(ev, t.card, t.id, i, isoToRu(iso)); touch(); rerender(); }) : null));
  });
  return wrap;
}

// Кнопка «Сегодня»: карточки обычно выставляются в день события (замечание от 19.09.2026)
function todayButton(onPick) {
  return h('button', { class: 'btn small', type: 'button', title: `Подставить текущую дату ${isoToRu(todayIso())}`, onclick: () => onPick(todayIso()) }, 'Сегодня');
}

function dateInput(it, ev) {
  const cur = it.answer?.status === 'answered' ? isoToRu(it.answer.value) : '';
  const err = h('div', { class: 'err', hidden: true }, 'Дата в формате ДД.ММ.ГГГГ');
  const input = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'ДД.ММ.ГГГГ', value: cur, style: 'max-width:12rem', onchange: (e) => {
    const v = e.target.value.trim();
    if (!v) return answerItem(it, ev, null);
    const iso = ruToIso(v);
    if (!iso) { err.hidden = false; return; }
    answerItem(it, ev, 'answered', iso);
  } });
  return h('div', {}, h('div', { class: 'row' }, input, todayButton((iso) => answerItem(it, ev, 'answered', iso))), err);
}

// Квалификация по ячейкам бланка: статья, знак, часть, знак, пункты; стадия – отдельным выбором
function qualModel(text) {
  const q = parseQualification(text ?? '');
  const rows = q.main.map((r) => {
    const [article, asign = ''] = r.article.split('.');
    const [part = '', psign = ''] = (r.parts[0] ?? '').split('.');
    return { article, asign, part, psign, points: r.points.join(', ') };
  });
  if (!rows.length) rows.push({ article: '', asign: '', part: '', psign: '', points: '' });
  return { rows, stage: q.stage ?? 0 };
}

function qualText(model) {
  const parts = model.rows.filter((r) => String(r.article).trim()).map((r) => {
    const art = String(r.article).trim() + (String(r.asign).trim() ? `.${String(r.asign).trim()}` : '');
    const part = String(r.part).trim() ? `ч. ${String(r.part).trim()}${String(r.psign).trim() ? `.${String(r.psign).trim()}` : ''} ` : '';
    const pts = String(r.points).split(/[,;]/).map((x) => x.trim().replace(/^[«"]|[»"]$/g, '')).filter(Boolean);
    const pstr = pts.length ? `${pts.length > 1 ? 'пп.' : 'п.'} ${pts.map((x) => `«${x}»`).join(', ')} ` : '';
    return `${pstr}${part}ст. ${art}`;
  });
  if (!parts.length) return '';
  const stage = model.stage === 1 ? 'ч. 1 ст. 30, ' : model.stage === 2 ? 'ч. 3 ст. 30, ' : '';
  return `${stage}${parts.join(', ')} УК РФ`;
}

function qualificationInput(it, ev) {
  const wrap = h('div');
  const model = qualModel(it.answer?.status === 'answered' ? it.answer.value : '');
  const preview = h('div', { class: 'hint', hidden: true });
  const commit = () => {
    const text = qualText(model);
    answerItem(it, ev, text ? 'answered' : null, text);
  };
  const showPreview = () => {
    const text = qualText(model);
    if (!text) { preview.hidden = true; return; }
    const q = parseQualification(text);
    const date = crimeDateOf(it, ev);
    preview.hidden = false;
    preview.replaceChildren(h('strong', {}, 'В карточку: '), text,
      h('div', { class: 'small' }, q.main.map((r) => {
        const cat = categoryOfRef(IX.uk, r, date);
        return `${refToText(r)} – ${cat.category ? CATEGORY_RU[cat.category] : cat.note}`;
      }).join('; ')));
  };
  const rowsBox = h('div');
  const draw = () => {
    rowsBox.replaceChildren(...model.rows.map((r, i) => {
      const cell = (key, label, width, ph) => h('label', { class: 'small qcell' }, label,
        h('input', { type: 'text', value: r[key], placeholder: ph ?? '', style: `max-width:${width}`,
          oninput: (e) => { r[key] = e.target.value; showPreview(); }, onchange: commit }));
      return h('div', { class: 'row qual-row' },
        cell('article', 'Статья', '7rem', '158'), cell('asign', 'Знак', '4rem', ''),
        cell('part', 'Часть', '5rem', '2'), cell('psign', 'Знак', '4rem', ''),
        cell('points', 'Пункты (через запятую)', '10rem', 'а, в'),
        model.rows.length > 1 ? h('button', { class: 'btn small', onclick: () => { model.rows.splice(i, 1); draw(); commit(); } }, 'Убрать') : null);
    }));
  };
  draw();
  const stageSel = h('label', { class: 'small' }, 'Стадия ',
    h('select', { onchange: (e) => { model.stage = Number(e.target.value); commit(); } },
      h('option', { value: '0', selected: !model.stage }, 'оконченное преступление'),
      h('option', { value: '1', selected: model.stage === 1 }, 'приготовление (ч. 1 ст. 30 УК РФ)'),
      h('option', { value: '2', selected: model.stage === 2 }, 'покушение (ч. 3 ст. 30 УК РФ)')));
  put(wrap, rowsBox, h('div', { class: 'row' }, stageSel,
    h('button', { class: 'btn small', onclick: () => { model.rows.push({ article: '', asign: '', part: '', psign: '', points: '' }); draw(); } }, 'Добавить статью'),
    h('button', { class: 'btn small', onclick: () => { state.qualText = state.qualText === it.key ? null : it.key; rerender(); } }, state.qualText === it.key ? 'Ячейками' : 'Ввести текстом')),
    h('div', { class: 'small muted' }, 'Знак – цифра после номера (ст. 158 знак 1 – это ст. 158.1; ч. 2 знак 1 – ч. 2.1). Пункты можно писать без кавычек.'),
    preview);
  showPreview();
  return state.qualText === it.key ? textInput(it, ev) : wrap;
}

function crimeDateOf(it, ev) {
  const inst = it.scope === 'crime' ? getObject(C(), it.inst) : null;
  const a = inst ? factAt(C(), inst, 'fact.crime.crime_date', ev.id) : null;
  return a?.status === 'answered' ? a.value : todayIso();
}

function textInput(it, ev) {
  const cur = it.answer?.status === 'answered' ? it.answer.value : '';
  const max = it.input?.max_chars;
  const long = it.factId === 'fact.crime.qualification' || !!max || /фабула|описание/i.test(it.requisite?.label ?? '');
  const preview = h('div', { class: 'hint', hidden: true });
  const counter = max ? h('div', { class: 'small counter' }) : null;
  const updateCounter = (v) => {
    if (!counter) return;
    counter.textContent = `${v.length} из ${max} знаков${v.length > max ? ` – длиннее на ${v.length - max}, не поместится в бланк` : ''}`;
    counter.className = `small counter ${v.length > max ? 'err' : 'muted'}`;
  };
  const showPreview = (v) => {
    updateCounter(v);
    if (it.factId !== 'fact.crime.qualification') return;
    const qual = parseQualification(v);
    if (!v.trim()) { preview.hidden = true; return; }
    preview.hidden = false;
    if (!qual.main.length) { preview.textContent = 'Статьи не распознаны. Пишите так: «п. «в» ч. 2 ст. 158 УК РФ».'; return; }
    const date = crimeDateOf(it, ev);
    preview.replaceChildren(h('strong', {}, 'Распознано: '), qual.main.map((r) => {
      const c = categoryOfRef(IX.uk, r, date);
      return `${refToText(r)} – ${c.category ? CATEGORY_RU[c.category] : c.note}`;
    }).join('; '), qual.stage ? `; стадия: ${qual.stage === 1 ? 'приготовление' : 'покушение'}` : '');
  };
  const attrs = { class: 'search', value: long ? null : cur, placeholder: it.factId === 'fact.crime.qualification' ? 'п. «в» ч. 2 ст. 158 УК РФ' : '',
    oninput: (e) => showPreview(e.target.value),
    onchange: (e) => answerItem(it, ev, e.target.value.trim() ? 'answered' : null, e.target.value.trim()) };
  const input = long ? h('textarea', attrs, cur) : h('input', { type: 'text', ...attrs });
  showPreview(cur);
  return h('div', {}, input, counter, preview);
}

// ---------- Памятки пакета ----------

const COLLAPSE = new Set(['fills_ic', 'fills_court', 'not_applicable', 'disabled']);
const PRINT_COLLAPSE = new Set(['fills_ic', 'fills_court', 'not_applicable', 'unanswered', 'unknown', 'disabled']);
const SRC_MARK = { fill: 'О', default: 'У', hint: 'П', fills_registrar: 'Р' };

function printValue(text) {
  return text.split('; ').map((part) => shortLabel(part, 80)).join('; ');
}

function memosView() {
  const c = C();
  const ev = curEvent();
  if (!ev) return h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'Выберите событие на вкладке «События и пакет».'));
  const memos = buildPackageMemos(IX, c, ev, state.profile);
  const checks = runPackageChecks(IX, c, ev, memos);
  const proposals = changeProposals(IX, c, state.profile);
  const box = h('div');
  put(box, h('div', { class: 'panel' }, h('h2', {}, `Памятки пакета: ${eventTitle(ev.type)} от ${isoToRu(ev.date)}`),
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn primary', onclick: () => { state.printAll = true; render(); print(); state.printAll = false; render(); } }, 'Печать всех памяток'),
      BLANKS ? h('button', { class: 'btn', onclick: () => savePackageBlanks(ev, memos)
        .catch((err) => { state.notices.push(`Бланки не выгружены: ${err.message}`); render(); }) }, 'Скачать бланки события') : null,
      BLANKS ? h('button', { class: 'btn', onclick: () => { state.sheet = ALL_SHEETS; render(); print(); state.sheet = null; render(); } }, 'Печать копий бланков события') : null,
      h('button', { class: 'btn', onclick: async (e) => {
        try { await navigator.clipboard.writeText(packageText(IX, c, ev, memos, checks)); e.target.textContent = 'Скопировано'; }
        catch { e.target.textContent = 'Копирование недоступно'; }
      } }, 'Копировать текстом'),
      h('button', { class: 'btn', onclick: () => {
        const list = activeCards(ev).filter((k) => !k.issued);
        if (!list.length || !confirm(`Отметить выставленными карточек: ${list.length}? Сведения в них будут заморожены.`)) return;
        for (const k of list) issueCard(IX, c, ev, k, state.profile);
        touch(); render();
      } }, 'Отметить все выставленными')),
    checks.length ? h('div', { class: 'checks' }, ...checks.map((ch) => h('div', { class: `item ${ch.severity}` },
      h('strong', {}, ch.severity === 'error' ? 'Ошибка пакета: ' : 'Внимание, пакет: '), ch.message, ch.where ? ` – ${ch.where}` : '',
      h('div', { class: 'src' }, ch.source_note))))
      : h('p', { class: 'small muted' }, 'Межкарточные соотношения: замечаний нет.')));
  if (proposals.length) {
    put(box, h('div', { class: 'panel' }, h('h2', {}, 'Сведения изменились после отметки «выставлена»'),
      ...proposals.map((p) => h('div', { class: 'card' }, h('div', { class: 'q' }, p.title),
        h('ul', {}, ...p.diff.map((d) => h('li', { class: 'small' }, `р. ${d.number}: было «${d.was || '–'}», стало «${d.now || '–'}»`))),
        h('button', { class: 'btn', onclick: () => { const ch = createChangeCard(c, p.event, p.card); state.evId = p.event; state.cardKey = ch.key; touch(); render(); } }, 'Создать карточку «изменить»')))));
  }
  const rows = activeCards(ev).map((k) => {
    const memo = memos.get(k.key);
    const st = memoState(memo);
    return h('tr', { class: state.cardKey === k.key ? 'sel' : '', onclick: () => { state.cardKey = k.key; render(); } },
      h('td', {}, memo.cardTitle), h('td', {}, h('span', { class: `badge b-${st === 'ready' ? 'fill' : st === 'errors' ? 'unknown' : 'default'}` }, STATE_RU[st])),
      h('td', { class: 'small' }, k.issued ? `выставлена ${isoToRu(k.issued.date)}` : '–'));
  });
  put(box, h('div', { class: 'panel' }, h('h2', {}, `Карточки пакета (${rows.length})`),
    h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Карточка'), h('th', {}, 'Состояние'), h('th', {}, 'Отметка'))), h('tbody', {}, ...rows)))));
  const selected = state.cardKey && memos.get(state.cardKey);
  if (selected) put(box, memoPanel(selected, ev));
  return box;
}

function memoPanel(memo, ev) {
  const card = ev.cards.find((k) => k.key === memo.card);
  const box = h('div', { class: 'panel print-single' });
  put(box, h('div', { class: 'toolbar no-print' },
    h('button', { class: 'btn', onclick: () => print() }, 'Печать этой памятки'),
    h('button', { class: 'btn', onclick: async (e) => {
      try { await navigator.clipboard.writeText(memoToText(IX, memo)); e.target.textContent = 'Скопировано'; }
      catch { e.target.textContent = 'Копирование недоступно'; }
    } }, 'Копировать текстом'),
    card.issued
      ? h('button', { class: 'btn', onclick: () => { unissueCard(C(), ev, card); touch(); render(); } }, 'Снять отметку «выставлена»')
      : h('button', { class: 'btn primary', onclick: () => { issueCard(IX, C(), ev, card, state.profile); touch(); render(); } }, 'Отметить выставленной'),
    h('span', { class: 'muted small' }, Object.entries(memo.summary).map(([k, v]) => `${STATUS_RU[k]}: ${v}`).join(' · '))));
  put(box, memoNodes(memo, { print: true }));
  put(box, blankPanel(memo, ev, card));
  return box;
}

// ---------- Бланк карточки (Фаза 1.6): печатная копия и заполненный файл ----------

function layoutOf(form) {
  return BLANKS?.layouts?.[form] ?? null;
}

function blankPlan(memo) {
  const layout = layoutOf(memo.form);
  return layout ? { layout, plan: planBlank(memo, layout, { profile: state.profile }) } : null;
}

async function blankBytes(memo, plan, layout) {
  const src = BLANKS.files[layout.blank];
  if (!src) throw new Error(`В сборке нет файла бланка ${layout.blank}`);
  return fillDocx(base64Bytes(src), layout, plan.edits, plan.cellEdits);
}

async function saveBlank(memo, ev) {
  const res = blankPlan(memo);
  if (!res) return;
  const bytes = await blankBytes(memo, res.plan, res.layout);
  const xlsx = res.layout.kind === 'xlsx';
  downloadBytes(blankFileName(memo.form, { title: memo.cardTitle }, { ext: xlsx ? 'xlsx' : 'docx' }), bytes,
    xlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

async function savePackageBlanks(ev, memos) {
  const files = [];
  const skipped = [];
  for (const memo of memos.values()) {
    const res = blankPlan(memo);
    if (!res) { skipped.push(`${memo.cardTitle}: карта раскладки не готова`); continue; }
    if (!res.plan.ready) { skipped.push(`${memo.cardTitle}: ${res.plan.blockers[0]}`); continue; }
    files.push({ name: blankFileName(memo.form, { title: memo.cardTitle }, { ext: res.layout.kind === 'xlsx' ? 'xlsx' : 'docx' }), bytes: await blankBytes(memo, res.plan, res.layout) });
  }
  if (files.length) downloadBytes(`Бланки события ${isoToRu(ev.date)}.zip`, await zipFiles(files), 'application/zip');
  state.notices.push(files.length
    ? `Выгружено бланков: ${files.length}${skipped.length ? `; не выгружено: ${skipped.join('; ')}` : ''}`
    : `Ни один бланк не выгружен: ${skipped.join('; ')}`);
  render();
}

function blankPanel(memo, ev, card) {
  const box = h('div', { class: 'panel blank-fill no-print' });
  put(box, h('h3', {}, 'Бланк карточки'));
  if (!BLANKS) {
    put(box, h('p', { class: 'muted small' }, 'В эту сборку пакет бланков не входит: печатная копия и заполненный файл недоступны. Памятка работает как обычно.'));
    return box;
  }
  const res = blankPlan(memo) ?? { layout: { form: memo.form, blank: null, fields: [] }, plan: planBlank(memo, { form: memo.form, fields: [] }) };
  const mapped = Boolean(layoutOf(memo.form));
  if (!mapped) {
    put(box, h('p', { class: 'muted small' },
      `Для формы ${memo.form} карта раскладки бланка еще не составлена: печатная копия ниже показывает значения, а в бланк их вписывают от руки.`));
  }
  const { plan } = res;
  put(box, h('div', { class: 'toolbar' },
    h('button', { class: `btn primary ${plan.ready && mapped ? '' : 'blocked'}`, disabled: !plan.ready || !mapped,
      onclick: () => saveBlank(memo, ev).catch((e) => { state.notices.push(`Бланк не собран: ${e.message}`); render(); }) }, memo.form === '3' ? 'Скачать бланк .xlsx' : 'Скачать бланк .docx'),
    h('button', { class: `btn ${plan.ready ? '' : 'blocked'}`, disabled: !plan.ready,
      onclick: () => { state.sheet = memo.card; render(); print(); state.sheet = null; render(); } }, 'Печать копии бланка'),
    h('span', { class: 'muted small' }, mapped
      ? `бланк ${res.layout.blank}, ред. ${memo.edition}; заполняется реквизитов: ${plan.fields.length}`
      : `ред. ${memo.edition}; заполненный файл для этой формы пока не собирается`)));
  if (!plan.ready) {
    put(box, h('div', { class: 'checks' }, ...plan.blockers.map((b) => h('div', { class: 'item error' },
      h('strong', {}, 'Печать закрыта: '), b))));
  }
  if (plan.warnings.length) {
    put(box, h('details', { class: 'notes' }, h('summary', {}, `Проверьте перед подписью: ${plan.warnings.length}`),
      h('ul', {}, ...plan.warnings.map((w) => h('li', {}, w)))));
  }
  put(box, sheetNodes(blankSheet(IX, memo, res.layout, plan, { profile: state.profile }), { preview: true }));
  return box;
}

function cellsRow(groups) {
  const wrap = h('span', { class: 'cellrow' });
  groups.forEach((g, gi) => {
    if (gi) put(wrap, h('span', { class: 'gap' }, ' '));
    for (const ch of g) put(wrap, h('span', { class: 'cell' }, ch || ' '));
  });
  return wrap;
}

function sheetNodes(sheet, { preview = false } = {}) {
  const frag = document.createDocumentFragment();
  put(frag, h('h2', {}, `${sheet.title} (форма № ${sheet.form}, ред. ${sheet.edition})`));
  if (sheet.card) put(frag, h('div', { class: 'small' }, sheet.card));
  for (const section of sheet.sections) {
    if (section.title) put(frag, h('div', { class: 'sheet-section' }, section.title));
    const rows = section.rows.map((r) => h('tr', { class: r.filled ? '' : 'empty' },
      h('td', { class: 'num' }, r.number),
      h('td', {}, r.label),
      h('td', { class: 'val' }, r.groups.length ? cellsRow(r.groups) : null, r.text ? h('span', { class: 'text' }, r.text) : null)));
    put(frag, h('table', { class: 'sheet' }, h('tbody', {}, ...rows)));
  }
  if (sheet.signatures?.length) {
    put(frag, h('div', { class: 'sheet-signs' }, ...sheet.signatures.map((sg) => h('p', { class: 'plist' },
      h('strong', {}, `${sg.label}: `), sg.printed ? sg.value : h('span', { class: 'muted' }, '__________________ (подпись и расшифровка от руки)')))));
  }
  if (preview) put(frag, h('p', { class: 'muted small' }, 'Печатная копия повторяет состав и порядок реквизитов бланка. Раздел 1 (номер дела, КРСП и т. п.) заполняется, если эти сведения внесены в опроснике; поля информационного центра остаются пустыми; строки подписи печатаются по отметкам в профиле органа.'));
  return frag;
}

// Печать копий бланков: одной карточки или всех карточек события за один проход (FR-43).
// Карточки с ошибками контроля или неподтвержденными умолчаниями не печатаются (FR-41) – они
// перечислены на листе «Проверьте перед подписью» вместе с предупреждениями.
const ALL_SHEETS = '*';

function sheetPrint() {
  const ev = curEvent();
  if (!ev) return h('div');
  const memos = [...buildPackageMemos(IX, C(), ev, state.profile).values()];
  const all = state.sheet === ALL_SHEETS;
  const chosen = all ? memos : memos.filter((m) => m.card === state.sheet);
  const box = h('div', { class: 'sheet-print' });
  const warnings = [];
  const skipped = [];
  for (const memo of chosen) {
    const res = blankPlan(memo);
    if (!res) { skipped.push(`${memo.cardTitle}: карта раскладки не готова`); continue; }
    if (!res.plan.ready) { skipped.push(`${memo.cardTitle}: ${res.plan.blockers[0]}`); continue; }
    put(box, h('section', { class: 'sheet-page' }, sheetNodes(blankSheet(IX, memo, res.layout, res.plan, { profile: state.profile }))));
    warnings.push(...res.plan.warnings.map((w) => (all ? `${memo.cardTitle}: ${w}` : w)));
  }
  if (warnings.length || skipped.length) {
    put(box, h('section', { class: 'check-page' }, h('h2', {}, 'Проверьте перед подписью'),
      warnings.length ? h('ul', {}, ...warnings.map((w) => h('li', {}, w))) : null,
      skipped.length ? h('div', {}, h('h3', {}, 'Не напечатаны'), h('ul', {}, ...skipped.map((w) => h('li', {}, w)))) : null));
  }
  return box;
}

function memoNodes(memo, { print: withPrint = false } = {}) {
  const frag = document.createDocumentFragment();
  put(frag, h('h2', {}, `Памятка: ${memo.cardTitle} (${FORM_TITLES[memo.form]}, ред. ${memo.edition})`));
  put(frag, h('div', { class: 'print-only small' }, `Составлена ${isoToRu(memo.built)} в СтатКарте (данные ${PACK.version}). Памятка – подсказка; коды проверяет подписант карточки.`));
  const checks = h('div', { class: 'checks' }, ...memo.checks.map((c) => h('div', { class: `item ${c.severity}` },
    h('strong', {}, c.severity === 'error' ? 'Ошибка: ' : 'Внимание: '), c.message, c.requisites.length ? ` (р. ${c.requisites.join(', ')})` : '',
    h('div', { class: 'src' }, c.source_note))));
  if (!memo.checks.length) put(checks, h('div', { class: 'muted small no-print' }, 'Контрольные соотношения: замечаний нет.'));
  put(frag, checks);
  const tbody = h('tbody');
  for (const r of memo.rows) {
    const who = r.fills_by === 'head' ? h('div', { class: 'src' }, 'Заполняет следователь, согласует руководитель') : null;
    const notes = r.notes.length ? h('details', { class: 'notes' }, h('summary', {}, `Разъяснения (${r.notes.length})`), ...r.notes.map(noteNode)) : null;
    const dim = COLLAPSE.has(r.status) || (r.status === 'fills_registrar' && !r.display);
    tbody.append(h('tr', { class: dim ? 'dim' : '' },
      h('td', { class: 'num' }, r.number),
      h('td', {}, shortLabel(displayLabel(r.requisite), 110), who),
      h('td', {}, r.display || (r.status === 'unanswered' || r.status === 'unknown' ? '…' : '–'), r.warning ? h('div', { class: 'err' }, r.warning) : null,
        r.hint ? h('div', { class: 'hint small' }, r.hint) : null, notes),
      h('td', {}, h('span', { class: `badge b-${r.status}` }, STATUS_RU[r.status]), r.source ? h('div', { class: 'src' }, r.source) : null)));
  }
  put(frag, h('div', { class: 'table-wrap no-print' }, h('table', { class: 'memo' },
    h('thead', {}, h('tr', {}, h('th', {}, '№'), h('th', {}, 'Реквизит'), h('th', {}, 'Что вписать'), h('th', {}, 'Статус и источник'))), tbody)));
  if (memo.signatures?.length) put(frag, h('div', { class: 'hint small no-print' }, h('strong', {}, 'Подписи (из профиля органа): '),
    memo.signatures.map((s) => `${s.label} – ${s.value}`).join('; ')));
  if (withPrint) put(frag, printBlock(memo));
  return frag;
}

function printBlock(memo) {
  const printed = memo.rows.filter((r) => r.display && !PRINT_COLLAPSE.has(r.status));
  const ptbody = h('tbody', {}, ...printed.map((r) => h('tr', {},
    h('td', { class: 'num' }, r.number),
    h('td', {}, shortLabel(displayLabel(r.requisite), 40)),
    h('td', {}, printValue(r.display), r.warning ? h('strong', {}, ' (!)') : null),
    h('td', { class: 'mark' }, SRC_MARK[r.status] ?? ''))));
  const foot = memo.rows.filter((r) => r.display && (r.status === 'default' || r.status === 'hint' || r.warning));
  const collapsed = memo.rows.filter((r) => !printed.includes(r));
  const groups = {};
  for (const r of collapsed) (groups[r.status] ??= []).push(r.number);
  const order = ['unanswered', 'unknown', 'not_applicable', 'disabled', 'fills_registrar', 'fills_ic', 'fills_court'];
  const signs = (memo.signatures ?? []).map((s) => h('p', { class: 'plist' }, h('strong', {}, `${s.label}: `), s.value));
  return h('div', { class: 'print-only' },
    h('table', { class: 'memo ptable' }, h('colgroup', {}, h('col', { class: 'c1' }), h('col', { class: 'c2' }), h('col', { class: 'c3' }), h('col', { class: 'c4' })),
      h('thead', {}, h('tr', {}, h('th', {}, '№'), h('th', {}, 'Реквизит'), h('th', {}, 'Что вписать'), h('th', {}, 'Ист.'))), ptbody),
    h('p', { class: 'plist' }, 'Источник: О – ответ пользователя, У – умолчание по правилу, П – подсказка, Р – сведения для работника регистрационного учета. Умолчания и подсказки проверяются перед подписанием.'),
    ...foot.map((r) => h('p', { class: 'plist' }, h('strong', {}, `р. ${r.number}: `), r.warning ? `${r.warning}` : r.source)),
    ...order.filter((k) => groups[k]).map((k) => h('p', { class: 'plist' }, h('strong', {}, `${STATUS_RU[k]}: `), `р. ${groups[k].join(', ')}`)),
    ...signs);
}

// Печать всех памяток пакета за один проход, с разрывом страниц между карточками (FR-35)
function packagePrint() {
  const ev = curEvent();
  if (!ev) return h('div');
  const memos = buildPackageMemos(IX, C(), ev, state.profile);
  const checks = runPackageChecks(IX, C(), ev, memos);
  const box = h('div', { class: 'pkg-print' });
  put(box, h('section', {}, h('h2', {}, `Пакет карточек: ${eventTitle(ev.type)} от ${isoToRu(ev.date)}`),
    h('p', { class: 'plist' }, `Карточек в пакете: ${memos.size}. Памятки – подсказка; коды проверяет подписант.`),
    ...checks.map((ch) => h('p', { class: 'plist' }, h('strong', {}, ch.severity === 'error' ? 'Ошибка пакета: ' : 'Внимание: '), `${ch.message}${ch.where ? ` – ${ch.where}` : ''}`))));
  for (const memo of memos.values()) {
    put(box, h('section', {}, h('h2', {}, `Памятка: ${memo.cardTitle} (${FORM_TITLES[memo.form]}, ред. ${memo.edition})`), printBlock(memo)));
  }
  return box;
}

// ---------- Сохранение, журнал ----------

function saveView() {
  const c = C();
  const box = h('div');
  const ret = retentionInfo(c, { months: retentionMonths(), today: todayIso(), isFinal, reopens: (ev) => defOf(ev.type)?.reopens === true });
  const pwd1 = h('input', { type: 'password', class: 'search', style: 'max-width:16rem', placeholder: 'Пароль (не короче 8 знаков)' });
  const pwd2 = h('input', { type: 'password', class: 'search', style: 'max-width:16rem', placeholder: 'Повторите пароль' });
  const status = h('div', { class: 'small muted' });
  const getPassword = () => {
    const a = pwd1.value;
    const b = pwd2.value;
    if (state.password && !a) return state.password;
    if (a.length < 8) { status.textContent = 'Пароль должен быть не короче 8 знаков'; return null; }
    if (a !== b) { status.textContent = 'Пароли не совпадают'; return null; }
    return a;
  };
  const saveNow = async (toFile) => {
    const pwd = getPassword();
    if (!pwd) return;
    try {
      const rec = await encryptCase(c, pwd, { deleteAfter: ret.deleteAfter, remindAt: ret.remindAt });
      if (toFile) downloadText(`delo-${c.id}.statkarta`, JSON.stringify(rec));
      else { await storePut(rec); await refreshSaved(); }
      state.password = pwd;
      state.dirty = false;
      status.textContent = toFile ? 'Файл дела выгружен – он зашифрован тем же паролем' : `Дело сохранено на устройстве ${isoToRu(todayIso())}`;
      render();
    } catch (e) { status.textContent = e.message; }
  };
  put(box, h('div', { class: 'panel' }, h('h2', {}, 'Сохранение дела'),
    h('p', { class: 'small' }, 'Дело шифруется паролем (AES-GCM, ключ из пароля через PBKDF2). Пароль не сохраняется: если он утерян, дело не восстановить.'),
    state.password ? h('p', { class: 'small muted' }, 'Пароль этого дела введен в текущем сеансе – поля ниже можно не заполнять.') : null,
    h('div', { class: 'row' }, pwd1, pwd2),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => saveNow(false) }, 'Сохранить на устройстве'),
      h('button', { class: 'btn', onclick: () => saveNow(true) }, 'Выгрузить файл дела')),
    status,
    h('p', { class: 'small muted' }, ret.deleteAfter
      ? `Финальное событие: ${eventTitle(getEvent(c, ret.final).type)} от ${isoToRu(ret.finalDate)}. Срок хранения – ${retentionMonths()} мес.: сохраненная копия удаляется после ${isoToRu(ret.deleteAfter)}, напоминание ${isoToRu(ret.remindAt)}.`
      : `Финального события нет – дело не удаляется автоматически; напоминание «дело еще ведется?» ${isoToRu(ret.remindAt)}.`)));
  if (state.cases.length) {
    put(box, h('div', { class: 'panel' }, h('h2', {}, 'Выделенные дела в этом сеансе'),
      ...state.cases.map((nc) => h('div', { class: 'row' }, h('span', {}, nc.title),
        h('button', { class: 'btn small', onclick: () => {
          state.cases = state.cases.filter((x) => x !== nc);
          state.cases.push(c);
          state.kase = nc;
          state.evId = nc.events.at(-1)?.id ?? null;
          state.cardKey = null;
          state.password = null;
          render();
        } }, 'Открыть')))));
  }
  const journal = journalText(c, { formTitle: (f, v) => formTitleShort(IX, f, v), eventTitle });
  put(box, h('div', { class: 'panel' }, h('h2', {}, 'Журнал пакета'),
    h('p', { class: 'small muted' }, 'Какие карточки по делу выставлены и когда. Сведений о лицах в журнале нет.'),
    h('div', { class: 'raw' }, c.journal.length ? journal : 'Выставленных карточек пока нет.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: async (e) => { try { await navigator.clipboard.writeText(journal); e.target.textContent = 'Скопировано'; } catch { e.target.textContent = 'Копирование недоступно'; } } }, 'Копировать журнал'),
      h('button', { class: 'btn small', onclick: () => downloadText(`zhurnal-${c.id}.txt`, journal, 'text/plain') }, 'Выгрузить журнал'))));
  return box;
}

// ---------- Профиль органа ----------

function unitPicker(p, key, nameKey, label, hint) {
  const cls = IX.classifiers.get(17);
  const box = h('div', { class: 'card' }, h('div', { class: 'q' }, label), hint ? h('div', { class: 'why' }, hint) : null);
  const chosen = h('div', { class: 'small' });
  const show = () => chosen.replaceChildren(p[key]
    ? h('span', {}, h('span', { class: 'code' }, p[key]), ' ', p[nameKey] ?? '')
    : h('span', { class: 'muted' }, 'не выбрано'));
  show();
  const results = h('div', { class: 'results', hidden: true });
  if (cls) {
    const search = h('input', { type: 'text', class: 'search', placeholder: 'Поиск по справочнику № 17: код или наименование подразделения', oninput: (e) => {
      const v = e.target.value.trim();
      if (!v) { results.hidden = true; return; }
      const found = searchClassifier(cls.entries, v, 40);
      results.hidden = false;
      results.replaceChildren(...found.map((en) => h('button', { onclick: () => {
        p[key] = String(en.code); p[nameKey] = en.name; show(); results.hidden = true;
      } }, h('span', { class: 'code' }, en.code), ' ', en.section ? h('span', { class: 'muted' }, `${en.section}: `) : null, en.name)));
      if (!found.length) results.replaceChildren(h('div', { class: 'small muted pad' }, 'Ничего не найдено'));
    } });
    put(box, chosen, search, results);
  } else {
    put(box, chosen, h('div', { class: 'small muted' }, 'Справочник № 17 не входит в эту сборку – введите код вручную.'),
      h('input', { type: 'text', class: 'search', value: p[key] ?? '', placeholder: 'Код подразделения', onchange: (e) => { p[key] = e.target.value.trim(); } }),
      h('input', { type: 'text', class: 'search', value: p[nameKey] ?? '', placeholder: 'Наименование', onchange: (e) => { p[nameKey] = e.target.value.trim(); } }));
  }
  put(box, h('button', { class: 'btn small', onclick: () => { p[key] = ''; p[nameKey] = ''; show(); } }, 'Очистить'));
  return box;
}

function profileView() {
  const p = { ...state.profile };
  const organOptions = IX.reqs.get('1').get('1').options;
  const save = () => {
    state.profile = sanitizeProfile(p);
    if (!profileSave(state.profile)) alert('Хранилище браузера недоступно: профиль действует только в этой вкладке');
    render();
  };
  const field = (label, key, attrs = {}) => h('label', { class: 'small' }, label,
    h('input', { type: 'text', class: 'search', value: p[key] ?? '', ...attrs, onchange: (e) => { p[key] = e.target.value.trim(); } }));
  return h('div', {},
    h('div', { class: 'panel' }, h('h2', {}, 'Профиль органа'),
      h('p', { class: 'small muted' }, 'Профиль хранится на устройстве отдельно от дел и не содержит сведений дела (FR-36). Сведения подставляются во все карточки пакета.'),
      field('Наименование органа (ф. 6 р. 1, ИПК р. 79, карта на иностранца р. 2)', 'organ_name'),
      h('label', { class: 'small' }, 'Орган (реквизит 1 бланков)',
        h('select', { onchange: (e) => { p.organ_code = e.target.value || undefined; } },
          h('option', { value: '' }, 'не выбран'), ...organOptions.map((o) => h('option', { value: o.code, selected: p.organ_code === o.code }, `${o.code} – ${o.value}`)))),
      unitPicker(p, 'unit_code', 'unit_name', 'Код подразделения',
        'Справочник подразделений правоохранительных органов (№ 17). Подставляется в клетку «код подразделения» р. 40 ф. 1, р. 33 ф. 1.1 и ф. 4, р. 15 ф. 3, р. 21 ф. 5.'),
      unitPicker(p, 'prosecutor_code', 'prosecutor_name', 'Код органа прокуратуры',
        'Тот же справочник, ведомство «орган прокуратуры». Подставляется в клетку «код органа прокуратуры» р. 40 ф. 1 и р. 33 ф. 1.1.'),
      field('Формат номера дела (подсказка при вводе)', 'case_number_format')),
    h('div', { class: 'panel' }, h('h2', {}, 'Подписи'),
      h('p', { class: 'small muted' }, 'Подставляются в реквизиты подписи: «Заполнил» и «Руководитель» в ИПК, р. 38 карты на иностранца, строка лица, ведущего расследование.'),
      field('Должность лица, ведущего расследование', 'investigator_position', { placeholder: 'следователь' }),
      field('Специальное звание (классный чин)', 'investigator_rank', { placeholder: 'лейтенант юстиции' }),
      field('Фамилия и инициалы', 'investigator_fio', { placeholder: 'И.И. Иванов' }),
      field('Должность руководителя', 'head_position', { placeholder: 'заместитель руководителя отдела' }),
      field('Звание руководителя', 'head_rank', { placeholder: 'полковник юстиции' }),
      field('Фамилия и инициалы руководителя', 'head_fio', { placeholder: 'Петров П.П.' }),
      h('p', { class: 'small muted' }, 'Строка подписи собирается через пробел: «следователь капитан юстиции Иванов И.И.».')),
    h('div', { class: 'panel' }, h('h2', {}, 'Прокурор'),
      h('p', { class: 'small muted' }, 'Код органа прокуратуры и подпись прокурора нужны не во всех органах и не во всех карточках: отметьте, где они требуются. В СК это р. 40 ф. 1 и р. 33 ф. 1.1.'),
      field('Должность прокурора', 'prosecutor_position'),
      field('Звание (классный чин) прокурора', 'prosecutor_rank'),
      field('Фамилия и инициалы прокурора', 'prosecutor_fio'),
      h('div', { class: 'row small' }, 'Карточки, где нужны код прокуратуры и подпись: ',
        ...PACK.forms.map((f) => h('label', { class: 'small' }, h('input', { type: 'checkbox',
          checked: (p.prosecutor_forms ?? ['1', '1.1']).includes(f.form),
          onchange: (e) => {
            const cur = new Set(p.prosecutor_forms ?? ['1', '1.1']);
            if (e.target.checked) cur.add(f.form); else cur.delete(f.form);
            p.prosecutor_forms = [...cur];
          } }), ` ${formTitleShort(IX, f.form)}`)))),
    h('div', { class: 'panel' }, h('h2', {}, 'Работа с делом'),
      h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: p.date_today !== false, onchange: (e) => { p.date_today = e.target.checked; } }), ' дата составления – сегодняшняя'),
      h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: p.blank_sign_investigator !== false, onchange: (e) => { p.blank_sign_investigator = e.target.checked; } }), ' печатать в бланке расшифровку подписи лица, ведущего расследование'),
      h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: p.blank_sign_head === true, onchange: (e) => { p.blank_sign_head = e.target.checked; } }), ' печатать в бланке строку руководителя'),
      h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: p.blank_sign_prosecutor === true, onchange: (e) => { p.blank_sign_prosecutor = e.target.checked; } }), ' печатать в бланке строку прокурора'),
      h('label', { class: 'small' }, 'Срок хранения дела после финального события, месяцев ',
        h('input', { type: 'text', inputmode: 'numeric', style: 'max-width:5rem', value: String(p.retention_months ?? 6), onchange: (e) => { p.retention_months = Number(e.target.value) || 6; } })),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: save }, 'Сохранить профиль'),
        h('button', { class: 'btn', onclick: () => downloadText('statkarta-profile.json', JSON.stringify(sanitizeProfile(p), null, 1)) }, 'Выгрузить профиль'),
        h('button', { class: 'btn', onclick: async () => {
          const text = await pickFile();
          if (!text) return;
          try { state.profile = sanitizeProfile(JSON.parse(text)); profileSave(state.profile); render(); } catch { alert('Файл профиля не читается'); }
        } }, 'Загрузить профиль'))));
}

// ---------- Справочники ----------
function clsView() {
  const nos = [...IX.classifiers.keys()].sort((a, b) => a - b);
  const c = IX.classifiers.get(state.cls.no) ?? IX.classifiers.get(nos[0]);
  const list = state.cls.q ? searchClassifier(c.entries, state.cls.q, 300, { includeInactive: true }) : c.entries;
  const detail = h('div', { class: 'panel' });
  const usage = IX.clsUsage.get(c.no) ?? [];
  put(detail, h('h2', {}, `Справочник № ${c.no}. ${c.title}`),
    h('div', { class: 'small muted' }, `Редакция ${c.edition}, позиций: ${c.entries.length}`),
    h('p', { class: 'small' }, h('strong', {}, 'Используется в реквизитах: '), usage.length ? usage.map((u) => `ф. ${u.form} р. ${u.number}`).join(', ') : 'нет привязок'));
  const sel = state.cls.sel && IX.clsCode.get(c.no).get(state.cls.sel);
  if (sel) {
    const notes = IX.notesByCode.get(`${c.no}|${sel.code}`) ?? [];
    put(detail, h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Код'), h('span', { class: 'code' }, sel.code),
      entryPath(sel) ? h('span', { class: 'muted' }, 'Группа') : null, entryPath(sel) ? h('span', {}, entryPath(sel)) : null,
      h('span', { class: 'muted' }, 'Наименование'), h('span', {}, sel.name),
      sel.availability ? h('span', { class: 'muted' }, 'Статус') : null, sel.availability ? h('span', { class: 'err' }, sel.availability) : null),
      sel.notes?.length ? h('div', { class: 'hint' }, h('strong', {}, 'Примечание справочника: '), sel.notes.join(' ')) : null,
      notes.length ? h('div', {}, h('h3', { class: 'group' }, 'Разъяснения'), ...notes.map(noteNode)) : null);
  } else put(detail, h('p', { class: 'muted small' }, 'Выберите позицию, чтобы увидеть группу, примечания и разъяснения.'));
  if (c.notes?.length) put(detail, h('details', { class: 'notes' }, h('summary', {}, `Сноски справочника (${c.notes.length})`), ...c.notes.map((n) => h('blockquote', {}, `${n.mark} ${n.text}`))));
  const clsGeneral = PACK.legal.notes.filter((n) => n.classifier?.no === c.no && !n.classifier.codes.length);
  if (clsGeneral.length) put(detail, h('details', { class: 'notes' }, h('summary', {}, `Общие разъяснения к справочнику (${clsGeneral.length})`), ...clsGeneral.map(noteNode)));
  const table = h('table', { class: 'list' }, h('thead', {}, h('tr', {}, h('th', {}, 'Код'), h('th', {}, 'Наименование'))),
    h('tbody', {}, ...list.map((e) => h('tr', { class: state.cls.sel === String(e.code) ? 'sel' : '', onclick: () => { state.cls.sel = String(e.code); render(); } },
      h('td', {}, h('span', { class: 'code' }, e.code)), h('td', {}, entryPath(e) ? h('span', { class: 'muted' }, `${entryPath(e)}: `) : (e.section ? h('span', { class: 'muted' }, `${e.section} – `) : null), e.name,
        e.active === false ? h('span', { class: 'badge b-unknown' }, ' нет в ред. 2026') : null)))));
  const search = h('input', { type: 'text', class: 'search', placeholder: 'Код, слово или часть слова', value: state.cls.q, oninput: (e) => {
    state.cls.q = e.target.value; state.cls.sel = null;
    const pos = e.target.selectionStart; render();
    const s = document.querySelector('input.search'); s.focus(); s.setSelectionRange(pos, pos);
  } });
  return h('div', {},
    h('div', { class: 'toolbar' }, h('select', { onchange: (e) => { state.cls = { no: Number(e.target.value), q: state.cls.q, sel: null }; render(); } },
      ...nos.map((n) => h('option', { value: n, selected: n === c.no }, `№ ${n}. ${IX.classifiers.get(n).title}`)))),
    h('div', { class: 'grid2' }, h('div', { class: 'panel' }, search, h('div', { class: 'small muted', style: 'margin:.3rem 0' },
      state.cls.q ? `Найдено: ${list.length}` : `Все позиции: ${list.length}. Источник: ${c.source ?? ''}`), h('div', { class: 'scroll table-wrap' }, table)), detail));
}

// ---------- Бланки ----------
function blankView() {
  const f = IX.forms.get(state.blank.form);
  const q = state.blank.q.toLowerCase();
  const reqs = f.requisites.filter((r) => !q || r.number.startsWith(q) || normText(r.label).toLowerCase().includes(q));
  const r = state.blank.req && IX.reqs.get(f.form).get(state.blank.req);
  const detail = h('div', { class: 'panel' });
  if (r) {
    const notes = IX.notesByReq.get(`${f.form}|${r.number}`) ?? [];
    put(detail, h('h2', {}, `${formTitleShort(IX, f.form)}, реквизит ${r.number}`), h('p', {}, displayLabel(r)),
      h('div', { class: 'kv' },
        h('span', { class: 'muted' }, 'Тип'), h('span', {}, TYPE_RU[r.field_type] + (r.has_date && r.field_type !== 'date' ? ', есть дата' : '') + (r.has_text && r.field_type !== 'text' ? ', есть текст' : '')),
        h('span', { class: 'muted' }, 'Заполняет'), h('span', {}, FILLS_RU[r.fills_by]),
        r.variants ? h('span', { class: 'muted' }, 'Вариант карты') : null, r.variants ? h('span', {}, r.variants.map((v) => (f.variants ?? []).find((x) => x.id === v)?.title ?? v).join(', ')) : null,
        r.section ? h('span', { class: 'muted' }, 'Раздел бланка') : null, r.section ? h('span', {}, sentenceCase(r.section)) : null,
        r.classifier_no ? h('span', { class: 'muted' }, 'Справочник') : null,
        r.classifier_no ? h('span', {}, h('button', { class: 'btn small', onclick: () => { state.view = 'cls'; state.cls = { no: r.classifier_no, q: '', sel: null }; render(); } },
          `№ ${r.classifier_no}. ${IX.classifiers.get(r.classifier_no)?.title ?? 'не входит в сборку'}`)) : null),
      r.correction_source ? h('p', { class: 'small muted' }, `Наименование уточнено по бланку: ${r.correction_source}`) : null,
      r.input ? h('div', { class: 'kv' },
        r.input.select ? h('span', { class: 'muted' }, 'Выбор') : null, r.input.select ? h('span', {}, `${SELECT_RU[r.input.select]}${r.input.select === 'multiple' ? ` – до ${r.input.max_codes}` : ''}`) : null,
        r.input.fields ? h('span', { class: 'muted' }, 'Кодовых полей в бланке') : null, r.input.fields ? h('span', {}, `${r.input.fields}${r.input.code_digits ? `, разрядов в коде: ${r.input.code_digits}` : ''}`) : null,
        r.input.max_chars ? h('span', { class: 'muted' }, 'Не более знаков') : null, r.input.max_chars ? h('span', {}, String(r.input.max_chars)) : null,
        r.input.fills?.length ? h('span', { class: 'muted' }, 'Дополнительные поля') : null, r.input.fills?.length ? h('span', {}, r.input.fills.map((x) => `${x.label}${x.unit ? `, ${x.unit}` : ''}`).join('; ')) : null,
        r.input.sources?.length ? h('span', { class: 'muted' }, 'Основание') : null, r.input.sources?.length ? h('span', { class: 'small' }, r.input.sources.join(' ')) : null) : null,
      r.raw ? h('div', {}, h('h3', { class: 'group' }, 'Текст реквизита в бланке'), h('div', { class: 'raw' }, r.raw)) : null,
      r.options.length ? h('div', {}, h('h3', { class: 'group' }, `Коды (${r.options.length})`), h('div', { class: 'table-wrap' }, h('table', { class: 'memo' },
        h('tbody', {}, ...r.options.map((o) => h('tr', {}, h('td', {}, h('span', { class: 'code' }, o.code)), h('td', {}, o.group ? h('span', { class: 'muted' }, `${o.group}: `) : null, o.value))))))) : null,
      r.classifier_no && IX.classifiers.get(r.classifier_no) ? h('p', { class: 'small muted' }, `Коды реквизита – по справочнику № ${r.classifier_no} (${IX.classifiers.get(r.classifier_no).entries.length} позиций), откройте кнопкой выше.`) : null,
      h('h3', { class: 'group' }, 'Разъяснения'),
      ...(notes.length ? notes.map(noteNode) : [h('p', { class: 'muted small' }, 'Разъяснений к реквизиту в пакете нет.')]));
  } else put(detail, h('p', { class: 'muted' }, 'Выберите реквизит слева.'));
  const table = h('table', { class: 'list' }, h('thead', {}, h('tr', {}, h('th', {}, '№'), h('th', {}, 'Реквизит'), h('th', {}, 'Заполняет'))),
    h('tbody', {}, ...reqs.map((x) => h('tr', { class: state.blank.req === x.id ? 'sel' : '', onclick: () => { state.blank.req = x.id; render(); } },
      h('td', {}, x.number), h('td', {}, shortLabel(displayLabel(x), 80), (IX.notesByReq.get(`${f.form}|${x.number}`) ?? []).length ? h('span', { class: 'badge b-default' }, ' разъяснения') : null),
      h('td', { class: 'small muted' }, FILLS_RU[x.fills_by])))));
  return h('div', {},
    h('div', { class: 'toolbar' }, h('div', { class: 'seg' }, ...PACK.forms.map((x) => h('button', { 'aria-pressed': String(state.blank.form === x.form),
      onclick: () => { state.blank = { form: x.form, req: null, q: '' }; render(); } }, formTitleShort(IX, x.form)))), h('span', { class: 'muted small' }, FORM_TITLES[f.form])),
    h('div', { class: 'grid2' }, h('div', { class: 'panel' }, h('input', { type: 'text', class: 'search', placeholder: 'Номер или слово', value: state.blank.q,
      onchange: (e) => { state.blank.q = e.target.value; render(); } }), h('div', { class: 'scroll table-wrap' }, table)), detail));
}

// ---------- Нормативная база ----------
function mdToNodes(md) {
  const out = [];
  let list = null;
  for (const line of md.split('\n')) {
    const t = line.trim();
    if (!t) { list = null; continue; }
    const inline = (s) => normText(s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1'));
    if (t.startsWith('## ')) { out.push(h('h2', {}, inline(t.slice(3)))); list = null; }
    else if (t.startsWith('# ')) { out.push(h('h1', {}, inline(t.slice(2)))); list = null; }
    else if (/^(\d+\.|-)\s/.test(t)) {
      if (!list) { list = h(/^\d/.test(t) ? 'ol' : 'ul'); out.push(list); }
      list.append(h('li', {}, inline(t.replace(/^(\d+\.|-)\s/, ''))));
    } else if (list && /^\S/.test(line) === false) list.lastChild?.append(' ' + inline(t));
    else { out.push(h('p', {}, inline(t))); list = null; }
  }
  return out;
}

function legalView() {
  const acts = PACK.legal.acts;
  return h('div', {},
    h('div', { class: 'panel' }, h('h2', {}, 'Нормативные акты и источники'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'memo' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Дата, №'), h('th', {}, 'Акт'), h('th', {}, 'Формы'), h('th', {}, 'Статус'))),
        h('tbody', {}, ...acts.map((a) => h('tr', {}, h('td', { class: 'num' }, `${isoToRu(a.date)}${a.number ? ` № ${a.number}` : ''}`),
          h('td', {}, h('strong', {}, `${sentenceCase(a.kind)}. ${a.title}`), h('div', { class: 'src' }, a.issuer ?? ''), h('div', { class: 'small' }, a.summary)),
          h('td', { class: 'small' }, a.applies_to_forms.join(', ')), h('td', { class: 'small' }, a.status))))))),
    h('div', { class: 'panel md' }, ...mdToNodes(PACK.legal.checklist)));
}

// ---------- Пример (вымышленные данные) для проверки печати ----------
// #demo-package – дело с двумя эпизодами и двумя лицами; #demo-package-print – печать всех памяток пакета;
// #demo-blanks-print – печать копий бланков всех карточек события (локальная сборка);
// #demo-full-print-<форма> – одна карточка с ответом на каждый вопрос.

function demoCase() {
  const c = createCase2({ title: 'Дело (пример)', today: '2026-03-01' });
  const set = (cont, fid, v) => setFactVersion(c, cont, fid, 'answered', v, null);
  set(c.case, 'fact.case.case_number', '[номер дела – пример]');
  set(c.case, 'fact.case.kusp', '[номер КРСП – пример]');
  set(c.case, 'fact.case.kusp_date', '2026-02-21');
  set(c.case, 'fact.case.report_source', ['|statement']);
  const cr1 = addObject(c, 'crime');
  const cr2 = addObject(c, 'crime');
  set(cr1, 'fact.crime.qualification', 'п. «в» ч. 2 ст. 158 УК РФ');
  set(cr1, 'fact.crime.crime_date', '2026-02-20');
  set(cr1, 'fact.crime.place', ['|700000']);
  set(cr1, 'fact.crime.method', ['|011']);
  set(cr1, 'fact.victims.victims_count', '1');
  set(cr2, 'fact.crime.qualification', 'ч. 3 ст. 30, ч. 1 ст. 159 УК РФ');
  set(cr2, 'fact.crime.crime_date', '2026-02-25');
  const p1 = addObject(c, 'person', { label: 'А.А.А.', crimes: [cr1.id, cr2.id] });
  const p2 = addObject(c, 'person', { label: 'Б.Б.Б.', crimes: [cr1.id], attrs: { foreign: true } });
  addObject(c, 'victim', { crimes: [cr1.id] });
  c.damage.attrs = { material: true };
  set(c.damage, 'fact.damage.amount', '15000');
  const vud = addEvent(c, { type: 'ev.vud', date: '2026-03-01', attrs: { vud_mode: 'fact' }, refs: { crimes: [cr1.id, cr2.id], victims: ['victim.1'] } });
  applyEventFacts(IX, c, vud);
  syncPackage(IX, c, vud);
  const court = addEvent(c, { type: 'ev.to_court', date: '2026-07-01', refs: { crimes: [cr1.id, cr2.id], persons: [p1.id, p2.id] } });
  applyEventFacts(IX, c, court);
  syncPackage(IX, c, court);
  return { c, court };
}

function demoFullCard(formId) {
  const { c, court } = demoCase();
  const ev = court;
  const card = addCardManually(IX, c, ev, { form: formId, variant: formId === 'ipk' ? 'lc' : null, of: { crime: 'crime.1', person: 'person.1' } });
  state.kase = c;
  state.evId = ev.id;
  for (const it of packageQuestions(IX, c, ev, state.profile).groups.flatMap((g) => g.items)) {
    if (!it.cards.includes(card.key) || it.answer) continue;
    const no = it.requisite?.classifier_no;
    if (no && IX.classifiers.get(no)) setPackageAnswer(c, ev, it, 'answered', [`|${IX.classifiers.get(no).entries[0].code}`]);
    else if (it.options.length) setPackageAnswer(c, ev, it, 'answered', [optKey(it.options[0])]);
    else if (it.requisite?.field_type === 'date' || it.q.answer.type === 'date') setPackageAnswer(c, ev, it, 'answered', '2026-08-20');
    else setPackageAnswer(c, ev, it, 'answered', '[пример]');
  }
  state.cardKey = card.key;
  state.tab = 'memos';
}

async function boot() {
  // PWA: сервис-воркер хранит приложение для работы без сети (только в сборке для GitHub Pages)
  if (BUILD.kind === 'web' && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  await refreshSaved();
  const hash = location.hash.replace('#', '');
  if (hash.startsWith('demo')) {
    state.profile = { organ_name: 'Следственный отдел (пример)', organ_code: '02', unit_code: '[код подразделения]', prosecutor_code: '[код прокуратуры]',
      investigator_position: 'следователь', investigator_rank: 'капитан юстиции', investigator_fio: 'И.И. Иванов',
      head_position: 'заместитель руководителя отдела', head_rank: 'полковник юстиции', head_fio: 'П.П. Петров',
      prosecutor_position: 'заместитель прокурора', prosecutor_rank: 'советник юстиции', prosecutor_fio: 'С.С. Сидоров', retention_months: 6 };
    const full = /^demo-full-print-(.+)$/.exec(hash);
    if (full) demoFullCard(full[1]);
    else {
      const { c, court } = demoCase();
      state.kase = c;
      state.evId = court.id;
      state.tab = 'memos';
      state.printAll = hash === 'demo-package-print';
      if (hash === 'demo-blanks-print') state.sheet = ALL_SHEETS;
    }
    state.dirty = false;
  }
  render();
}

boot();
