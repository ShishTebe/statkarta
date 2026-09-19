// Хранилище на устройстве (FR-36, FR-37): зашифрованные записи дел в IndexedDB, профиль органа в localStorage, файлы.

const DB_NAME = 'statkarta';
const STORE = 'cases';
const PROFILE_KEY = 'statkarta.profile';

function idb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('Хранилище браузера недоступно – сохраняйте дело в файл')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Хранилище браузера недоступно'));
  });
}

async function tx(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(out?.result ?? out); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

export async function storeList() {
  try { return (await tx('readonly', (s) => s.getAll())) ?? []; } catch { return []; }
}

export function storePut(record) {
  return tx('readwrite', (s) => s.put(record));
}

export async function storeGet(id) {
  return tx('readonly', (s) => s.get(id));
}

export function storeDelete(id) {
  return tx('readwrite', (s) => s.delete(id));
}

export function profileLoad() {
  try { return sanitizeProfile(JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}')); } catch { return {}; }
}

export function profileSave(p) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(sanitizeProfile(p))); return true; } catch { return false; }
}

export function downloadText(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// accept не задается по умолчанию: в системном окне выбора файлы «.statkarta» иначе показываются неактивными
// Файл как байты и имя – для приема документов (.docx, .txt) в Фазе 2
export function pickFileBytes(accept) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (accept) inp.accept = accept;
    inp.onchange = async () => {
      const f = inp.files?.[0];
      resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    inp.click();
  });
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (accept) inp.accept = accept;
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) { resolve(null); return; }
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsText(f);
    };
    inp.click();
  });
}

// Сохранение готового файла (заполненный бланк, архив бланков события) – Фаза 1.6, FR-40, FR-43.
export function downloadBytes(name, bytes, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function base64Bytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
