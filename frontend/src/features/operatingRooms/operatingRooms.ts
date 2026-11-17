import type { OperatingRoom, OperatingRoomAction, OrStatus } from '../../api/operatingRooms'

type Transition = { action: OperatingRoomAction; label: string; next: OrStatus }

/** The operating room lifecycle. Same moves as OR_LIFECYCLE in backend/apps/operating_rooms/models.py. */
const TRANSITIONS: Record<OrStatus, readonly Transition[]> = {
  available: [
    { action: 'startCase', label: 'Start case', next: 'inUse' },
    { action: 'startMaintenance', label: 'Start maintenance', next: 'maintenance' },
    { action: 'outOfService', label: 'Take out of service', next: 'outOfService' },
  ],
  inUse: [{ action: 'finishCase', label: 'Finish case', next: 'cleaning' }],
  cleaning: [
    { action: 'finishCleaning', label: 'Finish cleaning', next: 'available' },
    { action: 'startMaintenance', label: 'Start maintenance', next: 'maintenance' },
  ],
  maintenance: [
    { action: 'finishMaintenance', label: 'Finish maintenance', next: 'available' },
    { action: 'outOfService', label: 'Take out of service', next: 'outOfService' },
  ],
  outOfService: [{ action: 'returnToService', label: 'Return to service', next: 'maintenance' }],
}

export function actionsFor(status: OrStatus): readonly Transition[] {
  return TRANSITIONS[status]
}

/** The room after `action`. Throws, like the server's 409, when the move isn't allowed. */
export function applyOperatingRoomAction(room: OperatingRoom, action: OperatingRoomAction, now: Date): OperatingRoom {
  const transition = TRANSITIONS[room.status].find((t) => t.action === action)
  if (!transition) throw new Error(`Can't ${action} a operating room that is ${room.status}`)
  return { ...room, status: transition.next, statusSince: now.toISOString() }
}
