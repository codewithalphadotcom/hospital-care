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

/** A move along the lifecycle (story #34). The names match REQUEST_LIFECYCLE in backend/apps/emergencies/models.py. */
export type CaseAction = 'startMatching' | 'partiallyFulfil' | 'fulfil' | 'escalate' | 'resumeMatching' | 'close' | 'cancel'

/** One entry in a case's timeline, oldest first. Shape of `StatusChangeSerializer`. */
export interface StatusChange {
  /** Empty for the first entry, when the case was opened. */
  fromStatus: CaseStatus | ''
  toStatus: CaseStatus
  action: CaseAction | 'create'
  note: string
  /** The user's name, or their email if they have no name. Null once the user has been removed. */
  actor: string | null
  at: string
}

/** What the case's own hospital has for one need (story #33). Only the detail carries it. */
export type NeedAvailability = { localAvailable: number; shortfall: number }
export type AvailableNeed = Need & NeedAvailability

/**
 * A case with its timeline, the moves valid from its current status, and what its hospital has for each need
 * (story #33). Shape of `CaseDetailSerializer`.
 */
export interface EmergencyCaseDetail extends EmergencyCase {
  items: AvailableNeed[]
  /** Units and beds still needed from other hospitals: the sum of the items' shortfalls. */
  shortfallTotal: number
  history: StatusChange[]
  actions: CaseAction[]
  /** The outcome note from the close (story #35): required to close, so set once the case is closed. Else null. */
  outcome: string | null
}

export const SEVERITIES: readonly { id: Severity; label: string; hint: string }[] = [
  { id: 'critical', label: 'Critical', hint: 'Life-threatening: needed within the hour' },
  { id: 'high', label: 'High', hint: 'Serious: needed within a few hours' },
  { id: 'moderate', label: 'Moderate', hint: 'Needed today; can be planned' },
  { id: 'low', label: 'Low', hint: 'Can wait; handled after the rest' },
]

/** Same limits as the API. */
export const MAX_NEEDS = 10
export const MAX_QUANTITY: Record<Need['type'], number> = { blood: 20, bed: 5 }
export const MAX_PATIENT_REF = 30
export const MAX_NOTE = 500

/** Cases at the user's hospital, most severe first, then oldest first. GET /api/emergencies/ (emergencies: view). */
export function getCases(): Promise<EmergencyCase[]> {
  return apiGet<EmergencyCase[]>('/emergencies/')
}

/** Open a case. POST /api/emergencies/ (emergencies: edit). */
export function createCase(input: CaseInput): Promise<EmergencyCase> {
  return apiPost<EmergencyCase>('/emergencies/', input)
}

/** One case with its timeline. GET /api/emergencies/<reference>/ (emergencies: view). Another hospital's is 404. */
export function getCase(reference: string): Promise<EmergencyCaseDetail> {
  return apiGet<EmergencyCaseDetail>(`/emergencies/${encodeURIComponent(reference)}/`)
}

/** Move a case. POST /api/emergencies/<reference>/actions/ (emergencies: edit). 409 if the move isn't allowed now. */
export function postCaseAction(reference: string, action: CaseAction, note: string): Promise<EmergencyCaseDetail> {
  return apiPost<EmergencyCaseDetail>(`/emergencies/${encodeURIComponent(reference)}/actions/`, { action, note })
}
