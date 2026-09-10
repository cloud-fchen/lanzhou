const ENVELOPE_VERSION = 1;
const ITERATIONS = 600000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

export function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let index = 0; index < view.length; index += 0x8000) {
    binary += String.fromCharCode(...view.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('Invalid Base64 value');
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveAesKey(password, salt, iterations) {
  const material = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return globalThis.crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function assertPassword(password) {
  if (typeof password !== 'string' || password.length === 0) throw new Error('Password is required');
}

function readEnvelope(envelope) {
  const valid = envelope
    && envelope.version === ENVELOPE_VERSION
    && envelope.kdf?.name === 'PBKDF2-SHA-256'
    && Number.isInteger(envelope.kdf.iterations)
    && envelope.kdf.iterations === ITERATIONS
    && envelope.cipher?.name === 'AES-256-GCM';
  if (!valid) throw new Error('Unsupported encrypted payload');

  const salt = base64ToBytes(envelope.kdf.salt);
  const iv = base64ToBytes(envelope.cipher.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  if (salt.byteLength !== SALT_LENGTH || iv.byteLength !== IV_LENGTH || ciphertext.byteLength < 17) {
    throw new Error('Malformed encrypted payload');
  }
  return { salt, iv, ciphertext };
}

export async function encryptPayload(value, password) {
  assertPassword(password);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveAesKey(password, salt, ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  return {
    version: ENVELOPE_VERSION,
    kdf: { name: 'PBKDF2-SHA-256', iterations: ITERATIONS, salt: bytesToBase64(salt) },
    cipher: { name: 'AES-256-GCM', iv: bytesToBase64(iv) },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

export async function decryptPayload(envelope, password) {
  assertPassword(password);
  const { salt, iv, ciphertext } = readEnvelope(envelope);
  const key = await deriveAesKey(password, salt, envelope.kdf.iterations);
  const plaintext = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
}
