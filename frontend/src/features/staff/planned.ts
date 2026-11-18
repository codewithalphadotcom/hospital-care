/**
 * MVP modules that have a route but no page yet (issue #5: route placeholders for every MVP module).
 * Each gets its real page, nav entry and access rule in the sprint shown; remove it from here then.
 */
export const PLANNED: readonly { path: string; label: string; sprint: number; issues: string }[] = [
  { path: '/staff/ambulances', label: 'Ambulances', sprint: 8, issues: '#50–#51' },
  { path: '/staff/alerts', label: 'Alerts', sprint: 8, issues: '#52–#53' },
  { path: '/staff/command-centre', label: 'City command centre', sprint: 8, issues: '#55' },
  { path: '/staff/audit', label: 'Audit log', sprint: 8, issues: '#56' },
]
