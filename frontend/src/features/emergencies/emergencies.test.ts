import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api/client'
import {
  actionsFor,
  describeMove,
  describeNeed,
  emptyCase,
  newNeed,
  nextStatus,
  serverErrors,
  shortfallSummary,
  stepWithErrors,
  toCaseInput,
  validateCaseStep,
  validateNeedsStep,
  type CaseFormValues,
} from './emergencies'

const withNeeds = (...quantities: string[]): CaseFormValues => ({
  ...emptyCase(),
  severity: 'critical',
  needs: quantities.map((quantity, i) => ({ ...newNeed(i + 1), quantity })),
})

describe('emergency case form rules (#30, #32)', () => {
  it('describes needs the way staff say them', () => {
    expect(describeNeed({ type: 'blood', group: 'O-', component: 'redCells', quantity: 4 })).toBe('4 × O− red cells')
    expect(describeNeed({ type: 'bed', bedType: 'icu', quantity: 1 })).toBe('1 × ICU bed')
    expect(describeNeed({ type: 'bed', bedType: 'general', quantity: 2 })).toBe('2 × General beds')
  })

  it('needs a severity but no patient data on step 1', () => {
    expect(validateCaseStep(emptyCase())).toEqual({ severity: 'Choose how severe the case is' })
    expect(validateCaseStep({ ...emptyCase(), severity: 'moderate' })).toEqual({})
    expect(validateCaseStep({ ...emptyCase(), severity: 'moderate', patientRef: 'x'.repeat(31) }).patientRef).toBe('Use at most 30 characters')
  })

  it('checks every quantity against its type’s limit on step 2', () => {
    expect(validateNeedsStep(withNeeds('4'))).toEqual({})
    expect(validateNeedsStep(withNeeds('0', '2.5', ''))).toEqual({
      'quantity-1': 'Enter a whole number of 1 or more',
      'quantity-2': 'Enter a whole number of 1 or more',
      'quantity-3': 'Enter a whole number of 1 or more',
    })
    expect(validateNeedsStep(withNeeds('21'))['quantity-1']).toBe('At most 20 per line; add another line for more')
    const beds = withNeeds('6')
    beds.needs[0].type = 'bed'
    expect(validateNeedsStep(beds)['quantity-1']).toBe('At most 5 per line; add another line for more')
  })

  it('needs one to ten needs', () => {
    expect(validateNeedsStep({ ...withNeeds(), needs: [] }).needs).toBe('Add at least one thing the case needs')
    expect(validateNeedsStep(withNeeds(...Array(11).fill('1'))).needs).toBe('List at most 10 needs')
  })

  it('sends only the fields each type of need uses', () => {
    const values = withNeeds('4', '1')
    values.needs[1].type = 'bed'
    values.patientRef = '  Bay 4  '
    expect(toCaseInput(values)).toEqual({
      severity: 'critical',
      patientRef: 'Bay 4',
      items: [
        { type: 'blood', group: 'O-', component: 'redCells', quantity: 4 },
        { type: 'bed', bedType: 'icu', quantity: 1 },
      ],
    })
  })

  it('maps the server’s errors back to the right step and row', () => {
    const needs = withNeeds('4', '9').needs
    const onRow = serverErrors(new ApiError(400, { items: { '1': { quantity: ['Too many.'] } } }), needs)
    expect(onRow['quantity-2']).toBe('Too many.')
    expect(stepWithErrors(onRow)).toBe(1)
    const onCase = serverErrors(new ApiError(400, { severity: ['Not a valid choice.'] }), needs)
    expect(stepWithErrors(onCase)).toBe(0)
    expect(serverErrors(new ApiError(400, { items: ['This list may not be empty.'] }), needs).needs).toBe('This list may not be empty.')
    expect(stepWithErrors(serverErrors(new ApiError(500), needs))).toBeNull()
  })
})

