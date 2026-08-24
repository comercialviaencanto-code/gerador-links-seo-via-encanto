const SESSION_COOKIE_NAME = "via_encanto_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 dias

function getSigningSecret(): string {
  const secret = process.env.UPLOAD_API_TOKEN?.trim();
  if (!secret) {
    throw new Error("Variável de ambiente ausente: UPLOAD_API_TOKEN");
  }
  return secret;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(payload: string): Promise<string> {
  const key = await importSigningKey(getSigningSecret());
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toHex(signature);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Gera o valor do cookie de sessão: expiração + assinatura HMAC, usando
 * UPLOAD_API_TOKEN como segredo. Não depende de banco de dados.
 */
export async function createSessionCookieValue(): Promise<string> {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = String(expiresAt);
  const signature = await sign(payload);
  return `${payload}.${signature}`;
}

/**
 * Confere se o valor do cookie tem assinatura válida e ainda não expirou.
 */
export async function isValidSessionCookieValue(
  value: string | undefined | null,
): Promise<boolean> {
  if (!value) return false;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;

  const expectedSignature = await sign(payload);
  if (!timingSafeEqualHex(signature, expectedSignature)) return false;

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt)) return false;
  return Date.now() < expiresAt;
}

export { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS };
