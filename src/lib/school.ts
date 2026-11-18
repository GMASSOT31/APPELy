import { useSession } from './session'

export interface OverviewClass {
  id: string
  name: string
  levels: string[]
  studentCount: number
  teachers: string[]
}
export interface Overview {
  school: { name: string; academicYear: string; closedWeekdays: number }
  classes: OverviewClass[]
}

export function useDirection(schoolId: string) {
  const { me } = useSession()
  return me?.memberships.find((m) => m.schoolId === schoolId && m.role === 'direction')
}

/** Date du jour à Paris (AAAA-MM-JJ), comme le serveur. */
export function parisToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export const callPath = (schoolId: string, classId: string, date: string, slotId: string) =>
  `/appel/${schoolId}/${classId}/${date}/${slotId}`