describe('equipment and operating-room needs (#32, completed in #38)', () => {
  const asType = (values: CaseFormValues, index: number, change: Partial<CaseFormValues['needs'][number]>) => {
    values.needs[index] = { ...values.needs[index]!, ...change }
    return values
  }

  it('describes them the way staff say them', () => {
    expect(describeNeed({ type: 'equipment', equipmentType: 'ventilator', quantity: 2 })).toBe('2 × Ventilator')
    expect(describeNeed({ type: 'equipment', equipmentType: 'dialysis', quantity: 1 })).toBe('1 × Dialysis machine')
    expect(describeNeed({ type: 'operatingRoom', capability: 'cardiac', quantity: 1 })).toBe('1 × Operating room (cardiac)')
  })

  it('limits equipment to 5 per line and operating rooms to 3', () => {
    expect(validateNeedsStep(asType(withNeeds('6'), 0, { type: 'equipment', equipmentType: 'monitor' }))['quantity-1']).toBe(
      'At most 5 per line; add another line for more',
    )
    expect(validateNeedsStep(asType(withNeeds('4'), 0, { type: 'operatingRoom', capability: 'neuro' }))['quantity-1']).toBe(
      'At most 3 per line; add another line for more',
    )
    expect(validateNeedsStep(asType(withNeeds('3'), 0, { type: 'operatingRoom', capability: 'neuro' }))).toEqual({})
  })

  it('sends only the field of each need’s own type', () => {
    const values = asType(withNeeds('2', '1', '1'), 0, { type: 'equipment', equipmentType: 'dialysis' })
    asType(values, 1, { type: 'operatingRoom', capability: 'trauma' })
    expect(toCaseInput(values).items).toEqual([
      { type: 'equipment', equipmentType: 'dialysis', quantity: 2 },
      { type: 'operatingRoom', capability: 'trauma', quantity: 1 },
      { type: 'blood', group: 'O-', component: 'redCells', quantity: 1 },
    ])
  })

  it('puts the server’s error on the field it belongs to, in its row', () => {
    const needs = asType(withNeeds('2'), 0, { type: 'operatingRoom' }).needs
    const errors = serverErrors(new ApiError(400, { items: { '0': { capability: ['This field is required.'] } } }), needs)

    expect(errors['capability-1']).toBe('This field is required.')
    expect(errors['quantity-1']).toBeUndefined()
    expect(stepWithErrors(errors)).toBe(1)
  })
})

describe('case lifecycle mirror (#34)', () => {
  it('offers the moves each status allows, and none once a case is closed or cancelled', () => {
    expect(actionsFor('open')).toEqual(['startMatching', 'escalate', 'cancel'])
    expect(actionsFor('escalated')).toEqual(['resumeMatching', 'close'])
    expect(actionsFor('closed')).toEqual([])
    expect(actionsFor('cancelled')).toEqual([])
  })

  it('refuses the moves the lifecycle does not allow', () => {
    expect(nextStatus('open', 'close')).toBeUndefined()
    expect(nextStatus('matching', 'fulfil')).toBe('fulfilled')
    expect(nextStatus('cancelled', 'startMatching')).toBeUndefined()
  })

  it('describes the opening entry as the case being opened', () => {
    const opening = { fromStatus: '', toStatus: 'open', action: 'create', note: '', actor: null, at: '' } as const
    expect(describeMove(opening)).toBe('Case opened')
    expect(describeMove({ ...opening, fromStatus: 'matching', toStatus: 'fulfilled', action: 'fulfil' })).toBe('Matching → Fulfilled')
  })
})

describe('local availability summary (#33)', () => {
  it('says everything is available when nothing is short, and counts what is short otherwise', () => {
    expect(shortfallSummary(0)).toBe('Everything is available here')
    expect(shortfallSummary(1)).toBe('1 unit or bed needed from other hospitals')
    expect(shortfallSummary(4)).toBe('4 units/beds needed from other hospitals')
  })
})
