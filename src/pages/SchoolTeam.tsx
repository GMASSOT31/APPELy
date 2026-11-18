import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { UserPlus } from 'lucide-react'
import { Shell } from '../components/Shell'
import { Badge, Button, Card, CopyLink, ErrorBox, Field, Spinner, SuccessBox } from '../components/ui'
import { api, ApiError, formatDate, ROLE_LABELS, type Role } from '../lib/api'
import { useSession } from '../lib/session'

interface Member {
  id: string
  display_name: string
  email: string
  role: Role
  active_to: string | null
  is_me: number
}
interface PendingInvitation {
  id: string
  display_name: string
  email: string
  role: Role
  access_until: string | null
  expires_at: string
}

export default function SchoolTeam() {
  const { schoolId = '' } = useParams()
  const { me } = useSession()
  const membership = me?.memberships.find((m) => m.schoolId === schoolId && m.role === 'direction')
  const [data, setData] = useState<{ members: Member[]; invitations: PendingInvitation[] } | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ text: string; url: string } | null>(null)
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(() => {
    api<{ members: Member[]; invitations: PendingInvitation[] }>(`/api/schools/${schoolId}/members`).then(setData, (e) =>
      setError(e.message),
    )
  }, [schoolId])
  useEffect(load, [load])

  if (me && !membership) return <Navigate to="/" replace />

  async function action(path: string, confirmText: string, success?: (r: { resetUrl?: string }) => void) {
    if (!confirm(confirmText)) return
    setError('')
    try {
      const r = await api<{ resetUrl?: string }>(path, {})
      success?.(r)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Shell title="Équipe" subtitle={membership?.schoolName}>
      <div className="mb-4 flex justify-end">
        {!showForm && (
          <Button onClick={() => setShowForm(true)}>
            <UserPlus className="size-4" aria-hidden /> Inviter une personne
          </Button>
        )}
      </div>

      {showForm && (
        <InviteForm
          schoolId={schoolId}
          onCancel={() => setShowForm(false)}
          onInvited={(name, url) => {
            setShowForm(false)
            setNotice({ text: `Invitation créée pour ${name}.`, url })
            load()
          }}
        />
      )}

      {notice && (
        <div className="mb-4">
          <SuccessBox>
            {notice.text}
            <CopyLink url={notice.url} />
          </SuccessBox>
        </div>
      )}
      <ErrorBox>{error}</ErrorBox>

      {!data ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">Comptes actifs</h2>
            <Card className="p-0">
              <ul className="divide-y divide-line">
                {data.members.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{m.display_name}</span>
                        <Badge tone={m.role === 'direction' ? 'info' : 'neutral'}>{ROLE_LABELS[m.role]}</Badge>
                        {m.is_me ? <span className="text-xs text-muted">(vous)</span> : null}
                      </div>
                      <p className="truncate text-sm text-muted">
                        {m.email}
                        {m.active_to && ` · accès jusqu’au ${formatDate(m.active_to)}`}
                      </p>
                    </div>
                    {!m.is_me && (
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          onClick={() =>
                            action(
                              `/api/schools/${schoolId}/members/${m.id}/reset`,
                              `Réinitialiser le mot de passe de ${m.display_name} ? Son mot de passe actuel ne fonctionnera plus.`,
                              (r) => r.resetUrl && setNotice({ text: `Lien de réinitialisation pour ${m.display_name}.`, url: r.resetUrl }),
                            )
                          }
                        >
                          Réinitialiser
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() =>
                            action(`/api/schools/${schoolId}/members/${m.id}/revoke`, `Retirer l’accès de ${m.display_name} ?`)
                          }
                        >
                          Retirer l’accès
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </section>

          {data.invitations.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">Invitations en attente</h2>
              <Card className="p-0">
                <ul className="divide-y divide-line">
                  {data.invitations.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{i.display_name}</span>
                          <Badge tone="warning">{ROLE_LABELS[i.role]}</Badge>
                        </div>
                        <p className="truncate text-sm text-muted">
                          {i.email} · lien valable jusqu’au {formatDate(i.expires_at)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          action(`/api/schools/${schoolId}/invitations/${i.id}/revoke`, `Annuler l’invitation de ${i.display_name} ?`)
                        }
                      >
                        Annuler
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </div>
      )}
    </Shell>
  )
}

function InviteForm({
  schoolId,
  onCancel,
  onInvited,
}: {
  schoolId: string
  onCancel: () => void
  onInvited: (name: string, url: string) => void
}) {
  const [form, setForm] = useState({ displayName: '', email: '', role: 'enseignant' as Role, accessUntil: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const r = await api<{ inviteUrl: string }>(`/api/schools/${schoolId}/invitations`, {
        ...form,
        // Fin d'accès à la fin de la journée choisie, en heure locale.
        accessUntil:
          form.role === 'remplacant' && form.accessUntil
            ? new Date(`${form.accessUntil}T23:59:59`).toISOString()
            : undefined,
      })
      onInvited(form.displayName, r.inviteUrl)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inattendue.')
      setLoading(false)
    }
  }

  return (
    <Card className="mb-4">
      <h2 className="mb-4 font-semibold">Inviter une personne</h2>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom" required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        <Field
          label="Adresse e-mail"
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <fieldset className="grid gap-2 sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium">Rôle</legend>
          <div className="flex flex-wrap gap-2">
            {(['enseignant', 'remplacant', 'direction'] as Role[]).map((r) => (
              <label
                key={r}
                className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 text-sm font-medium ring-1 ${
                  form.role === r ? 'bg-surface text-primary-strong ring-primary' : 'bg-white ring-line'
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  value={r}
                  checked={form.role === r}
                  onChange={() => setForm({ ...form, role: r })}
                  className="accent-primary"
                />
                {r === 'direction' ? 'Direction adjointe' : ROLE_LABELS[r]}
              </label>
            ))}
          </div>
        </fieldset>
        {form.role === 'remplacant' && (
          <Field
            label="Fin de l’accès"
            type="date"
            required
            min={new Date().toISOString().slice(0, 10)}
            hint="L’accès s’arrête automatiquement le soir de ce jour."
            value={form.accessUntil}
            onChange={(e) => setForm({ ...form, accessUntil: e.target.value })}
          />
        )}
        <div className="sm:col-span-2">
          <ErrorBox>{error}</ErrorBox>
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" loading={loading}>
            Créer le lien d’invitation
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Annuler
          </Button>
        </div>
      </form>
    </Card>
  )
}
