import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { getCase, MAX_NOTE, postCaseAction, SEVERITIES, type CaseAction, type EmergencyCaseDetail, type StatusChange } from '../../api/emergencies'
import { FormAlert } from '../../components/form/FormAlert'
import { TextField } from '../../components/form/TextField'
import { Panel } from '../../components/ui/Panel'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { ACTION_LABEL, describeMove, describeNeed, SEVERITY_TONE, STATUS_LABEL } from '../../features/emergencies/emergencies'
import styles from '../../features/emergencies/Emergencies.module.css'
import { canEdit } from '../../features/staff/roles'
import { useStaff } from '../../features/staff/staffContext'
import { formatClock, formatShortDate } from '../../lib/time'
import { useLoad } from '../../lib/useLoad'
import { StaffDataState } from './StaffDataState'
import pageStyles from './StaffPages.module.css'

/** One emergency case: its details, the moves its status allows, and its timeline (story #34). */
export default function EmergencyCasePage() {
  const { reference = '' } = useParams()
  return <CaseView key={reference} reference={reference} />
}

function CaseView({ reference }: { reference: string }) {
  const { role } = useStaff()
  const load = useCallback(() => getCase(reference), [reference])
  const { result, setData } = useLoad(load)

  if (result.state === 'failed' && result.status === 404) {
    return (
      <div className={pageStyles.stack}>
        <p role="status">No emergency case with that id.</p>
        <Link to="/staff/emergencies" className={styles.back}>
          ← All emergency cases
        </Link>
      </div>
    )
  }
  if (result.state !== 'ready') return <StaffDataState failed={result.state === 'failed'} />

  const kase = result.data
  const opened = new Date(kase.createdAt)
  const severity = SEVERITIES.find((s) => s.id === kase.severity)?.label

  return (
    <div className={pageStyles.stack}>
      <Link to="/staff/emergencies" className={styles.back}>
        ← All emergency cases
      </Link>
      <Panel title={kase.id} id="case" aside={<StatusBadge tone={SEVERITY_TONE[kase.severity]}>{severity}</StatusBadge>}>
        <dl className={styles.facts}>
          <dt>Status</dt>
          <dd>{STATUS_LABEL[kase.status]}</dd>
          <dt>Opened</dt>
          <dd>
            <time dateTime={kase.createdAt}>
              {formatShortDate(opened)}, {formatClock(opened)}
            </time>
            {kase.createdBy && ` by ${kase.createdBy}`}
          </dd>
          {kase.patientRef && (
            <>
              <dt>Patient ref</dt>
              <dd>{kase.patientRef}</dd>
            </>
          )}
          <dt>Needed</dt>
          <dd>
            <ul className={styles.needs}>
              {kase.items.map((need, i) => (
                <li key={i}>{describeNeed(need)}</li>
              ))}
            </ul>
          </dd>
        </dl>
      </Panel>

      {canEdit(role, 'emergencies') && <CaseMoves kase={kase} onMoved={(updated) => setData(() => updated)} />}
      <Timeline history={kase.history} />
    </div>
  )
}

/** The moves the server says are valid from the current status, each with an optional note. */
function CaseMoves({ kase, onMoved }: { kase: EmergencyCaseDetail; onMoved: (updated: EmergencyCaseDetail) => void }) {
  const [note, setNote] = useState('')
  const [pending, setPending] = useState<CaseAction>()
  const [error, setError] = useState<string>()
  const [announcement, setAnnouncement] = useState('')

  async function move(action: CaseAction) {
    if (note.trim().length > MAX_NOTE) {
      setError(`The note is too long: use at most ${MAX_NOTE} characters.`)
      return
    }
    setError(undefined)
    setAnnouncement('')
    setPending(action)
    try {
      const updated = await postCaseAction(kase.id, action, note.trim())
      setNote('')
      onMoved(updated)
      setAnnouncement(`${updated.id} is now ${STATUS_LABEL[updated.status].toLowerCase()}.`)
    } catch (failure) {
      setError(moveFailure(failure))
    } finally {
      setPending(undefined)
    }
  }

  return (
    <Panel title="Update status" id="moves">
      <FormAlert>{error}</FormAlert>
      <p role="status" className="visually-hidden">
        {announcement}
      </p>
      {kase.actions.length === 0 ? (
        <p>No moves from {STATUS_LABEL[kase.status].toLowerCase()}.</p>
      ) : (
        <>
          <TextField
            id="move-note"
            label="Note"
            optional
            hint={`Why the status is changing, up to ${MAX_NOTE} characters.`}
            value={note}
            onChange={setNote}
          />
          <div className={styles.moves}>
            {kase.actions.map((action) => (
              <button
                key={action}
                type="button"
                className={styles.secondaryAction}
                disabled={pending !== undefined}
                aria-busy={pending === action}
                onClick={() => move(action)}
              >
                {pending === action ? 'Saving…' : ACTION_LABEL[action]}
              </button>
            ))}
          </div>
        </>
      )}
    </Panel>
  )
}

/** Why a move didn't happen. A 409 says why in the server's words; anything else is a plain failure. */
function moveFailure(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    const detail = typeof error.body === 'object' && error.body !== null ? (error.body as { detail?: unknown }).detail : undefined
    return typeof detail === 'string' ? detail : 'That move isn’t allowed from the case’s current status. Reload to see it.'
  }
  if (error instanceof ApiError && error.status !== 0 && error.status < 500) return 'The case wasn’t changed. Check the note and try again.'
  return 'The hospital’s system didn’t respond, so the case wasn’t changed. Try again.'
}

/** Every move, oldest first, in the order the server sends. */
function Timeline({ history }: { history: StatusChange[] }) {
  return (
    <Panel title="Status history" id="history">
      {history.length === 0 ? (
        <p>No history yet.</p>
      ) : (
        <ol className={styles.timeline}>
          {history.map((change, i) => {
            const at = new Date(change.at)
            return (
              <li key={i}>
                <strong>{describeMove(change)}</strong>
                <span className={styles.hint}>
                  <time dateTime={change.at}>
                    {formatShortDate(at)}, {formatClock(at)}
                  </time>
                  {' · '}
                  {change.actor ?? 'A former staff member'}
                </span>
                {change.note && <p className={styles.entryNote}>{change.note}</p>}
              </li>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}
