import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Landing from './Landing'

describe('démo d’appel', () => {
  it('2 taps sur les absents + 1 tap sur « Valider l’appel »', () => {
    render(<MemoryRouter><Landing /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /^Lina/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Hugo/ }))
    expect(screen.getByText('Absents').previousSibling).toHaveTextContent('2')
    expect(screen.getByText('Présents').previousSibling).toHaveTextContent('22')
    fireEvent.click(screen.getByRole('button', { name: /Valider l’appel/ }))
    expect(screen.getByRole('status')).toHaveTextContent('Appel validé')
  })
})
