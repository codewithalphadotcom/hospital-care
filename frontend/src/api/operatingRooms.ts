import { apiGet, apiPost } from './client'

export type OrCapability = 'general' | 'cardiac' | 'trauma' | 'neuro' | 'orthopedic' | 'obstetric' | 'pediatric'
export type OrStatus = 'available' | 'inUse' | 'cleaning' | 'maintenance' | 'outOfService'

export const OR_CAPABILITIES: readonly { value: OrCapability; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'cardiac', label: 'Cardiac' },
  { value: 'trauma', label: 'Trauma' },
  { value: 'neuro', label: 'Neuro' },
  { value: 'orthopedic', label: 'Orthopedic' },
  { value: 'obstetric', label: 'Obstetric' },
  { value: 'pediatric', label: 'Pediatric' },
]

export const OR_STATUSES: readonly { value: OrStatus; label: string }[] = [
  { value: 'available', label: 'Available' },
  { value: 'inUse', label: 'In use' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'outOfService', label: 'Out of service' },
]

/** One operating room and what it is equipped for (story #28). */
export interface OperatingRoom {
  id: number
  name: string
  capabilities: OrCapability[]
  location: string
  status: OrStatus
  statusSince: string
  hospital: string | null
}

export type OperatingRoomInput = Pick<OperatingRoom, 'name' | 'capabilities' | 'location' | 'status'>

export type OperatingRoomFilters = { capability?: OrCapability; status?: OrStatus }

/** The rooms in the user's hospital, optionally filtered. GET /api/operating-rooms/ (operatingRooms: view). */
export function getOperatingRooms(filters: OperatingRoomFilters = {}): Promise<OperatingRoom[]> {
  const query = new URLSearchParams()
  if (filters.capability) query.set('capability', filters.capability)
  if (filters.status) query.set('status', filters.status)
  const search = query.toString()
  return apiGet<OperatingRoom[]>(`/operating-rooms/${search ? `?${search}` : ''}`)
}

/** Register a room. POST /api/operating-rooms/ (operatingRooms: edit). 400 with field errors, e.g. a taken name. */
export function createOperatingRoom(input: OperatingRoomInput): Promise<OperatingRoom> {
  return apiPost<OperatingRoom>('/operating-rooms/', input)
}

export type OperatingRoomAction =
  | 'startCase'
  | 'finishCase'
  | 'finishCleaning'
  | 'startMaintenance'
  | 'finishMaintenance'
  | 'outOfService'
  | 'returnToService'

/** Move a room along its lifecycle. POST /api/operating-rooms/<id>/actions/ (operatingRooms: edit). 409 if the move isn't allowed any more. */
export function postOperatingRoomAction(id: number, action: OperatingRoomAction): Promise<OperatingRoom> {
  return apiPost<OperatingRoom>(`/operating-rooms/${id}/actions/`, { action })
}
