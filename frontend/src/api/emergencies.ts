import type { BedType } from './beds'
import type { BloodGroup, Component } from './blood'
import { apiGet, apiPost } from './client'

/** Most severe first. Lists come from the server in this order: severity, then the oldest case first (story #31). */
export type Severity = 'critical' | 'high' | 'moderate' | 'low'
export type CaseStatus = 'open' | 'matching' | 'partiallyFulfilled' | 'fulfilled' | 'escalated' | 'closed' | 'cancelled'

export type BloodNeed = { type: 'blood'; group: BloodGroup; component: Component; quantity: number }
export type BedNeed = { type: 'bed'; bedType: BedType; quantity: number }
export type Need = BloodNeed | BedNeed

/** An emergency case (stories #30, #32). Shape of `CaseSerializer` in backend/apps/emergencies/serializers.py. */
export interface EmergencyCase {
  /** e.g. "EC-2026-0001" */
  id: string
  severity: Severity
  status: CaseStatus
  /** Optional bed or triage tag. Never a name. */
  patientRef: string
  hospital: { id: number; name: string } | null
  createdBy: string
  createdAt: string
  items: Need[]
}

export interface CaseInput {
  severity: Severity
  patientRef: string
  items: Need[]
}

export const SEVERITIES: readonly { id: Severity; label: string; hint: string }[] = [
  { id: 'critical', label: 'Critical', hint: 'Life-threatening: needed within the hour' },
  { id: 'high', label: 'High', hint: 'Serious: needed within a few hours' },
  { id: 'moderate', label: 'Moderate', hint: 'Needed today; can be planned' },
  { id: 'low', label: 'Low', hint: 'Can wait; handled after the rest' },
]

export const STATUS_LABEL: Record<CaseStatus, string> = {
  open: 'Open',
  matching: 'Matching',
  partiallyFulfilled: 'Partially fulfilled',
  fulfilled: 'Fulfilled',
  escalated: 'Escalated',
  closed: 'Closed',
  cancelled: 'Cancelled',
}

/** Same limits as the API. */
export const MAX_NEEDS = 10
export const MAX_QUANTITY: Record<Need['type'], number> = { blood: 20, bed: 5 }
export const MAX_PATIENT_REF = 30

/** Cases at the user's hospital, most severe first, then oldest first. GET /api/emergencies/ (emergencies: view). */
export function getCases(): Promise<EmergencyCase[]> {
  return apiGet<EmergencyCase[]>('/emergencies/')
}

/** Open a case. POST /api/emergencies/ (emergencies: edit). */
export function createCase(input: CaseInput): Promise<EmergencyCase> {
  return apiPost<EmergencyCase>('/emergencies/', input)
}
