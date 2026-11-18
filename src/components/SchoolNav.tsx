import { NavLink } from 'react-router-dom'
import { CalendarX, History, LayoutDashboard, Megaphone, School, Settings, Shuffle, Users } from 'lucide-react'

/** Navigation persistante côté Direction (§11.1). */
export function SchoolNav({ schoolId }: { schoolId: string }) {
  const items = [
    { to: `/ecole/${schoolId}`, label: 'Aujourd’hui', icon: LayoutDashboard, end: true },
    { to: `/ecole/${schoolId}/classes`, label: 'Classes', icon: School, end: false },
    { to: `/ecole/${schoolId}/repartitions`, label: 'Répartitions', icon: Shuffle, end: false },
    { to: `/ecole/${schoolId}/messages`, label: 'Messages', icon: Megaphone, end: false },
    { to: `/ecole/${schoolId}/absences`, label: 'Absences prévues', icon: CalendarX, end: false },
    { to: `/ecole/${schoolId}/historique`, label: 'Historique', icon: History, end: false },
    { to: `/ecole/${schoolId}/equipe`, label: 'Équipe', icon: Users, end: false },
    { to: `/ecole/${schoolId}/parametres`, label: 'Paramètres', icon: Settings, end: false },
  ]
  return (
    <nav aria-label="Navigation de l’école" className="-mx-4 mb-6 overflow-x-auto px-4 print:hidden">
      <ul className="flex gap-1 border-b border-line">
        {items.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                `-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold whitespace-nowrap ${
                  isActive ? 'border-primary text-primary-strong' : 'border-transparent text-muted hover:text-ink'
                }`
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
