import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EmergencyCase, Severity } from '../../api/emergencies'
import { fail, mockApi, mockStaffApi, userFor } from '../../test/mockApi'
import { renderStaff } from '../../test/renderStaff'

afterEach(() => vi.restoreAllMocks())

const caseFor = (id: string, severity: Severity): EmergencyCase => ({
  id,
  severity,
  status: 'open',
  patientRef: '',
  hospital: null,
  createdBy: 'Hina Javed',
  createdAt: new Date().toISOString(),
  items: [{ type: 'bed', bedType: 'icu', quantity: 1 }],
})

const table = () => screen.findByRole('table', { name: 'Emergency cases, most severe first, then oldest first' })
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
  it('lists the hospital’s cases with what they need', async () => {
    mockStaffApi({ role: 'bloodBank' })
    renderStaff('/staff/emergencies')
    expect(await references()).toEqual(['EC-2026-0002Bay 4', 'EC-2026-0001'])
    const row = (await table()).querySelectorAll('tbody tr')[0] as HTMLElement
    expect(within(row).getByText('Critical')).toBeInTheDocument()
    expect(within(row).getByText('4 × O− red cells, 1 × ICU bed')).toBeInTheDocument()
    expect(within(row).getByText('Open')).toBeInTheDocument()
  })

  it('shows cases in the order the server sends them, without re-sorting (#31)', async () => {
    // Deliberately not severity order: the page shows what it is given.
    mockStaffApi({ role: 'nurse', cases: [caseFor('EC-2026-0004', 'low'), caseFor('EC-2026-0001', 'critical'), caseFor('EC-2026-0003', 'moderate')] })
    renderStaff('/staff/emergencies')
    expect(await references()).toEqual(['EC-2026-0004', 'EC-2026-0001', 'EC-2026-0003'])
  })

  it('marks a critical case with its label, and gives every level its own label (#31)', async () => {
    mockStaffApi({ role: 'nurse', cases: [caseFor('EC-2026-0001', 'critical'), caseFor('EC-2026-0002', 'high'), caseFor('EC-2026-0003', 'moderate'), caseFor('EC-2026-0004', 'low')] })
    renderStaff('/staff/emergencies')
    const rows = within(await table()).getAllByRole('row').slice(1)
    const labels = rows.map((row) => within(row).getAllByRole('cell')[1].textContent)
    expect(labels).toEqual(['Critical', 'High', 'Moderate', 'Low'])
    expect(within(rows[0]).getByText('Critical')).toBeInTheDocument()
    expect(within(rows[1]).queryByText('Critical')).toBeNull()
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
    // The new critical case sorts after the older critical one: the list is reloaded from the server.
    await waitFor(async () => expect(await references()).toEqual(['EC-2026-0002Bay 4', 'EC-2026-0003', 'EC-2026-0001']))
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

  it('offers the four severity levels, most severe first (#31)', async () => {
    mockStaffApi({ role: 'doctor' })
    renderStaff('/staff/emergencies')
    const form = await openForm()
    const levels = within(form)
      .getAllByRole('radio')
      .map((radio) => radio.closest('label')?.querySelector('strong')?.textContent)
    expect(levels).toEqual(['Critical', 'High', 'Moderate', 'Low'])
  })

  it('won’t move on until each step is valid', async () => {
    mockStaffApi({ role: 'nurse' })
    renderStaff('/staff/emergencies')
    const form = await openForm()

    await next()
    expect(within(form).getByText('Choose how severe the case is')).toBeInTheDocument()
    expect(within(form).getByRole('heading', { name: 'Step 1 of 3: Case' })).toBeInTheDocument()
    await userEvent.click(within(form).getByRole('radio', { name: /High/ }))
    await next()

    const units = within(form).getByLabelText('Units')
    await userEvent.clear(units)
    await userEvent.type(units, '25')
    await next()
    expect(within(form).getByText('At most 20 per line; add another line for more')).toBeInTheDocument()
    expect(units).toHaveFocus()

    await userEvent.click(within(form).getByRole('button', { name: 'Back' }))
    expect(within(form).getByRole('radio', { name: /High/ })).toBeChecked()
  })

  it('shows what went wrong when the server refuses the case', async () => {
    mockStaffApi({ role: 'doctor' })
    renderStaff('/staff/emergencies')
    const form = await openForm()
    await userEvent.click(within(form).getByRole('radio', { name: /Moderate/ }))
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
