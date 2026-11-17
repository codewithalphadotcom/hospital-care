import { vi } from 'vitest'
import type { User } from '../api/auth'
import type { BedAction, BedBoard } from '../api/beds'
import type {
  CandidatesResponse,
  CaseAction,
  CaseInput,
  CaseStatus,
  EmergencyCase,
  EmergencyCaseDetail,
  FeedEntry,
  Severity,
  StatusChange,
} from '../api/emergencies'
import { COMPONENTS, REQUIRED_TESTS, type BloodUnit, type BloodUnitInput, type ScreeningTest, type TestResult } from '../api/blood'
import type { Equipment, EquipmentAction, EquipmentInput } from '../api/equipment'
import type {
  OperatingRoom,
  OperatingRoomAction,
  OperatingRoomInput,
  OrBooking,
  OrBookingInput,
  OrCapability,
} from '../api/operatingRooms'
import type { HospitalInput, StructureKind } from '../api/hospitals'
import type { PublicStatus } from '../api/publicStatus'
import type { UserSummary } from '../api/users'
import { applyAction } from '../features/beds/beds'
import { actionsFor, nextStatus, STATUS_LABEL } from '../features/emergencies/emergencies'
import { applyEquipmentAction } from '../features/equipment/equipment'
import { applyOperatingRoomAction } from '../features/operatingRooms/operatingRooms'
import { canEdit, canSee, type Module, type Role } from '../features/staff/roles'
import { dateKey } from '../lib/time'
import { sampleBedBoard } from './fixtures/beds'
import { sampleBloodUnits } from './fixtures/blood'
import { sampleCandidates, sampleCases, sampleLocalAvailable, sampleNetworkRequests } from './fixtures/emergencies'
import { sampleCapabilities, sampleHospitals, sampleUsers } from './fixtures/hospitals'
import { sampleMedicines } from './fixtures/pharmacy'
import { samplePublicStatus } from './fixtures/publicStatus'

export type Reply = { status?: number; body?: unknown }
type Request = { params: Record<string, string>; body: unknown; query: URLSearchParams }
type Route = Reply | ((request: Request) => Reply)

export const ok = (body?: unknown): Reply => ({ status: 200, body })
export const fail = (status: number, body: unknown = { detail: 'Request failed' }): Reply => ({ status, body })

/** "/beds/:id/actions/" against "/beds/ICU-01/actions/" → { id: "ICU-01" }, or null when it doesn't match. */
function match(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split('/')
  const got = path.split('/')
  if (want.length !== got.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) params[want[i].slice(1)] = decodeURIComponent(got[i])
    else if (want[i] !== got[i]) return null
  }
  return params
}

/**
 * Replace fetch with a fake API. Keys are "METHOD /path/" relative to /api, with :params.
 * Unknown routes answer 404, like the real server.
 */
export function mockApi(routes: Record<string, Route>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    const path = url.pathname.replace(/^\/api/, '')
    const method = (init?.method ?? 'GET').toUpperCase()
    for (const [key, route] of Object.entries(routes)) {
      const [routeMethod, pattern] = key.split(' ')
      const params = routeMethod === method ? match(pattern, path) : null
      if (!params) continue
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      const reply = typeof route === 'function' ? route({ params, body, query: url.searchParams }) : route
      const status = reply.status ?? 200
      return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), { status })
    }
    return new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 })
  })
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, moderate: 2, low: 3 }

/** The order the server lists cases in: most severe first, then the oldest case first (story #31). */
const byPriority = (a: Pick<EmergencyCase, 'severity' | 'createdAt'>, b: Pick<EmergencyCase, 'severity' | 'createdAt'>) =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.createdAt.localeCompare(b.createdAt)

/** The statuses the network feed lists (story #36). */
const FEED_STATUSES: readonly CaseStatus[] = ['open', 'matching', 'partiallyFulfilled', 'escalated']

/** A case as the network feed lists it: the same request, with nothing filled yet. */
const feedEntryOf = (c: EmergencyCase): FeedEntry => ({
  reference: c.id,
  hospital: c.hospital,
  severity: c.severity,
  status: c.status,
  createdAt: c.createdAt,
  needs: c.items.map((need) => ({ ...need, fulfilled: 0 })),
})

