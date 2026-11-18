/**
 * MVP modules that have a route but no page yet (issue #5: route placeholders for every MVP module).
 * Each gets its real page, nav entry and access rule in the sprint shown; remove it from here then.
 */
export const PLANNED: readonly { path: string; label: string; sprint: number; issues: string }[] = [
  // The donor API shipped in Sprint 3 (#20–#22); its page is bolt B11 (docs/aidlc/bolts/).
  { path: '/staff/donors', label: 'Donors', sprint: 8, issues: '#20–#22' },
]
