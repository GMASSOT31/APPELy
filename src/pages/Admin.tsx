import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Shell } from '../components/Shell'
import { Badge, Button, Card, CopyLink, ErrorBox, Field, Spinner, SuccessBox } from '../components/ui'
import { api, ApiError, formatDate } from '../lib/api'
import { useSession } from '../lib/session'

interface School {
  id: string
  name: string
  slug: string
  uai: string | null
  status: 'invited' | 'active' | 'suspended'
  created_at: string
  members: number
}

const STATUS = {
  invited: { label: 'Invitation en attente', tone: 'warning' },
  active: { label: 'Active', tone: 'success' },
  suspended: { label: 'Suspendue', tone: 'danger' },
} as const

export default function Admin() {
  const { me } = useSession()
  const [schools, setSchools] = useState<School[] | null>(null)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [links, setLinks] = useState<Record<string, string>>({})

  const load = useCallback(() => {
    api<{ schools: School[] }>('/api/admin/schools').then((r) => setSchools(r.schools), (e) => setError(e.message))
  }, [])
  useEffect(load, [load])

  if (me && !me.user.isSuperadmin) return <Navigate to="/" replace />

  async function setStatus(s: School, status: 'active' | 'suspended') {
    setError('')
    try {
      await api(`/api/admin/schools/${s.id}/status`, { status })
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function reinvite(s: School) {
    const directionEmail = prompt(`Adresse e-mail professionnelle de la direction de « ${s.name} » :`)
    if (!directionEmail) return
    try {
      const r = await api<{ inviteUrl: string }>(`/api/admin/schools/${s.id}/invitation`, { directionEmail })
      setLinks({ ...links, [s.id]: r.inviteUrl })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Shell title="Écoles" subtitle="Administration de la plateforme. Les données des élèves ne sont pas visibles ici.">
      <div className="mb-4 flex justify-end">
        {!showForm && (
          <Button onClick={() => setShowForm(true)}>
            <Plus className="size-4" aria-hidden /> Créer une école
          </Button>
        )}
      </div>

      {showForm && (
        <NewSchoolForm
          onCancel={() => setShowForm(false)}
          onCreated={(id, url) => {
            setShowForm(false)
            setLinks({ ...links, [id]: url })
            load()
          }}
        />
      )}

      <ErrorBox>{error}</ErrorBox>
      {!schools ? (
        <Spinner />
      ) : schools.length === 0 ? (
        <Card className="text-center text-muted">Aucune école pour l’instant.</Card>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
          {schools.map((s) => (
            <li key={s.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{s.name}</h2>
                      <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {s.uai ? `UAI ${s.uai} · ` : ''}
                      {s.members} compte{s.members > 1 ? 's' : ''} · créée le {formatDate(s.created_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {s.status !== 'suspended' && (
                      <Button variant="secondary" onClick={() => reinvite(s)}>
                        Nouveau lien direction
                      </Button>
                    )}
                    {s.status === 'suspended' ? (
                      <Button variant="secondary" onClick={() => setStatus(s, 'active')}>
                        Réactiver
                      </Button>
                    ) : (
                      <Button variant="danger" onClick={() => setStatus(s, 'suspended')}>
                        Suspendre
                      </Button>
                    )}
                  </div>
                </div>
                {links[s.id] && (
                  <div className="mt-3">
                    <SuccessBox>
                      Invitation créée. Transmettez ce lien à la direction de l’école.
                      <CopyLink url={links[s.id]} />
                    </SuccessBox>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}

function NewSchoolForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string, url: string) => void }) {
  const [form, setForm] = useState({ name: '', uai: '', directionName: '', directionEmail: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const r = await api<{ school: { id: string }; inviteUrl: string }>('/api/admin/schools', {
        ...form,
        directionName: form.directionName || undefined,
      })
      onCreated(r.school.id, r.inviteUrl)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inattendue.')
      setLoading(false)
    }
  }

  return (
    <Card className="mb-4">
      <h2 className="mb-4 font-semibold">Nouvelle école</h2>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom de l’école" required value={form.name} onChange={set('name')} />
        <Field label="Code UAI/RNE (facultatif)" placeholder="0310000A" value={form.uai} onChange={set('uai')} />
        <Field label="Nom de la direction (facultatif)" value={form.directionName} onChange={set('directionName')} />
        <Field
          label="E-mail professionnel de la direction"
          type="email"
          required
          value={form.directionEmail}
          onChange={set('directionEmail')}
        />
        <div className="sm:col-span-2">
          <ErrorBox>{error}</ErrorBox>
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" loading={loading}>
            Créer et générer l’invitation
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Annuler
          </Button>
        </div>
      </form>
    </Card>
  )
}
