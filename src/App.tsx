import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Spinner } from './components/ui'
import { homePathFor, SessionProvider, useSession } from './lib/session'
import Admin from './pages/Admin'
import Invitation from './pages/Invitation'
import Landing from './pages/Landing'
import Login from './pages/Login'
import NoAccess from './pages/NoAccess'
import SchoolTeam from './pages/SchoolTeam'
import SchoolClasses from './pages/SchoolClasses'
import ClassPage from './pages/ClassPage'
import ImportStudents from './pages/ImportStudents'
import SchoolSettings from './pages/SchoolSettings'
import CallPage from './pages/CallPage'
import Setup from './pages/Setup'
import Teacher from './pages/Teacher'
import Dashboard from './pages/Dashboard'
import Messages from './pages/Messages'
import Absences from './pages/Absences'
import HistoryPage from './pages/History'

function Home() {
  const { me, loading } = useSession()
  if (loading) return <Spinner />
  return me ? <Navigate to={homePathFor(me)} replace /> : <Landing />
}

function Protected({ children }: { children: ReactNode }) {
  const { me, loading } = useSession()
  if (loading) return <Spinner />
  return me ? children : <Navigate to="/connexion" replace />
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { me, loading } = useSession()
  if (loading) return <Spinner />
  return me ? <Navigate to={homePathFor(me)} replace /> : children
}

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/connexion" element={<GuestOnly><Login /></GuestOnly>} />
          <Route path="/installation" element={<Setup />} />
          <Route path="/invitation/:token" element={<Invitation />} />
          <Route path="/admin" element={<Protected><Admin /></Protected>} />
          <Route path="/ecole/:schoolId" element={<Protected><Dashboard /></Protected>} />
          <Route path="/ecole/:schoolId/classes" element={<Protected><SchoolClasses /></Protected>} />
          <Route path="/ecole/:schoolId/messages" element={<Protected><Messages /></Protected>} />
          <Route path="/ecole/:schoolId/absences" element={<Protected><Absences /></Protected>} />
          <Route path="/ecole/:schoolId/historique" element={<Protected><HistoryPage /></Protected>} />
          <Route path="/ecole/:schoolId/equipe" element={<Protected><SchoolTeam /></Protected>} />
          <Route path="/ecole/:schoolId/parametres" element={<Protected><SchoolSettings /></Protected>} />
          <Route path="/ecole/:schoolId/import" element={<Protected><ImportStudents /></Protected>} />
          <Route path="/ecole/:schoolId/classes/:classId" element={<Protected><ClassPage /></Protected>} />
          <Route path="/enseignant" element={<Protected><Teacher /></Protected>} />
          <Route path="/appel/:schoolId/:classId/:date/:slotId" element={<Protected><CallPage /></Protected>} />
          <Route path="/sans-acces" element={<Protected><NoAccess /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  )
}
