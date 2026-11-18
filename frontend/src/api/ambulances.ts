import { apiGet, apiPost } from './client'

export type AmbulanceType = 'basic' | 'advanced' | 'patientTransport'
export type AmbulanceStatus = 'available' | 'maintenance' | 'outOfService'

export const AMBULANCE_TYPES: readonly { value: AmbulanceType; label: string }[] = [
  { value: 'basic', label: 'Basic life support' },
  { value: 'advanced', label: 'Advanced life support' },
  { value: 'patientTransport', label: 'Patient transport' },
]

export const AMBULANCE_STATUSES: readonly { value: AmbulanceStatus; label: string }[] = [
  { value: 'available', label: 'Available' },
  { value: 'maintenance', label: 'In maintenance' },
  { value: 'outOfService', label: 'Out of service' },
]

/** One ambulance and its base hospital (story #50). */
export interface Ambulance {
  id: number
  identifier: string
  type: AmbulanceType
  status: AmbulanceStatus
  statusSince: string
  hospital: string | null
}

/** What the register form sends. Admins pick the base hospital; everyone else registers at their own. */
export interface AmbulanceInput {
  identifier: string
  type: AmbulanceType
  hospitalId?: number
}

/** The ambulances in the user's hospital (all of them for admins). GET /api/ambulances/ (ambulances: view). */
export function getAmbulances(): Promise<Ambulance[]> {
  return apiGet<Ambulance[]>('/ambulances/')
}

/** Register an ambulance. POST /api/ambulances/ (ambulances: edit). 400 with field errors, e.g. a taken asset tag. */
export function createAmbulance(input: AmbulanceInput): Promise<Ambulance> {
  return apiPost<Ambulance>('/ambulances/', input)
}

export type AmbulanceAction = 'startMaintenance' | 'finishMaintenance' | 'outOfService' | 'returnToService'

/** Move an ambulance along its lifecycle. POST /api/ambulances/<id>/actions/ (ambulances: edit). 409 if not allowed now. */
export function postAmbulanceAction(id: number, action: AmbulanceAction): Promise<Ambulance> {
  return apiPost<Ambulance>(`/ambulances/${id}/actions/`, { action })
}
