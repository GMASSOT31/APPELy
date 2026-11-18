import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Privacy from './Privacy'
import Landing from './Landing'

describe('page « Confidentialité »', () => {
  it('explique ce qui est enregistré, sans affirmer de conformité', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Confidentialité' })).toBeInTheDocument()
    for (const t of ['Ce qui est enregistré', 'Qui peut voir quoi', 'Sur cet appareil', 'Où et combien de temps', 'Vos droits'])
      expect(screen.getByRole('heading', { level: 2, name: t })).toBeInTheDocument()
    // Statut honnête : pas encore validé, aucune donnée réelle.
    expect(screen.getByRole('note')).toHaveTextContent(/pas encore validé/)
    expect(document.body.textContent).not.toMatch(/conforme au RGPD|certifié/i)
    // Les informations clés pour les familles.
    expect(document.body.textContent).toMatch(/jamais de motif médical/)
    expect(document.body.textContent).toMatch(/Aucune liste d’élèves n’est gardée sur l’appareil/)
    expect(screen.getByRole('link', { name: 'Retour' })).toHaveAttribute('href', '/')
  })

  it('est accessible depuis l’accueil', () => {
    render(<MemoryRouter><Landing /></MemoryRouter>)
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByRole('link', { name: 'Confidentialité' })).toHaveAttribute('href', '/confidentialite')
  })
})
