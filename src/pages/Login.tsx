import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthLayout } from '../components/Shell'
import { Button, Card, ErrorBox, Field } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { homePathFor, lastEmail, rememberEmail, useSession } from '../lib/session'

export default function Login() {
  const [email, setEmail] = useState(lastEmail)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { refresh } = useSession()
  const navigate = useNavigate()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api('/api/auth/login', { email, password })
      rememberEmail(email)
      const me = await refresh()
      if (me) navigate(homePathFor(me), { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inattendue.')
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <Card>
        <h1 className="mb-5 text-xl font-bold">Connexion</h1>
        <form onSubmit={submit} className="grid gap-4">
          <Field
            label="Adresse e-mail"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Field
            label="Mot de passe"
            type="password"
            autoComplete="current-password"
            required
            autoFocus={!!email}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <ErrorBox>{error}</ErrorBox>
          <Button type="submit" loading={loading} className="w-full">
            Se connecter
          </Button>
        </form>
        <p className="mt-4 text-xs text-muted">
          Mot de passe oublié ? Demandez à votre direction un lien de réinitialisation.
        </p>
      </Card>
    </AuthLayout>
  )
}
