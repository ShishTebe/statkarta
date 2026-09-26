// Шифрование дела на устройстве (FR-37, NFR-02): AES-GCM 256, ключ из пароля через PBKDF2-SHA-256.
// Пароль и ключ не сохраняются. Открыто в записи – только служебные даты удаления и напоминания (ответ заказчика В-5).

export const VAULT_FORMAT = 'statkarta-case';
export const KDF_ITERATIONS = 310000;

const b64 = (u8) => { let s = ''; for (const x of u8) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function deriveKey(password, salt, iterations) {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptCase(caseObj, password, { deleteAfter = null, remindAt = null } = {}) {
  if (!password || password.length < 8) throw new Error('Пароль должен быть не короче 8 знаков');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, KDF_ITERATIONS);
  const ct = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(caseObj)));
  return { format: VAULT_FORMAT, v: 1, id: caseObj.id, kdf: { name: 'PBKDF2-SHA-256', iterations: KDF_ITERATIONS, salt: b64(salt) },
    cipher: { name: 'AES-GCM', iv: b64(iv) }, ct: b64(new Uint8Array(ct)), delete_after: deleteAfter, remind_at: remindAt };
}

export async function decryptCase(record, password) {
  if (record?.format !== VAULT_FORMAT) throw new Error('Это не файл дела СтатКарты');
  if (record.v !== 1) throw new Error(`Неподдерживаемая версия файла дела: ${record.v}`);
  const key = await deriveKey(password, unb64(record.kdf.salt), record.kdf.iterations);
  let plain;
  try {
    plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(record.cipher.iv) }, key, unb64(record.ct));
  } catch {
    throw new Error('Неверный пароль или файл поврежден');
  }
  return JSON.parse(new TextDecoder().decode(plain));
}

// Профиль органа: только разрешенные ключи, без сведений дела (FR-36)
export const PROFILE_KEYS = ['region', 'organ_name', 'card_unit_name', 'organ_code', 'unit_code', 'unit_name', 'prosecutor_name', 'prosecutor_code', 'prosecutor_forms',
  'investigator_fio', 'investigator_position', 'investigator_rank', 'head_fio', 'head_position', 'head_rank',
  'prosecutor_fio', 'prosecutor_position', 'prosecutor_rank',
  'case_number_format', 'date_today', 'retention_months',
  // печать строк подписи в бланке (ответы В-14 и В-16 от 16.09.2026)
  'blank_sign_investigator', 'blank_sign_head', 'blank_sign_prosecutor'];

export function sanitizeProfile(p) {
  const out = {};
  for (const k of PROFILE_KEYS) if (p && p[k] !== undefined) out[k] = p[k];
  if (out.retention_months !== undefined) out.retention_months = Math.min(60, Math.max(1, Number(out.retention_months) || 6));
  if (out.prosecutor_forms !== undefined) out.prosecutor_forms = [...new Set([].concat(out.prosecutor_forms).filter((x) => typeof x === 'string'))];
  return out;
}