/** What the server fills in for a new structure item. */
const STRUCTURE_DEFAULTS: Record<StructureKind, Record<string, unknown>> = {
  departments: {},
  wards: { code: 'new-ward', kind: '', departmentId: null, bedCount: 0 },
  locations: {},
}

const NAMES: Record<Role | 'patient', string> = {
  admin: 'Sadia Admin',
  doctor: 'Dr. Ayesha Khan',
  nurse: 'Hina Javed',
  bloodBank: 'Kashif Mehmood',
  pharmacist: 'Rabia Anwar',
  patient: 'Sara Ahmed',
}

export function userFor(role: Role | 'patient'): User {
  const hospital = role === 'patient' ? null : { id: 1, name: 'CityCare General Hospital' }
  return { id: 1, email: `${role.toLowerCase()}@demo.test`, fullName: NAMES[role], phone: '', role, isStaff: role !== 'patient', hospital }
}

/**
 * The staff API as the backend behaves: /auth/me/ for the given role (or 403 when signed out),
 * modules gated by the same access table, and bed actions that change the board or answer 409.
 */
type StaffApiOptions = {
  role: Role | 'patient' | null
  /** Make GET /public/status/ fail. */
  erDown?: boolean
  /** Use this board instead of the sample one. */
  board?: BedBoard
  /** Use this public status instead of the sample one. */
  publicStatus?: PublicStatus
  /** Make every hospitals, users and emergencies call fail as if the server were down. */
  networkDown?: boolean
  /** Use these emergency cases instead of the sample ones. */
  cases?: EmergencyCase[]
  /** Replace a case's timeline (by reference), e.g. to show an entry the system made. */
  histories?: Record<string, StatusChange[]>
  /** Use this network feed instead of the sample one, which is these cases plus another hospital's requests. */
  feed?: FeedEntry[]
  /** Use these sources (story #38) for whichever case is asked for, instead of the sample ones. */
  candidates?: CandidatesResponse
}

/** A few pieces of equipment across types and statuses (story #26). */
export function sampleEquipment(now: Date): Equipment[] {
  const at = now.toISOString()
  const item = (id: number, identifier: string, type: Equipment['type'], status: Equipment['status'], location: string) =>
    ({ id, identifier, type, status, location, name: '', statusSince: at, hospital: 'CityCare General Hospital' }) satisfies Equipment
  return [
    item(1, 'VENT-001', 'ventilator', 'inUse', 'ICU bay 1'),
    item(2, 'VENT-002', 'ventilator', 'available', 'ICU bay 2'),
    item(3, 'VENT-003', 'ventilator', 'maintenance', 'HDU'),
    item(4, 'DEFIB-001', 'defibrillator', 'available', 'Emergency department'),
    item(5, 'DIAL-001', 'dialysis', 'outOfService', 'Dialysis unit'),
  ]
}

/** A few operating rooms across capabilities and statuses, sorted by name as the server returns them (story #28). */
export function sampleOperatingRooms(now: Date): OperatingRoom[] {
  const at = now.toISOString()
  const room = (id: number, name: string, capabilities: OrCapability[], status: OperatingRoom['status'], location: string) =>
    ({ id, name, capabilities, status, location, statusSince: at, hospital: 'CityCare General Hospital' }) satisfies OperatingRoom
  return [
    room(1, 'Cardiac theatre', ['cardiac', 'general'], 'inUse', 'Block B, floor 3'),
    room(2, 'OR 1', ['general'], 'available', 'Block B, floor 2'),
    room(3, 'Trauma theatre', ['general', 'neuro', 'trauma'], 'cleaning', 'Emergency block, floor 1'),
  ]
}

/** Today's bookings (story #29): two in OR 1 with a gap before the next, one in Cardiac theatre. Times in Karachi. */
export function sampleOrBookings(now: Date): OrBooking[] {
  const day = dateKey(now)
  const slot = (id: number, roomId: number, start: string, end: string, procedure: string, surgeon: string): OrBooking => ({
    id,
    roomId,
    startsAt: `${day}T${start}:00+05:00`,
    endsAt: `${day}T${end}:00+05:00`,
    procedure,
    surgeon,
    patientInitials: 'A.K.',
    status: 'booked',
    bookedBy: 'Hina Javed',
    canCancel: true,
  })
  return [
    slot(1, 1, '09:00', '13:00', 'CABG', 'Dr. Ayesha Khan'),
    slot(2, 2, '08:00', '10:00', 'Appendicectomy', 'Dr. Bilal Ahmed'),
    slot(3, 2, '10:00', '12:30', 'Cholecystectomy', 'Dr. Bilal Ahmed'),
  ]
}

