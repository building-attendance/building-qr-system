// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { IconButton } from '../../src/admin/ui.jsx'
import { IconEdit, IconTrash } from '../../src/admin/icons.jsx'

afterEach(cleanup)

describe('IconButton', () => {
  it('is found by its label, which is also its tooltip, and shows nothing but the icon', () => {
    render(<IconButton icon={IconEdit} label="עריכה" onClick={() => {}} />)
    const button = screen.getByRole('button', { name: 'עריכה' })
    expect(button).toHaveProperty('title', 'עריכה')
    expect(button.textContent).toBe('')
    expect(button.querySelector('svg')).not.toBeNull()
  })

  it('calls its handler once per click', () => {
    const onClick = vi.fn()
    render(<IconButton icon={IconEdit} label="עריכה" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'עריכה' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does nothing while disabled', () => {
    const onClick = vi.fn()
    render(<IconButton icon={IconTrash} label="מחיקה" onClick={onClick} disabled />)
    const button = screen.getByRole('button', { name: 'מחיקה' })
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('is a link when given an address (a download), still named by its label', () => {
    render(<IconButton icon={IconEdit} label="ייצוא ל-Excel" href="/api/admin/scans?format=csv" download="scans.csv" />)
    const link = screen.getByRole('link', { name: 'ייצוא ל-Excel' })
    expect(link.getAttribute('href')).toBe('/api/admin/scans?format=csv')
    expect(link.getAttribute('download')).toBe('scans.csv')
  })

  it('a disabled link is a disabled button: a link cannot be switched off, and must not be followed meanwhile', () => {
    render(<IconButton icon={IconEdit} label="ייצוא" href="/api/export.csv" download="x.csv" disabled />)
    const button = screen.getByRole('button', { name: 'ייצוא' })
    expect(button.disabled).toBe(true)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('has one look: the grey icon, with the one class a-icon-btn', () => {
    render(<IconButton icon={IconEdit} label="a" />)
    expect(screen.getByRole('button', { name: 'a' }).className).toBe('a-icon-btn')
  })

  it('never submits a form by accident', () => {
    render(<IconButton icon={IconEdit} label="עריכה" />)
    expect(screen.getByRole('button', { name: 'עריכה' }).getAttribute('type')).toBe('button')
  })
})
