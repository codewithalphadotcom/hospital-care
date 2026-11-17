import type { CandidatesResponse, EmergencyCase, FeedEntry } from '../../api/emergencies'

/**
 * What CityCare General has free for each sample case's needs, in item order (story #33). EC-2026-0002 is short
 * (1 of 4 O− red cells, no ICU bed: 4 needed elsewhere); EC-2026-0001 is covered (2 of 2 general beds).
 */
export const sampleLocalAvailable: Record<string, number[]> = {
  'EC-2026-0002': [1, 0],
  'EC-2026-0001': [2],
  'EC-2026-0003': [1, 0],
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

/**
 * Active requests at another hospital, Riverside Medical Centre, as the network feed lists them (story #36). Their
 * ids are not CityCare's, so the feed shows them without a link.
 */
export function sampleNetworkRequests(now: Date): FeedEntry[] {
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString()
  const hospital = { id: 2, name: 'Riverside Medical Centre' }
  return [
    {
      reference: 'EC-2026-0007',
      hospital,
      severity: 'critical',
      status: 'matching',
      createdAt: minutesAgo(40),
      needs: [{ type: 'blood', group: 'O-', component: 'redCells', quantity: 6, fulfilled: 2 }],
    },
    {
      reference: 'EC-2026-0008',
      hospital,
      severity: 'high',
      status: 'escalated',
      createdAt: minutesAgo(200),
      needs: [
        { type: 'blood', group: 'AB+', component: 'platelets', quantity: 1, fulfilled: 0 },
        { type: 'bed', bedType: 'icu', quantity: 1, fulfilled: 0 },
      ],
    },
    {
      reference: 'EC-2026-0009',
      hospital,
      severity: 'moderate',
      status: 'open',
      createdAt: minutesAgo(15),
      needs: [{ type: 'bed', bedType: 'general', quantity: 2, fulfilled: 0 }],
    },
  ]
}

/**
 * A case with the newer kinds of need (#32, completed in #38): two ventilators, one of them here, and a cardiac
 * theatre, none here. Not in `sampleCases`, so the list tests keep their order; the case page tests use it directly.
 */
export function sampleNewNeedsCase(now: Date): EmergencyCase {
  return {
    id: 'EC-2026-0003',
    severity: 'high',
    status: 'open',
    patientRef: '',
    hospital: { id: 1, name: 'CityCare General Hospital' },
    createdBy: 'Dr. Usman Farooq',
    createdAt: new Date(now.getTime() - 30 * 60_000).toISOString(),
    items: [
      { type: 'equipment', equipmentType: 'ventilator', quantity: 2 },
      { type: 'operatingRoom', capability: 'cardiac', quantity: 1 },
    ],
  }
}

/**
 * The sources for the sample cases (story #38), as the server returns them: only the short needs. EC-2026-0002 is
 * short of blood and an ICU bed: one hospital has 5 O− red cells, which covers it, and one has 1, which doesn't. No
 * other hospital has an ICU bed. EC-2026-0003 is short of one ventilator and a cardiac theatre; one hospital has a
 * ventilator and nobody has a cardiac theatre free. EC-2026-0001 is covered locally, so it has no items.
 */
export function sampleCandidates(now: Date): Record<string, CandidatesResponse> {
  const expiresIn = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString()
  const riverside = { id: 2, name: 'Riverside Medical Centre' }
  const northside = { id: 3, name: "Northside Children's Hospital" }
  return {
    'EC-2026-0002': {
      reference: 'EC-2026-0002',
      items: [
        {
          itemId: 1,
          need: 'O- red cells',
          shortfall: 3,
          candidates: [
            { hospital: riverside, available: 5, covers: true, distanceKm: 4.2, travelMinutes: 6, earliestExpiry: expiresIn(9), bestDonorRank: 0 },
            { hospital: northside, available: 1, covers: false, distanceKm: null, travelMinutes: null, earliestExpiry: expiresIn(3), bestDonorRank: 0 },
          ],
        },
        { itemId: 2, need: 'ICU bed', shortfall: 1, candidates: [] },
      ],
    },
    'EC-2026-0003': {
      reference: 'EC-2026-0003',
      items: [
        {
          itemId: 3,
          need: 'Ventilator',
          shortfall: 1,
          candidates: [{ hospital: riverside, available: 2, covers: true, distanceKm: 4.2, travelMinutes: 6 }],
        },
        { itemId: 4, need: 'Cardiac operating room', shortfall: 1, candidates: [] },
      ],
    },
    'EC-2026-0001': { reference: 'EC-2026-0001', items: [] },
  }
}
