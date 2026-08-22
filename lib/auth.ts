export const SESSION_COOKIE = "owor_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

export type UserRole = "DEVELOPER" | "STAGING_HELPER" | "LINE_HELPER";

export type AuthUser = {
  staffId: string;
  name: string;
  role: UserRole;
};

type StoredUser = AuthUser & {
  salt: string;
  hash: string;
  iterations?: number;
};

type SessionPayload = AuthUser & {
  exp: number;
};

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function safeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

function users(): StoredUser[] {
  try {
    const parsed = JSON.parse(process.env.OWOR_AUTH_USERS_JSON || "[]") as StoredUser[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isAuthConfigured() {
  return Boolean(process.env.OWOR_SESSION_SECRET && users().length);
}

export async function authenticate(staffId: string, password: string): Promise<AuthUser | null> {
  const normalized = staffId.trim().toUpperCase();
  const user = users().find((candidate) => candidate.staffId.trim().toUpperCase() === normalized);
  if (!user || !password) return null;

  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: base64UrlToBytes(user.salt),
    iterations: user.iterations ?? 210_000,
  }, key, 256);

  if (!safeEqual(new Uint8Array(bits), base64UrlToBytes(user.hash))) return null;
  return { staffId: user.staffId, name: user.name, role: user.role };
}

async function hmac(value: string) {
  const secret = process.env.OWOR_SESSION_SECRET || "";
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

export async function createSession(user: AuthUser) {
  const payload: SessionPayload = { ...user, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const encoded = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  return `${encoded}.${await hmac(encoded)}`;
}

export async function readSession(token?: string | null): Promise<AuthUser | null> {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  if (!safeEqual(encoder.encode(await hmac(encoded)), encoder.encode(signature))) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded))) as SessionPayload;
    if (!payload.staffId || !payload.role || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return { staffId: payload.staffId, name: payload.name, role: payload.role };
  } catch {
    return null;
  }
}
