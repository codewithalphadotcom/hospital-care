import type { EmergencyCase } from '../../api/emergencies'

/**
 * What CityCare General has free for each sample case's needs, in item order (story #33). EC-2026-0002 is short
 * (1 of 4 O− red cells, no ICU bed: 4 needed elsewhere); EC-2026-0001 is covered (2 of 2 general beds).
 */
export const sampleLocalAvailable: Record<string, number[]> = {
  'EC-2026-0002': [1, 0],
  'EC-2026-0001': [2],
}

/** Two cases at CityCare General, in the order the server lists them. Fresh copies every call. */
export function sampleCases(now: Date): EmergencyCase[] {
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString()
  const hospital = { id: 1, name: 'CityCare General Hospital' }
  return [
    {
      id: 'EC-2026-0002',
      severity: 'critical',
      status: 'open',
      patientRef: 'Bay 4',
      hospital,
      createdBy: 'Dr. Ayesha Khan',
      createdAt: minutesAgo(12),
      items: [
        { type: 'blood', group: 'O-', component: 'redCells', quantity: 4 },
        { type: 'bed', bedType: 'icu', quantity: 1 },
      ],
    },
    {
      id: 'EC-2026-0001',
      severity: 'moderate',
      status: 'open',
      patientRef: '',
      hospital,
      createdBy: 'Hina Javed',
      createdAt: minutesAgo(180),
      items: [{ type: 'bed', bedType: 'general', quantity: 2 }],
    },
  ]
}