/** "+05:00"-stamped time as HH:MM, the way the server words a clash. */
const clock = (iso: string) => iso.slice(11, 16)

export function mockStaffApi({
  role,
  erDown = false,
  board: customBoard,
  publicStatus,
  networkDown = false,
  cases: customCases,
  histories: customHistories,
  feed: customFeed,
  candidates: customCandidates,
}: StaffApiOptions) {
  const now = new Date()
  const board = customBoard ?? sampleBedBoard(now)
  const units = sampleBloodUnits(now)
  const hospitals = sampleHospitals()
  const users = sampleUsers()
  const cases = customCases ?? sampleCases(now)
  /** Each case's timeline, as the server keeps it. A case that starts here has only its opening entry. */
  const openingEntry = (c: EmergencyCase): StatusChange => ({
    fromStatus: '',
    toStatus: 'open',
    action: 'create',
    note: '',
    actor: c.createdBy || null,
    at: c.createdAt,
  })
  const histories = new Map<string, StatusChange[]>(cases.map((c) => [c.id, [openingEntry(c)]]))
  for (const [reference, entries] of Object.entries(customHistories ?? {})) histories.set(reference, entries)
  const findCase = (reference: string) => cases.find((c) => c.id === reference)
  /** The case as the server returns it: each need with what this hospital has (story #33), from the sample stock. */
  const detailOf = (c: EmergencyCase): EmergencyCaseDetail => {
    const local = sampleLocalAvailable[c.id] ?? []
    const items = c.items.map((need, i) => ({ ...need, localAvailable: local[i] ?? 0, shortfall: Math.max(0, need.quantity - (local[i] ?? 0)) }))
    const history = histories.get(c.id) ?? []
    const closes = history.filter((change) => change.action === 'close')
    return {
      ...c,
      items,
      shortfallTotal: items.reduce((sum, need) => sum + need.shortfall, 0),
      history,
      actions: actionsFor(c.status),
      outcome: closes.length ? closes[closes.length - 1].note : null,
    }
  }
  const equipment = sampleEquipment(now)
  const rooms = sampleOperatingRooms(now)
  const bookings = sampleOrBookings(now)
  const gate = (module: Module, reply: () => Reply): Route => () =>
    role && role !== 'patient' && canSee(role, module) ? reply() : fail(403)
  /** Like gate, but the reply sees the request, and `networkDown` fails it. Reads need view, writes need edit. */
  const allowed =
    (check: typeof canSee) =>
    (module: Module, reply: (request: Request) => Reply): Route =>
    (request) => {
      if (networkDown) return fail(503)
      return role && role !== 'patient' && check(role, module) ? reply(request) : fail(403)
    }
  const view = allowed(canSee)
  const edit = allowed(canEdit)
  const findHospital = (id: string) => hospitals.find((h) => h.id === Number(id))
  const unitTests = new Map<string, TestResult[]>()
  const unitDetailBody = (unit: BloodUnit) => {
    const tests = unitTests.get(unit.id) ?? []
    const passed = new Set(tests.filter((t) => t.passed).map((t) => t.test))
    return { ...unit, donorId: null, tests, missingTests: REQUIRED_TESTS.map((t) => t.id).filter((id) => !passed.has(id)) }
  }
  let nextId = 100

  const fetchMock = mockApi({
    'GET /auth/me/': role ? ok(userFor(role)) : fail(403),
    'POST /auth/login/': role ? ok(userFor(role)) : fail(401, { detail: 'That email and password don’t match an account.' }),
    'POST /auth/logout/': { status: 204 },
    'GET /public/status/': erDown ? fail(503) : ok(publicStatus ?? samplePublicStatus(now)),
    'GET /beds/': gate('beds', () => ok(board)),
    'GET /blood/units/': gate('blood', () => ok(units)),
    'POST /blood/units/': edit('blood', ({ body }) => {
      const input = body as BloodUnitInput
      if (units.some((u) => u.id === input.id)) {
        return fail(400, { id: ['A unit with this ID already exists.'] })
      }
      const shelfLifeDays = COMPONENTS.find((c) => c.id === input.component)!.shelfLifeDays
      const created = {
        ...input,
        status: 'quarantined' as const,
        expiresAt: new Date(new Date(input.collectedAt).getTime() + shelfLifeDays * 86_400_000).toISOString(),
      }
      units.push(created)
      return { status: 201, body: created }
    }),
    'GET /blood/units/:id/': ({ params }) => {
      if (!role || role === 'patient' || !canSee(role, 'blood')) return fail(403)
      const unit = units.find((u) => u.id === params.id)
      return unit ? ok(unitDetailBody(unit)) : fail(404)
    },
    'POST /blood/units/:id/tests/': ({ params, body }) => {
      if (!role || role === 'patient' || !canEdit(role, 'blood')) return fail(403)
      const unit = units.find((u) => u.id === params.id)
      if (!unit) return fail(404)
      if (unit.status !== 'quarantined') {
        return fail(409, { detail: `Tests can only be recorded on quarantined units; this one is ${unit.status}.` })
      }
      const { test, passed, reason } = body as { test: ScreeningTest; passed: boolean; reason?: string }
      const existing = unitTests.get(unit.id) ?? []
      if (existing.some((t) => t.test === test)) return fail(400, { test: ['This test is already recorded for this unit.'] })
      if (!passed && !(reason ?? '').trim()) return fail(400, { reason: ['Say why the test failed.'] })
      const updated = [...existing, { test, passed, reason: passed ? '' : (reason ?? ''), recordedAt: new Date().toISOString() }]
      unitTests.set(unit.id, updated)
      const passedTests = new Set(updated.filter((t) => t.passed).map((t) => t.test))
      if (!passed) unit.status = 'discarded'
      else if (REQUIRED_TESTS.every((t) => passedTests.has(t.id))) unit.status = 'available'
      return { status: 201, body: unitDetailBody(unit) }
    },
    'GET /pharmacy/stock/': gate('pharmacy', () => ok(sampleMedicines(now))),
    'POST /beds/:id/actions/': ({ params, body }) => {
      if (!role || role === 'patient' || !canEdit(role, 'beds')) return fail(403)
      const index = board.beds.findIndex((b) => b.id === params.id)
      if (index < 0) return fail(404)
      try {
        board.beds[index] = applyAction(board.beds[index], (body as { action: BedAction }).action, new Date())
      } catch (error) {
        return fail(409, { detail: (error as Error).message })
      }
      return ok(board.beds[index])
    },

    'GET /emergencies/': view('emergencies', () => ok(cases)),
    'POST /emergencies/': edit('emergencies', ({ body }) => {
      const input = body as CaseInput
      if (!input.items?.length) return fail(400, { items: ['This list may not be empty.'] })
      const year = now.getFullYear()
      const created: EmergencyCase = {
        id: `EC-${year}-${String(cases.length + 1).padStart(4, '0')}`,
        severity: input.severity,
        status: 'open',
        patientRef: input.patientRef,
        hospital: role === 'patient' || !role ? null : userFor(role).hospital,
        createdBy: role ? NAMES[role] : '',
        createdAt: new Date().toISOString(),
        items: input.items,
      }
      cases.push(created)
      histories.set(created.id, [openingEntry(created)])
      cases.sort(byPriority)
      return { status: 201, body: created }
    }),
    // Before /emergencies/:reference/, which would otherwise match "feed".
    'GET /emergencies/feed/': view('emergencies', ({ query }) => {
      const type = query.get('type') ?? 'blood'
      if (type !== 'blood' && type !== 'bed') return fail(400, { type: ['Use one of: blood, bed.'] })
      const entries = customFeed ?? [...cases.map(feedEntryOf), ...sampleNetworkRequests(now)]
      const listed = entries
        .filter((entry) => FEED_STATUSES.includes(entry.status))
        .map((entry) => ({ ...entry, needs: entry.needs.filter((need) => need.type === type) }))
        .filter((entry) => entry.needs.length > 0)
        .sort(byPriority)
      return ok(listed)
    }),
    'GET /emergencies/:reference/': view('emergencies', ({ params }) => {
      const found = findCase(params.reference)
      return found ? ok(detailOf(found)) : fail(404)
    }),
    'GET /emergencies/:reference/candidates/': view('emergencies', ({ params }) => {
      if (!findCase(params.reference)) return fail(404)
      if (customCandidates) return ok({ ...customCandidates, reference: params.reference })
      return ok(sampleCandidates(now)[params.reference] ?? { reference: params.reference, items: [] })
    }),
    'POST /emergencies/:reference/actions/': edit('emergencies', ({ params, body }) => {
      const found = findCase(params.reference)
      if (!found) return fail(404)
      const { action, note } = body as { action: CaseAction; note: string }
      const next = nextStatus(found.status, action)
      if (!next) return fail(409, { detail: `Can't ${action} a case that is ${STATUS_LABEL[found.status].toLowerCase()}.` })
      if (action === 'close' && !note.trim()) return fail(400, { note: ['Add an outcome note to close the case.'] })
      const entry: StatusChange = {
        fromStatus: found.status,
        toStatus: next,
        action,
        note: note.trim(),
        actor: role ? NAMES[role] : null,
        at: new Date().toISOString(),
      }
      histories.set(found.id, [...(histories.get(found.id) ?? []), entry])
      found.status = next
      return ok(detailOf(found))
    }),

    'GET /users/': view('users', () => ok(users)),
    'PATCH /users/:id/': edit('users', ({ params, body }) => {
      const user = users.find((u) => u.id === Number(params.id))
      if (!user) return fail(404)
      if (user.roleLocked) return fail(400, { role: ['You can’t change your own role.'] })
      user.role = (body as { role: UserSummary['role'] }).role
      return ok(user)
    }),

    // Before /hospitals/:id/, which would otherwise match it.
    'GET /hospitals/capabilities/': view('hospitals', () => ok(sampleCapabilities)),
    'GET /hospitals/': view('hospitals', () => ok(hospitals)),
    'GET /equipment/': view('equipment', () => ok(equipment)),
    'POST /equipment/': edit('equipment', ({ body }) => {
      const input = body as EquipmentInput
      const tag = input.identifier.toUpperCase()
      if (equipment.some((e) => e.identifier === tag)) {
        return fail(400, { identifier: ['This asset tag is already registered in your hospital.'] })
      }
      const created: Equipment = { ...input, identifier: tag, id: nextId++, statusSince: now.toISOString(), hospital: 'CityCare General Hospital' }
      equipment.push(created)
      return { status: 201, body: created }
    }),
    'POST /equipment/:id/actions/': edit('equipment', ({ params, body }) => {
      const index = equipment.findIndex((e) => e.id === Number(params.id))
      if (index < 0) return fail(404)
      try {
        equipment[index] = applyEquipmentAction(equipment[index], (body as { action: EquipmentAction }).action, new Date())
      } catch (error) {
        return fail(409, { detail: (error as Error).message })
      }
      return ok(equipment[index])
    }),
    'GET /operating-rooms/': view('operatingRooms', ({ query }) => {
      const capability = query.get('capability')
      const status = query.get('status')
      return ok(
        rooms.filter(
          (r) => (!capability || r.capabilities.includes(capability as OrCapability)) && (!status || r.status === status),
        ),
      )
    }),
    'POST /operating-rooms/': edit('operatingRooms', ({ body }) => {
      const input = body as OperatingRoomInput
      if (rooms.some((r) => r.name.toLowerCase() === input.name.toLowerCase())) {
        return fail(400, { name: ['A room with this name is already registered in your hospital.'] })
      }
      const created: OperatingRoom = {
        ...input,
        capabilities: [...new Set(input.capabilities)].sort(),
        id: nextId++,
        statusSince: now.toISOString(),
        hospital: 'CityCare General Hospital',
      }
      rooms.push(created)
      return { status: 201, body: created }
    }),
    'GET /operating-rooms/schedule/': view('operatingRooms', ({ query }) => {
      const date = query.get('date') ?? dateKey(now)
      return ok({
        date,
        rooms: rooms.map((room) => ({
          id: room.id,
          name: room.name,
          status: room.status,
          capabilities: room.capabilities,
          bookings: bookings
            .filter((b) => b.roomId === room.id && b.status === 'booked' && b.startsAt.startsWith(date))
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
            // Same rule as the server: admins and nurses cancel any booking, others only their own.
            .map((b) => ({ ...b, canCancel: role === 'admin' || role === 'nurse' || b.bookedBy === NAMES[role!] })),
        })),
      })
    }),
    'POST /operating-rooms/bookings/': edit('orBookings', ({ body }) => {
      const input = body as OrBookingInput
      const room = rooms.find((r) => r.id === input.roomId)
      if (!room) return fail(400, { roomId: ['Pick a room.'] })
      const clash = bookings.find(
        (b) => b.roomId === room.id && b.status === 'booked' && b.startsAt < input.endsAt && b.endsAt > input.startsAt,
      )
      if (clash) {
        return fail(400, { startsAt: [`${room.name} is already booked from ${clock(clash.startsAt)} to ${clock(clash.endsAt)}.`] })
      }
      const created: OrBooking = { ...input, id: nextId++, status: 'booked', bookedBy: NAMES.nurse, canCancel: true }
      bookings.push(created)
      return { status: 201, body: created }
    }),
    'POST /operating-rooms/bookings/:id/cancel/': edit('orBookings', ({ params }) => {
      const booking = bookings.find((b) => b.id === Number(params.id))
      if (!booking) return fail(404)
      if (booking.status === 'cancelled') return fail(409, { detail: 'This booking is already cancelled.' })
      booking.status = 'cancelled'
      return ok(booking)
    }),
    'POST /operating-rooms/:id/actions/': edit('operatingRooms', ({ params, body }) => {
      const index = rooms.findIndex((r) => r.id === Number(params.id))
      if (index < 0) return fail(404)
      try {
        rooms[index] = applyOperatingRoomAction(rooms[index], (body as { action: OperatingRoomAction }).action, new Date())
      } catch (error) {
        return fail(409, { detail: (error as Error).message })
      }
      return ok(rooms[index])
    }),
    'POST /hospitals/': edit('hospitals', ({ body }) => {
      const input = body as HospitalInput
      if (hospitals.some((h) => h.name.toLowerCase() === input.name.toLowerCase())) {
        return fail(400, { name: ['A hospital with this name is already registered.'] })
      }
      const created = { ...input, id: nextId++, departments: [], wards: [], locations: [] }
      hospitals.push(created)
      return { status: 201, body: created }
    }),
    'GET /hospitals/:id/': view('hospitals', ({ params }) => {
      const hospital = findHospital(params.id)
      return hospital ? ok(hospital) : fail(404)
    }),
    'PATCH /hospitals/:id/': edit('hospitals', ({ params, body }) => {
      const hospital = findHospital(params.id)
      if (!hospital) return fail(404)
      Object.assign(hospital, body)
      return ok(hospital)
    }),
    'POST /hospitals/:id/:kind/': edit('hospitals', ({ params, body }) => {
      const hospital = findHospital(params.id)
      const kind = params.kind as StructureKind
      if (!hospital || !(kind in STRUCTURE_DEFAULTS)) return fail(404)
      const data = body as { name: string }
      const list = hospital[kind] as { id: number; name: string }[]
      if (list.some((item) => item.name.toLowerCase() === data.name.toLowerCase())) {
        return fail(400, { name: ['This hospital already has one with that name.'] })
      }
      const item = { ...STRUCTURE_DEFAULTS[kind], ...data, id: nextId++ }
      list.push(item)
      return { status: 201, body: item }
    }),
    'DELETE /hospitals/:id/:kind/:item/': edit('hospitals', ({ params }) => {
      const hospital = findHospital(params.id)
      const kind = params.kind as StructureKind
      if (!hospital || !(kind in STRUCTURE_DEFAULTS)) return fail(404)
      const list = hospital[kind] as { id: number; bedCount?: number }[]
      const index = list.findIndex((item) => item.id === Number(params.item))
      if (index < 0) return fail(404)
      if (list[index].bedCount) return fail(409, { detail: 'This ward still has beds. Move or remove them first.' })
      list.splice(index, 1)
      return { status: 204 }
    }),
  })
  return { fetchMock, board, hospitals, users, cases }
}
