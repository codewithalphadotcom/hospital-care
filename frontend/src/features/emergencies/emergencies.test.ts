import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api/client'
import {
  describeNeed,
  emptyCase,
  newNeed,
  serverErrors,
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
    expect(validateCaseStep({ ...emptyCase(), severity: 'routine' })).toEqual({})
    expect(validateCaseStep({ ...emptyCase(), severity: 'routine', patientRef: 'x'.repeat(31) }).patientRef).toBe('Use at most 30 characters')
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
