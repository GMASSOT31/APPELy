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
