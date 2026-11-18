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
import Setup from './pages/Setup'
import Teacher from './pages/Teacher'

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
          <Route path="/ecole/:schoolId" element={<Protected><SchoolTeam /></Protected>} />
          <Route path="/enseignant" element={<Protected><Teacher /></Protected>} />
          <Route path="/sans-acces" element={<Protected><NoAccess /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  )
}
