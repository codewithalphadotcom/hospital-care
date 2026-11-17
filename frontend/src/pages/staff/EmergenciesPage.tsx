import { useEffect, useRef, useState } from 'react'
import { getCases, SEVERITIES, STATUS_LABEL, type EmergencyCase, type Severity } from '../../api/emergencies'
import type { Tone } from '../../components/ui/StatusBadge'
import { Panel } from '../../components/ui/Panel'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { describeNeed } from '../../features/emergencies/emergencies'
import styles from '../../features/emergencies/Emergencies.module.css'
import { NewCaseForm } from '../../features/emergencies/NewCaseForm'
import { canEdit } from '../../features/staff/roles'
import { useStaff } from '../../features/staff/staffContext'
import { formatClock, formatShortDate } from '../../lib/time'
import { useLoad } from '../../lib/useLoad'
import { StaffDataState } from './StaffDataState'
import pageStyles from './StaffPages.module.css'

const SEVERITY_TONE: Record<Severity, Tone> = { critical: 'critical', urgent: 'warning', routine: 'neutral' }

/** Emergency cases at the user's hospital, and opening a new one (stories #30, #32). */
export default function EmergenciesPage() {
  const { role } = useStaff()
  const { result, setData } = useLoad(getCases)
  const [creating, setCreating] = useState(false)
  const [opened, setOpened] = useState<string>()
  const newCase = useRef<HTMLButtonElement>(null)
  const wasCreating = useRef(false)

  // When the form closes (opened or cancelled), put focus back on the button that opened it.
  useEffect(() => {
    if (wasCreating.current && !creating) newCase.current?.focus()
    wasCreating.current = creating
  }, [creating])

  if (result.state !== 'ready') return <StaffDataState failed={result.state === 'failed'} />

  const editable = canEdit(role, 'emergencies')

  function handleCreated(created: EmergencyCase) {
    setData((cases) => [created, ...cases])
    setCreating(false)
    setOpened(created.id)
  }

  return (
    <div className={pageStyles.stack}>
      {creating && <NewCaseForm onCreated={handleCreated} onClose={() => setCreating(false)} />}
      <Panel
        title="Emergency cases"
        aside={
          editable &&
          !creating && (
            <button
              ref={newCase}
              type="button"
              className={styles.secondaryAction}
              onClick={() => {
                setOpened(undefined)
                setCreating(true)
              }}
            >
              New case
            </button>
          )
        }
      >
        <p role="status">{opened && `Case ${opened} is open.`}</p>
        {result.data.length === 0 ? (
          <p>No emergency cases yet.{editable && ' Open one with “New case”.'}</p>
        ) : (
          <div className="table-scroll">
            <table className={styles.table}>
              <caption className="visually-hidden">Emergency cases, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Case</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Needs</th>
                  <th scope="col">Status</th>
                  <th scope="col">Opened</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((c) => (
                  <CaseRow key={c.id} item={c} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

function CaseRow({ item }: { item: EmergencyCase }) {
  const opened = new Date(item.createdAt)
  return (
    <tr>
      <td>
        <span className={styles.reference}>{item.id}</span>
        {item.patientRef && <div className={styles.hint}>{item.patientRef}</div>}
      </td>
      <td>
        <StatusBadge tone={SEVERITY_TONE[item.severity]}>{SEVERITIES.find((s) => s.id === item.severity)?.label}</StatusBadge>
      </td>
      <td>{item.items.map(describeNeed).join(', ')}</td>
      <td>{STATUS_LABEL[item.status]}</td>
      <td>
        <time dateTime={item.createdAt}>
          {formatShortDate(opened)}, {formatClock(opened)}
        </time>
        <div className={styles.hint}>{item.createdBy}</div>
      </td>
    </tr>
  )
}
