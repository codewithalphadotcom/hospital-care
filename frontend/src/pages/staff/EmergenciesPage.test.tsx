import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fail, mockApi, mockStaffApi, userFor } from '../../test/mockApi'
import { renderStaff } from '../../test/renderStaff'

afterEach(() => vi.restoreAllMocks())

const table = () => screen.findByRole('table', { name: 'Emergency cases, newest first' })
const references = async () =>
  within(await table())
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent)

async function openForm() {
  await userEvent.click(await screen.findByRole('button', { name: 'New case' }))
  return screen.getByRole('region', { name: 'New emergency case' })
}

const next = () => userEvent.click(screen.getByRole('button', { name: 'Next' }))

describe('EmergenciesPage (stories #30 create case, #32 requirements)', () => {
  it('lists the hospital’s cases, newest first, with what they need', async () => {
    mockStaffApi({ role: 'bloodBank' })
    renderStaff('/staff/emergencies')
    expect(await references()).toEqual(['EC-2026-0002Bay 4', 'EC-2026-0001'])
    const row = (await table()).querySelectorAll('tbody tr')[0] as HTMLElement
    expect(within(row).getByText('Critical')).toBeInTheDocument()
    expect(within(row).getByText('4 × O− red cells, 1 × ICU bed')).toBeInTheDocument()
    expect(within(row).getByText('Open')).toBeInTheDocument()
  })

  it('lets doctors, nurses and admins open cases, but not other staff', async () => {
    for (const role of ['doctor', 'nurse', 'admin'] as const) {
      mockStaffApi({ role })
      const { unmount } = renderStaff('/staff/emergencies')
      expect(await screen.findByRole('button', { name: 'New case' })).toBeInTheDocument()
      unmount()
      vi.restoreAllMocks()
    }
    for (const role of ['bloodBank', 'pharmacist'] as const) {
      mockStaffApi({ role })
      const { unmount } = renderStaff('/staff/emergencies')
      await table()
      expect(screen.queryByRole('button', { name: 'New case' })).toBeNull()
      unmount()
      vi.restoreAllMocks()
    }
  })

  it('opens a case in three steps without any patient data', async () => {
    const { fetchMock } = mockStaffApi({ role: 'doctor' })
    renderStaff('/staff/emergencies')
    const form = await openForm()

    expect(within(form).getByRole('heading', { name: 'Step 1 of 3: Case' })).toHaveFocus()
    await userEvent.click(within(form).getByRole('radio', { name: /Critical/ }))
    await next()

    expect(within(form).getByRole('heading', { name: 'Step 2 of 3: What’s needed' })).toHaveFocus()
    await userEvent.selectOptions(within(form).getByLabelText('Blood group'), 'O-')
    await userEvent.clear(within(form).getByLabelText('Units'))
    await userEvent.type(within(form).getByLabelText('Units'), '4')
    await userEvent.click(within(form).getByRole('button', { name: 'Add another need' }))
    const second = within(form).getByRole('group', { name: 'Need 2' })
    await userEvent.selectOptions(within(second).getByLabelText('Type'), 'bed')
    await userEvent.selectOptions(within(second).getByLabelText('Bed type'), 'icu')
    await next()

    expect(within(form).getByRole('heading', { name: 'Step 3 of 3: Review' })).toHaveFocus()
    expect(within(form).getByText('4 × O− red cells')).toBeInTheDocument()
    expect(within(form).getByText('1 × ICU bed')).toBeInTheDocument()
    expect(within(form).getByText('None')).toBeInTheDocument()
    await userEvent.click(within(form).getByRole('button', { name: 'Open case' }))

    expect(await screen.findByText('Case EC-2026-0003 is open.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'New emergency case' })).toBeNull()
    expect(screen.getByRole('button', { name: 'New case' })).toHaveFocus()
    expect((await references())[0]).toBe('EC-2026-0003')
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(post[1]!.body))).toEqual({
      severity: 'critical',
      patientRef: '',
      items: [
        { type: 'blood', group: 'O-', component: 'redCells', quantity: 4 },
        { type: 'bed', bedType: 'icu', quantity: 1 },
      ],
    })
  })

  it('won’t move on until each step is valid', async () => {
    mockStaffApi({ role: 'nurse' })
    renderStaff('/staff/emergencies')
    const form = await openForm()

    await next()
    expect(within(form).getByText('Choose how severe the case is')).toBeInTheDocument()
    expect(within(form).getByRole('heading', { name: 'Step 1 of 3: Case' })).toBeInTheDocument()
    await userEvent.click(within(form).getByRole('radio', { name: /Urgent/ }))
    await next()

    const units = within(form).getByLabelText('Units')
    await userEvent.clear(units)
    await userEvent.type(units, '25')
    await next()
    expect(within(form).getByText('At most 20 per line; add another line for more')).toBeInTheDocument()
    expect(units).toHaveFocus()

    await userEvent.click(within(form).getByRole('button', { name: 'Back' }))
    expect(within(form).getByRole('radio', { name: /Urgent/ })).toBeChecked()
  })

  it('shows what went wrong when the server refuses the case', async () => {
    mockStaffApi({ role: 'doctor' })
    renderStaff('/staff/emergencies')
    const form = await openForm()
    await userEvent.click(within(form).getByRole('radio', { name: /Routine/ }))
    await next()
    await next()

    vi.restoreAllMocks()
    mockApi({
      'GET /auth/me/': { body: userFor('doctor') },
      'POST /emergencies/': fail(400, { items: { '0': { quantity: ['Ask for at most 20 per item.'] } } }),
    })
    await userEvent.click(within(form).getByRole('button', { name: 'Open case' }))
    expect(await within(form).findByText('Ask for at most 20 per item.')).toBeInTheDocument()
    expect(within(form).getByRole('heading', { name: 'Step 2 of 3: What’s needed' })).toBeInTheDocument()

    vi.restoreAllMocks()
    mockApi({ 'POST /emergencies/': fail(503) })
    await next()
    await userEvent.click(within(form).getByRole('button', { name: 'Open case' }))
    expect(await within(form).findByText('The hospital’s system didn’t respond, so the case wasn’t opened. Try again.')).toBeInTheDocument()
  })

  it('says so when there are no cases, and is closed to patients', async () => {
    mockStaffApi({ role: 'pharmacist', cases: [] })
    const { unmount } = renderStaff('/staff/emergencies')
    expect(await screen.findByText('No emergency cases yet.')).toBeInTheDocument()
    unmount()
    vi.restoreAllMocks()
    mockStaffApi({ role: 'patient' })
    renderStaff('/staff/emergencies')
    expect(await screen.findByRole('heading', { name: 'This area is for hospital staff' })).toBeInTheDocument()
  })
})
