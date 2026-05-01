// ID + token + PIN generation.

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += B64URL[b & 63];
  return out;
}

export function randomPin(digits = 6) {
  const buf = new Uint32Array(digits);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < digits; i++) out += String(buf[i] % 10);
  return out;
}

export function uuid() {
  return crypto.randomUUID();
}
