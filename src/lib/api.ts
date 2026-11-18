export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Connexion impossible. Vérifiez le réseau et réessayez.')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = data?.error
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? 'Erreur inattendue. Réessayez.')
  }
  return data as T
}

export type Role = 'direction' | 'enseignant' | 'remplacant'

export interface Me {
  user: { id: string; email: string; displayName: string; isSuperadmin: boolean }
  memberships: { schoolId: string; schoolName: string; schoolStatus: string; role: Role; activeTo: string | null }[]
}

export const ROLE_LABELS: Record<Role, string> = {
  direction: 'Direction',
  enseignant: 'Enseignant·e',
  remplacant: 'Remplaçant·e',
}

export function formatDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}
