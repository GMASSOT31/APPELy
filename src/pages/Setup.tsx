import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../components/Shell'
import { Button, Card, ErrorBox, Field, Spinner } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { useSession } from '../lib/session'

/** Création du premier compte superadmin, protégée par le code secret ADMIN_SETUP_CODE. */
export default function Setup() {
  const [state, setState] = useState<{ needed: boolean; configured: boolean } | null>(null)
  const [form, setForm] = useState({ code: '', displayName: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { refresh } = useSession()
  const navigate = useNavigate()

  useEffect(() => {
    api<{ needed: boolean; configured: boolean }>('/api/setup').then(setState, (e) => setError(e.message))
  }, [])

  if (!state && !error) return <Spinner />
  if (state && !state.needed) return <Navigate to="/connexion" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api('/api/setup', form)
      await refresh()
      navigate('/admin', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? 'Code d’installation incorrect.' : (err as Error).message)
      setLoading(false)
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  return (
    <AuthLayout>
      <Card>
        <h1 className="text-xl font-bold">Installation</h1>
        <p className="mt-1 mb-5 text-sm text-muted">Création du compte administrateur principal.</p>
        {state && !state.configured ? (
          <ErrorBox>
            Le code d’installation n’est pas encore défini sur le serveur (variable secrète ADMIN_SETUP_CODE).
          </ErrorBox>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <Field label="Code d’installation" type="password" required value={form.code} onChange={set('code')} />
            <Field label="Votre nom" required autoComplete="name" value={form.displayName} onChange={set('displayName')} />
            <Field label="Adresse e-mail" type="email" required autoComplete="username" value={form.email} onChange={set('email')} />
            <Field
              label="Mot de passe"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              hint="10 caractères minimum."
              value={form.password}
              onChange={set('password')}
            />
            <ErrorBox>{error}</ErrorBox>
            <Button type="submit" loading={loading}>
              Créer le compte
            </Button>
          </form>
        )}
      </Card>
    </AuthLayout>
  )
}
