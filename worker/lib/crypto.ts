/**
 * Primitives de sécurité basées sur WebCrypto (disponible dans les Workers).
 * - Mots de passe : PBKDF2-SHA256, 100 000 itérations (maximum autorisé par les Workers), sel aléatoire.
 * - Jetons (sessions, invitations) : 32 octets aléatoires ; seul leur SHA-256 est stocké en base.
 */

const ITERATIONS = 100_000
const enc = new TextEncoder()

function toB64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export function randomToken(bytes = 32): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export function newId(): string {
  return crypto.randomUUID()
}

export async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text))
  return toB64url(new Uint8Array(d))
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await pbkdf2(password, salt, ITERATIONS)
  return `pbkdf2$${ITERATIONS}$${toB64url(salt)}$${toB64url(hash)}`
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) {
    // Calcul factice pour ne pas révéler par le temps de réponse qu'un compte n'existe pas.
    await pbkdf2(password, new Uint8Array(16), ITERATIONS)
    return false
  }
  const [algo, iter, salt, hash] = stored.split('$')
  if (algo !== 'pbkdf2') return false
  const computed = await pbkdf2(password, fromB64url(salt), Number(iter))
  return timingSafeEqual(computed, fromB64url(hash))
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export function timingSafeEqualStrings(a: string, b: string): boolean {
  return timingSafeEqual(enc.encode(a), enc.encode(b))
}
