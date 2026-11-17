import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fail, mockApi, mockStaffApi, userFor } from '../../test/mockApi'
import { renderStaff } from '../../test/renderStaff'
import { sampleCases } from '../../test/fixtures/emergencies'

afterEach(() => vi.restoreAllMocks())

const CASE = '/staff/emergencies/EC-2026-0002'
const details = async () => screen.findByRole('region', { name: 'EC-2026-0002' })
const moves = async () => screen.findByRole('region', { name: 'Update status' })
const history = async () => screen.findByRole('region', { name: 'Status history' })
const entries = async () => within(await history()).getAllByRole('listitem')
const entryHeadings = async () => (await entries()).map((li) => li.querySelector('strong')?.textContent)

describe('EmergencyCasePage (story #34 status tracking)', () => {
  it('shows the case, its severity, status, patient reference and what it needs', async () => {
    mockStaffApi({ role: 'doctor' })
    renderStaff(CASE)

    expect(await screen.findByRole('heading', { name: 'EC-2026-0002' })).toBeInTheDocument()
    const panel = await details()
    expect(within(panel).getByText('Critical')).toBeInTheDocument()
    expect(within(panel).getByText('Open')).toBeInTheDocument()
    expect(within(panel).getByText('Bay 4')).toBeInTheDocument()
    expect(within(within(panel).getByRole('list')).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '4 × O− red cells',
      '1 × ICU bed',
    ])
  })

  it('offers only the moves the case’s status allows', async () => {
    mockStaffApi({ role: 'nurse' })
    renderStaff(CASE)

    const region = await moves()
    expect(within(region).getAllByRole('button').map((b) => b.textContent)).toEqual(['Start matching', 'Escalate', 'Cancel case'])
  })

  it('moves the case with a note, then shows the new status and the timeline entry', async () => {
    const { fetchMock } = mockStaffApi({ role: 'nurse' })
    renderStaff(CASE)

    const region = await moves()
    await userEvent.type(within(region).getByLabelText(/Note/), 'Blood bank called back')
    await userEvent.click(within(region).getByRole('button', { name: 'Start matching' }))

    expect(await within(region).findByRole('button', { name: 'Mark fulfilled' })).toBeInTheDocument()
    expect(within(region).getByText('EC-2026-0002 is now matching.')).toBeInTheDocument()
    expect(within(await details()).getByText('Matching')).toBeInTheDocument()
    expect(within(region).getByLabelText(/Note/)).toHaveValue('')
    expect(await entryHeadings()).toEqual(['Case opened', 'Open → Matching'])
    expect(within(await history()).getByText('Blood bank called back')).toBeInTheDocument()

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(post[1]!.body))).toEqual({ action: 'startMatching', note: 'Blood bank called back' })
  })

  it('shows the timeline oldest first, in the order the server keeps it', async () => {
    mockStaffApi({ role: 'doctor' })
    const { unmount } = renderStaff(CASE)

    const region = await moves()
    await userEvent.click(within(region).getByRole('button', { name: 'Start matching' }))
    await within(region).findByRole('button', { name: 'Mark partially fulfilled' })
    await userEvent.type(within(region).getByLabelText(/Note/), 'Two of four')
    await userEvent.click(within(region).getByRole('button', { name: 'Mark partially fulfilled' }))
    await within(region).findByRole('button', { name: 'Close case' })

    unmount()
    renderStaff(CASE)
    expect(await entryHeadings()).toEqual(['Case opened', 'Open → Matching', 'Matching → Partially fulfilled'])
    expect(within(await history()).getByText('Two of four')).toBeInTheDocument()
  })

  it('shows the server’s reason when it refuses a move', async () => {
    mockStaffApi({ role: 'doctor' })
    renderStaff(CASE)

    const region = await moves()
    // Someone else moved the case since this page loaded, so the server now refuses the move the page offers.
    vi.restoreAllMocks()
    mockApi({
      'GET /auth/me/': { body: userFor('doctor') },
      'POST /emergencies/:reference/actions/': fail(409, { detail: "Can't startMatching a case that is matching." }),
    })
    await userEvent.click(within(region).getByRole('button', { name: 'Start matching' }))

    expect(await within(region).findByRole('alert')).toHaveTextContent("Can't startMatching a case that is matching.")
    expect(within(await details()).getByText('Open')).toBeInTheDocument()
    expect(await entryHeadings()).toEqual(['Case opened'])
  })

  it('lets view-only roles read the case and its timeline, but not move it', async () => {
    mockStaffApi({ role: 'bloodBank' })
    renderStaff(CASE)

    expect(await screen.findByRole('heading', { name: 'EC-2026-0002' })).toBeInTheDocument()
    expect(await entryHeadings()).toEqual(['Case opened'])
    expect(screen.queryByRole('region', { name: 'Update status' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Start matching|Escalate|Cancel case/ })).toBeNull()
  })

  it('says so when a case has no moves left', async () => {
    const closed = { ...sampleCases(new Date())[0], status: 'closed' as const }
    mockStaffApi({ role: 'doctor', cases: [closed] })
    renderStaff(CASE)

    expect(await screen.findByText('No moves from closed.')).toBeInTheDocument()
    expect((await moves()).querySelectorAll('button')).toHaveLength(0)
  })

  it('says when there is no such case, with a way back to the list', async () => {
    mockStaffApi({ role: 'doctor' })
    renderStaff('/staff/emergencies/EC-2026-9999')
    expect(await screen.findByText('No emergency case with that id.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← All emergency cases' })).toHaveAttribute('href', '/staff/emergencies')
  })
})
