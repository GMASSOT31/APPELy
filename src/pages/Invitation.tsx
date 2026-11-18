import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AuthLayout } from '../components/Shell'
import { Button, Card, ErrorBox, Field, Spinner } from '../components/ui'
import { api, ApiError, formatDate, ROLE_LABELS, type Role } from '../lib/api'
import { homePathFor, rememberEmail, useSession } from '../lib/session'

interface InvitationInfo {
  kind: 'invite' | 'reset'
  schoolName: string
  role: Role
  email: string
  displayName: string
  accessUntil: string | null
  existingAccount: boolean
}

export default function Invitation() {
  const { token = '' } = useParams()
  const [info, setInfo] = useState<InvitationInfo | null>(null)
  const [loadError, setLoadError] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { refresh } = useSession()
  const navigate = useNavigate()

  useEffect(() => {
    api<InvitationInfo>(`/api/invitations/${token}`).then(
      (i) => {
        setInfo(i)
        setDisplayName(i.displayName)
      },
      (e) => setLoadError(e.message),
    )
  }, [token])

  if (loadError)
    return (
      <AuthLayout>
        <Card>
          <ErrorBox>{loadError}</ErrorBox>
          <Link to="/connexion" className="mt-4 inline-block text-sm font-semibold text-primary">
            Aller à la connexion
          </Link>
        </Card>
      </AuthLayout>
    )
  if (!info) return <Spinner />

  const isReset = info.kind === 'reset'
  const needsNewPassword = !info.existingAccount

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (needsNewPassword && password !== confirm) return setError('Les deux mots de passe ne correspondent pas.')
    setLoading(true)
    try {
      await api(`/api/invitations/${token}/accept`, isReset || !needsNewPassword ? { password } : { password, displayName })
      rememberEmail(info!.email)
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
        <h1 className="text-xl font-bold">{isReset ? 'Nouveau mot de passe' : 'Activer votre accès'}</h1>
        <p className="mt-1 mb-5 text-sm text-muted">
          {info.schoolName} · {ROLE_LABELS[info.role]}
          {info.accessUntil && ` · jusqu’au ${formatDate(info.accessUntil)}`}
        </p>
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Adresse e-mail" value={info.email} readOnly autoComplete="username" />
          {!isReset && needsNewPassword && (
            <Field label="Votre nom" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          )}
          <Field
            label={needsNewPassword ? 'Choisissez un mot de passe' : 'Mot de passe de votre compte Appely'}
            hint={needsNewPassword ? '10 caractères minimum.' : 'Vous avez déjà un compte : il suffit de confirmer votre mot de passe.'}
            type="password"
            required
            minLength={needsNewPassword ? 10 : undefined}
            autoComplete={needsNewPassword ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {needsNewPassword && (
            <Field
              label="Confirmez le mot de passe"
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
          <ErrorBox>{error}</ErrorBox>
          <Button type="submit" loading={loading}>
            {isReset ? 'Enregistrer le mot de passe' : 'Activer mon accès'}
          </Button>
        </form>
      </Card>
    </AuthLayout>
  )
}
