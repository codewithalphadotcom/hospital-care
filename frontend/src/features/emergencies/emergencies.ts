import type { BedType } from '../../api/beds'
import { BLOOD_GROUPS, COMPONENTS, type BloodGroup, type Component } from '../../api/blood'
import { ApiError } from '../../api/client'
import {
  MAX_NEEDS,
  MAX_PATIENT_REF,
  MAX_QUANTITY,
  type CaseAction,
  type CaseInput,
  type CaseStatus,
  type Need,
  type Severity,
  type StatusChange,
} from '../../api/emergencies'
import type { Tone } from '../../components/ui/StatusBadge'
import { TYPE_LABEL } from '../beds/beds'
import { COMPONENT_LABEL, formatGroup } from '../blood/blood'

/** "4 × O− red cells" or "1 × ICU bed". */
export function describeNeed(need: Need): string {
  if (need.type === 'blood') return `${need.quantity} × ${formatGroup(need.group)} ${COMPONENT_LABEL[need.component].toLowerCase()}`
  return `${need.quantity} × ${TYPE_LABEL[need.bedType]} bed${need.quantity === 1 ? '' : 's'}`
}

/** The case's summary of local availability (story #33). `total` is the server's `shortfallTotal`. */
export function shortfallSummary(total: number): string {
  if (total === 0) return 'Everything is available here'
  return total === 1 ? '1 unit or bed needed from other hospitals' : `${total} units/beds needed from other hospitals`
}

export const STATUS_LABEL: Record<CaseStatus, string> = {
  open: 'Open',
  matching: 'Matching',
  partiallyFulfilled: 'Partially fulfilled',
  fulfilled: 'Fulfilled',
  escalated: 'Escalated',
  closed: 'Closed',
  cancelled: 'Cancelled',
}

/** The button label for each move. */
export const ACTION_LABEL: Record<CaseAction, string> = {
  startMatching: 'Start matching',
  partiallyFulfil: 'Mark partially fulfilled',
  fulfil: 'Mark fulfilled',
  escalate: 'Escalate',
  resumeMatching: 'Resume matching',
  close: 'Close case',
  cancel: 'Cancel case',
}

export const SEVERITY_TONE: Record<Severity, Tone> = { critical: 'critical', high: 'warning', moderate: 'neutral', low: 'neutral' }

type Transition = { action: CaseAction; next: CaseStatus }

/**
 * The lifecycle, mirrored from REQUEST_LIFECYCLE in backend/apps/emergencies/models.py. The server decides which moves
 * are allowed; this copy lets the mock API and the page use the same moves. Closed and cancelled have none.
 */
const TRANSITIONS: Record<CaseStatus, readonly Transition[]> = {
  open: [
    { action: 'startMatching', next: 'matching' },
    { action: 'escalate', next: 'escalated' },
    { action: 'cancel', next: 'cancelled' },
  ],
  matching: [
    { action: 'partiallyFulfil', next: 'partiallyFulfilled' },
    { action: 'fulfil', next: 'fulfilled' },
    { action: 'escalate', next: 'escalated' },
    { action: 'cancel', next: 'cancelled' },
  ],
  partiallyFulfilled: [
    { action: 'fulfil', next: 'fulfilled' },
    { action: 'escalate', next: 'escalated' },
    { action: 'close', next: 'closed' },
  ],
  fulfilled: [{ action: 'close', next: 'closed' }],
  escalated: [
    { action: 'resumeMatching', next: 'matching' },
    { action: 'close', next: 'closed' },
  ],
  closed: [],
  cancelled: [],
}

/** The moves valid from `status`, in the order the lifecycle lists them. */
export function actionsFor(status: CaseStatus): CaseAction[] {
  return TRANSITIONS[status].map((t) => t.action)
}

/** The status after `action`, or undefined when the lifecycle refuses the move. */
export function nextStatus(status: CaseStatus, action: CaseAction): CaseStatus | undefined {
  return TRANSITIONS[status].find((t) => t.action === action)?.next
}

/** "Matching → Partially fulfilled", or "Case opened" for the first entry of a timeline. */
export function describeMove(change: StatusChange): string {
  return change.fromStatus ? `${STATUS_LABEL[change.fromStatus]} → ${STATUS_LABEL[change.toStatus]}` : 'Case opened'
}

