import { useEffect, useState } from 'react'
import { Shell } from '../components/Shell'
import { Card, Spinner } from '../components/ui'
import { api, formatDate, ROLE_LABELS } from '../lib/api'
import { useSession } from '../lib/session'

interface MyClass {
  id: string
  name: string
  levels: string[]
  studentCount: number
}

/** Espace enseignant : ses classes. L'écran d'appel arrive avec le lot 3. */
export default function Teacher() {
  const { me } = useSession()
  const [classes, setClasses] = useState<Record<string, MyClass[]>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!me) return
    Promise.all(
      me.memberships.map((m) =>
        api<{ classes: MyClass[] }>(`/api/schools/${m.schoolId}/my-classes`).then(
          (r) => [m.schoolId, r.classes] as const,
          () => [m.schoolId, []] as const,
        ),
      ),
    ).then((entries) => {
      setClasses(Object.fromEntries(entries))
      setLoaded(true)
    })
  }, [me])

  return (
    <Shell title={`Bonjour ${me?.user.displayName ?? ''}`}>
      {!loaded ? (
        <Spinner />
      ) : (
        <div className="grid gap-4">
          {me?.memberships.map((m) => (
            <section key={m.schoolId}>
              <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">
                {m.schoolName} · {ROLE_LABELS[m.role]}
                {m.activeTo && ` jusqu’au ${formatDate(m.activeTo)}`}
              </h2>
              {(classes[m.schoolId] ?? []).length === 0 ? (
                <Card className="text-sm text-muted">
                  Aucune classe ne vous est encore affectée. La direction peut vous affecter une classe depuis sa page.
                </Card>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {classes[m.schoolId].map((c) => (
                    <li key={c.id}>
                      <Card>
                        <p className="font-semibold">{c.name}</p>
                        <p className="text-sm text-muted">
                          {c.studentCount} élève{c.studentCount > 1 ? 's' : ''} · l’écran d’appel arrive à la prochaine
                          étape du développement
                        </p>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </Shell>
  )
}
