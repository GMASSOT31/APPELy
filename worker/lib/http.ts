export class HttpError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const badRequest = (code: string, message: string) => new HttpError(400, code, message)
export const unauthorized = () => new HttpError(401, 'UNAUTHENTICATED', 'Veuillez vous connecter.')
export const forbidden = () => new HttpError(403, 'FORBIDDEN', 'Accès non autorisé.')
export const notFound = () => new HttpError(404, 'NOT_FOUND', 'Élément introuvable.')
export const conflict = (code: string, message: string) => new HttpError(409, code, message)

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(data), { ...init, headers })
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: { code: e.code, message: e.message } }, { status: e.status })
  console.error(e)
  return json({ error: { code: 'INTERNAL', message: 'Erreur inattendue. Réessayez.' } }, { status: 500 })
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw badRequest('INVALID_JSON', 'Requête invalide.')
  }
}

export function str(v: unknown, field: string, { min = 1, max = 200 } = {}): string {
  if (typeof v !== 'string') throw badRequest('INVALID_FIELD', `Champ manquant : ${field}.`)
  const s = v.trim()
  if (s.length < min || s.length > max) throw badRequest('INVALID_FIELD', `Champ invalide : ${field}.`)
  return s
}

export function optStr(v: unknown, field: string, opts?: { min?: number; max?: number }): string | null {
  if (v === undefined || v === null || v === '') return null
  return str(v, field, opts)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function email(v: unknown): string {
  const s = str(v, 'adresse e-mail', { max: 254 }).toLowerCase()
  if (!EMAIL_RE.test(s)) throw badRequest('INVALID_EMAIL', 'Adresse e-mail invalide.')
  return s
}

export function password(v: unknown): string {
  if (typeof v !== 'string' || v.length < 10 || v.length > 200)
    throw badRequest('WEAK_PASSWORD', 'Le mot de passe doit contenir au moins 10 caractères.')
  return v
}