/** One row of the "What's needed" step. `quantity` is the raw input text; `key` stays stable as rows come and go. */
export type NeedDraft = {
  key: number
  type: Need['type']
  group: BloodGroup
  component: Component
  bedType: BedType
  quantity: string
}

export type CaseFormValues = { severity: Severity | ''; patientRef: string; needs: NeedDraft[] }

/** Field errors: `severity`, `patientRef`, `needs` (the list as a whole) and `quantity-<key>` per row. */
export type CaseErrors = Record<string, string | undefined>

/** The three steps of the form (#30: at most 3). */
export const STEPS = ['Case', 'What’s needed', 'Review'] as const

export function newNeed(key: number): NeedDraft {
  return { key, type: 'blood', group: BLOOD_GROUPS[0], component: COMPONENTS[0].id, bedType: 'icu', quantity: '1' }
}

export function emptyCase(): CaseFormValues {
  return { severity: '', patientRef: '', needs: [newNeed(1)] }
}

/** Step 1: severity is required; the patient reference is optional and short. */
export function validateCaseStep(values: CaseFormValues): CaseErrors {
  const errors: CaseErrors = {}
  if (!values.severity) errors.severity = 'Choose how severe the case is'
  if (values.patientRef.trim().length > MAX_PATIENT_REF) errors.patientRef = `Use at most ${MAX_PATIENT_REF} characters`
  return errors
}

/** Step 2: one to MAX_NEEDS needs, each with a whole-number quantity within its type's limit. */
export function validateNeedsStep(values: CaseFormValues): CaseErrors {
  const errors: CaseErrors = {}
  if (values.needs.length === 0) errors.needs = 'Add at least one thing the case needs'
  else if (values.needs.length > MAX_NEEDS) errors.needs = `List at most ${MAX_NEEDS} needs`
  for (const need of values.needs) {
    const text = need.quantity.trim()
    const quantity = Number(text)
    const max = MAX_QUANTITY[need.type]
    if (!/^\d+$/.test(text) || quantity < 1) errors[`quantity-${need.key}`] = 'Enter a whole number of 1 or more'
    else if (quantity > max) errors[`quantity-${need.key}`] = `At most ${max} per line; add another line for more`
  }
  return errors
}

export function hasErrors(errors: CaseErrors): boolean {
  return Object.values(errors).some(Boolean)
}

export function toNeed(draft: NeedDraft): Need {
  const quantity = Number(draft.quantity.trim())
  return draft.type === 'blood'
    ? { type: 'blood', group: draft.group, component: draft.component, quantity }
    : { type: 'bed', bedType: draft.bedType, quantity }
}

export function toCaseInput(values: CaseFormValues): CaseInput {
  return { severity: values.severity as Severity, patientRef: values.patientRef.trim(), items: values.needs.map(toNeed) }
}

const first = (value: unknown): string | undefined => (Array.isArray(value) ? value.find((v) => typeof v === 'string') : undefined)

/**
 * A 400 from POST /emergencies/ as form errors. Errors on one need come back keyed by its position,
 * `{items: {"0": {quantity: ["…"]}}}`; errors on the list as a whole as `{items: ["…"]}`.
 */
export function serverErrors(error: unknown, needs: NeedDraft[]): CaseErrors {
  const body = error instanceof ApiError && typeof error.body === 'object' && error.body !== null ? (error.body as Record<string, unknown>) : {}
  const errors: CaseErrors = { severity: first(body.severity), patientRef: first(body.patientRef) }
  const items = body.items
  if (Array.isArray(items)) {
    errors.needs = first(items)
  } else if (typeof items === 'object' && items !== null) {
    for (const [index, fields] of Object.entries(items as Record<string, Record<string, unknown>>)) {
      const need = needs[Number(index)]
      const message = Object.values(fields ?? {}).map(first).find(Boolean)
      if (need && message) errors[`quantity-${need.key}`] = message
    }
  }
  return errors
}

/** Which step to send the user back to for these errors (0 or 1), or null if there are none. */
export function stepWithErrors(errors: CaseErrors): number | null {
  if (errors.severity || errors.patientRef) return 0
  return hasErrors(errors) ? 1 : null
}
