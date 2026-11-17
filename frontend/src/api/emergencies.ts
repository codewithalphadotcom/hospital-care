import type { BedType } from './beds'
import type { BloodGroup, Component } from './blood'
import { apiGet, apiPost } from './client'
import type { EquipmentType } from './equipment'
import type { OrCapability } from './operatingRooms'

/** Most severe first. Lists come from the server in this order: severity, then the oldest case first (story #31). */
export type Severity = 'critical' | 'high' | 'moderate' | 'low'
export type CaseStatus = 'open' | 'matching' | 'partiallyFulfilled' | 'fulfilled' | 'escalated' | 'closed' | 'cancelled'

export type BloodNeed = { type: 'blood'; group: BloodGroup; component: Component; quantity: number }
export type BedNeed = { type: 'bed'; bedType: BedType; quantity: number }
export type EquipmentNeed = { type: 'equipment'; equipmentType: EquipmentType; quantity: number }
export type OperatingRoomNeed = { type: 'operatingRoom'; capability: OrCapability; quantity: number }
export type Need = BloodNeed | BedNeed | EquipmentNeed | OperatingRoomNeed

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

/** One need in the network feed: what is asked for, and how much of it is already filled (story #36). */
export type FeedNeed = Need & { fulfilled: number }

/**
 * An active request in the network feed (story #36), from any hospital. Shape of `FeedEntry` in
 * backend/apps/emergencies/serializers.py. It carries no patient data, notes, timeline or author.
 */
export interface FeedEntry {
  reference: string
  hospital: { id: number; name: string } | null
  severity: Severity
  status: CaseStatus
  createdAt: string
  /** Only the needs of the type the feed was asked for. */
  needs: FeedNeed[]
}

export type FeedType = 'blood' | 'bed'

/** A hospital that can supply one requirement (story #38). Shape of `CandidateSerializer`. */
export interface Candidate {
  hospital: { id: number; name: string }
  /** Matchable at that hospital for this requirement. */
  available: number
  /** Whether `available` is at least the shortfall. */
  covers: boolean
  /** Straight-line distance, one decimal. Null when either side has no coordinates or the case has no hospital. */
  distanceKm: number | null
  /** Estimated travel time in whole minutes (#39). Null with `distanceKm`. */
  travelMinutes: number | null
  /** Blood only: the soonest expiry among the matching units. */
  earliestExpiry?: string
  /** Blood only: 0 is the identical group; higher is a compatible substitute. */
  bestDonorRank?: number
  /** 1-based position in the item's list (story #41). */
  rank: number
  score: Score
  /** True only on rank 1, and only when its score is above 0. */
  recommended: boolean
}

/** One factor of a score (story #41): how well the candidate does on it, and what that is worth. */
export interface ScoreFactor {
  name: 'distance' | 'expiry' | 'quantity' | 'compatibility'
  /** "Distance", "Expiry", "Stock" or "Blood group match". */
  label: string
  /** 0 to 1, two decimals. */
  value: number
  /** This factor's share of the strategy's weights, 0 to 1, two decimals. */
  weight: number
  /** One decimal, out of 100. The factors' points add up to the score's total. */
  points: number
  /** The reason in plain words: "4.2 km, about 6 min", "expires in 3 days", "identical group". */
  detail: string
}

/** How a candidate scored under its item's strategy (story #41). `total` is 0 to 100, one decimal. */
export interface Score {
  total: number
  /** The strategy's name, as in `CandidateItem.strategy.name`. */
  strategy: string
  factors: ScoreFactor[]
}

/** One short requirement and the hospitals that can supply it. Shape of `CandidateItemSerializer`. */
export interface CandidateItem {
  itemId: number
  /** A label such as "O- red cells", "ICU bed", "Ventilator" or "Cardiac operating room". */
  need: string
  shortfall: number
  /** How the candidates are ordered, for people to read: "Earliest expiry first", "Nearest first". */
  strategy: { name: string; label: string }
  /** Best first, as the server ranks them. The client keeps this order. */
  candidates: Candidate[]
}

/** The sources for a case (story #38). `items` holds only the short needs: empty when all are covered locally. */
export interface CandidatesResponse {
  reference: string
  items: CandidateItem[]
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
export const MAX_QUANTITY: Record<Need['type'], number> = { blood: 20, bed: 5, equipment: 5, operatingRoom: 3 }
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

/** The hospitals that can supply each short need of a case (story #38). GET /api/emergencies/<reference>/candidates/. */
export function getCandidates(reference: string): Promise<CandidatesResponse> {
  return apiGet<CandidatesResponse>(`/emergencies/${encodeURIComponent(reference)}/candidates/`)
}

/** One case with its timeline. GET /api/emergencies/<reference>/ (emergencies: view). Another hospital's is 404. */
export function getCase(reference: string): Promise<EmergencyCaseDetail> {
  return apiGet<EmergencyCaseDetail>(`/emergencies/${encodeURIComponent(reference)}/`)
}

/** Move a case. POST /api/emergencies/<reference>/actions/ (emergencies: edit). 409 if the move isn't allowed now. */
export function postCaseAction(reference: string, action: CaseAction, note: string): Promise<EmergencyCaseDetail> {
  return apiPost<EmergencyCaseDetail>(`/emergencies/${encodeURIComponent(reference)}/actions/`, { action, note })
}

/**
 * Active requests from every hospital, most urgent first, with their needs of one type. GET /api/emergencies/feed/
 * (emergencies: view, every staff role).
 */
export function getFeed(type: FeedType): Promise<FeedEntry[]> {
  return apiGet<FeedEntry[]>(`/emergencies/feed/?type=${type}`)
}
