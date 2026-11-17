# Backend API (Sprint 1)

Sprint 2 endpoints (users, hospitals, structure) are in [api-contracts.md](api-contracts.md).

Base URL: `http://localhost:8000/api` locally. All bodies are JSON. Field names match the TypeScript types in
`frontend/src/api/`, so each frontend `get…()` function can switch from sample data to the real call unchanged.

## Auth (session cookie + CSRF)

The browser keeps a Django session cookie. Every request must use `credentials: 'include'` (the shared client
already does). Signed-in `POST`s must send the `X-CSRFToken` header from the `csrftoken` cookie (the client
already does); the cookie is set by `login`, `signup`, `me` and `csrf`.

| Method | Path | Who | Body | Success | Errors |
|---|---|---|---|---|---|
| GET | `/auth/csrf/` | anyone | – | 200, sets `csrftoken` cookie | – |
| POST | `/auth/login/` | anyone | `{email, password}` | 200 `User` | 400 bad input (email > 254 or password > 512 characters), 401 wrong email/password (same message for both), 429 after 5 failed attempts on the account (locked 15 min) |
| POST | `/auth/logout/` | anyone | – | 204 | 403 if CSRF header missing |
| POST | `/auth/signup/` | anyone | `{full_name, email, phone?, password}` | 201 `User` (always a patient) | 400 `{email: [...]}` taken, 400 `{password: [...]}` weak |
| GET | `/auth/me/` | signed in | – | 200 `User` | 403 when signed out |

`User` = `{id, email, fullName, phone, role, isStaff}`; `role` is one of `admin`, `doctor`, `nurse`,
`bloodBank`, `pharmacist`, `patient` (same ids as `features/staff/roles.ts`). Staff accounts are created in
Django admin, never through sign-up.

## Modules

Access follows `ACCESS` in `features/staff/roles.ts` (enforced in `apps/accounts/permissions.py`):
reading needs *view*, changing needs *edit*. No access → 403.

| Method | Path | Returns | Access |
|---|---|---|---|
| GET | `/public/status/` | `PublicStatus` (ER status + today's doctors) | anyone, no sign-in |
| GET | `/beds/` | `BedBoard` = `{wards, beds}` | beds: view |
| POST | `/beds/<bed id>/actions/` | `{action}` → updated `Bed` | beds: edit |
| GET | `/blood/units/` | `BloodUnit[]` | blood: view |
| GET | `/pharmacy/stock/` | `Medicine[]` with `batches` | pharmacy: view |

Bed actions: `discharge`, `markReady`, `reserve`, `cancelReservation`, `outOfService`, `returnToService`.
A move the bed lifecycle doesn't allow (e.g. reserving an occupied bed) returns **409** and changes nothing.
Unknown action → 400, unknown bed → 404. Discharging clears the patient details.

A blood unit past its expiry date is reported as `expired` (unless already `issued`), even if nobody has
updated its stored status yet.

## Blood bank (Sprint 3)

Every endpoint needs **blood: view** to read and **blood: edit** to change (admin, bloodBank). Staff only see and
change their own hospital's units, donors and appointments (**403** otherwise). Every change is audit-logged.

| Method | Path | Body | Success | Story |
|---|---|---|---|---|
| GET | `/blood/units/?status=&group=&component=` | – | `BloodUnit[]`; `status=available` never returns expired units | #18 |
| POST | `/blood/units/` | `{id, group, component, collectedAt, expiresAt?, location, donorId?}` | 201 `BloodUnit` | #17, #20 |
| GET | `/blood/units/<id>/` | – | `BloodUnitDetail` | #18 |
| POST | `/blood/units/<id>/tests/` | `{test, passed, reason?}` | 201 `BloodUnitDetail` | #18 |
| POST | `/blood/units/<id>/actions/` | `{action, reason?}` | 200 `BloodUnitDetail` | #18 |
| GET | `/blood/stock/?nearExpiryDays=3` | – | `BloodStock` | #19 |
| GET | `/blood/donors/?q=&bloodGroup=` | – | `Donor[]` (search by name, code or phone) | #20 |
| POST | `/blood/donors/` | `{fullName, bloodGroup, phone?, email?}` | 201 `Donor` (code `DNR-00001`, …) | #20 |
| GET | `/blood/donors/<id>/` | – | `Donor` + `units: BloodUnit[]` | #20 |
| POST | `/blood/donors/<id>/screening/` | `{eligible, reason?, deferredUntil?}` | 200 `Donor` | #21 |
| GET | `/blood/appointments/` (`?all=true` for past and cancelled) | – | `Appointment[]`, upcoming booked | #22 |
| POST | `/blood/appointments/` | `{donorId, startsAt}` | 201 `Appointment` | #22 |
| POST | `/blood/appointments/<id>/cancel/` | – | 200 `Appointment` | #22 |

```ts
BloodUnitDetail = BloodUnit & {
  donorId: string | null,
  tests: { test: Test, passed: boolean, reason: string, recordedAt: string }[],
  missingTests: Test[]          // tests still needed before release
}
Test = 'hiv' | 'hbv' | 'hcv' | 'syphilis' | 'malaria'
BloodStock = {
  nearExpiryDays: number, lowStockUnits: number,
  rows: { group, component, available, reserved, quarantined, nearExpiry: number, low: boolean }[],  // 8 groups × 4 components
  nearExpiryUnits: BloodUnit[]  // available units expiring within nearExpiryDays, soonest first
}
Donor = {
  id: string, fullName: string, bloodGroup: string, phone: string, email: string,
  lastDonationAt: string | null,
  eligible: boolean, ineligibleReason: string, eligibleFrom: string | null  // null + ineligible = permanent
}
Appointment = { id: number, donorId: string, donorName: string, startsAt: string, slotMinutes: number,
                status: 'booked' | 'cancelled' }
```

**Rules**

- **Screening (#18):** new units are `quarantined`. Each test is recorded once (repeat → 400). When all five have
  passed, the unit moves to `available` by itself. A failed test needs a `reason` and moves the unit to
  `discarded`. Tests on a unit that isn't quarantined → 409.
- **Unit actions:** `reserve`, `cancelReservation`, `issue`, `expire`, `release` (409 unless every test passed),
  `discard` (400 without a reason). A move the lifecycle doesn't allow → 409.
- **Expiry (#19):** units past their expiry date are marked `expired` (audit-logged, actor "system") by
  `python manage.py expire_blood_units` (schedule it hourly) and every time the stock view loads.
- **Stock (#19):** only `available` units count. `low` is true below `BLOOD_LOW_STOCK_UNITS` (default 5).
  `nearExpiryDays` defaults to `BLOOD_NEAR_EXPIRY_DAYS` (3); 0–60, otherwise 400.
- **Donors (#20):** synthetic identities only. A unit's group must match its donor's group (400 on `donorId`).
- **Eligibility (#21):** a donor can't give again within `BLOOD_MIN_DONATION_INTERVAL_DAYS` (56). Units collected
  the same day count as one donation (components). Screening `{eligible: false}` needs a reason; no
  `deferredUntil` means a permanent deferral. `{eligible: true}` clears it.
- **Appointments (#22):** on a `BLOOD_APPOINTMENT_SLOT_MINUTES` (30) boundary, in the future. One booked donor
  per hospital per slot (the database enforces it, so two people booking at once can't both win → 400).
  Ineligible donors and donors who already have an upcoming appointment → 400. A cancelled slot can be rebooked.

All four `BLOOD_*` settings can be changed with environment variables of the same name.

## Emergency cases (#30, #32)

Module `emergencies`: admin, doctor and nurse can open cases and move them; blood bank and pharmacist can view them.
Users at a hospital see only its cases (another hospital's case → **404**); staff with no hospital see every case.

| Method | Path | Body | Success | Story |
|---|---|---|---|---|
| GET | `/emergencies/` | – | `EmergencyCase[]`, most severe first, then oldest first. Escalates overdue cases first (#35) | #30, #31, #35 |
| POST | `/emergencies/` | `{severity, patientRef?, items}` | 201 `EmergencyCase` | #30, #31, #32 |
| GET | `/emergencies/<id>/` | – | `EmergencyCaseDetail`: the case with its `history`, `actions`, `outcome` and local availability. Escalates overdue cases first (#35) | #30, #33, #34, #35 |
| POST | `/emergencies/<id>/actions/` | `{action, note?}` | 200 `EmergencyCaseDetail`, after the move (see [Status](#status-and-its-timeline-34)) | #34 |

```ts
EmergencyCase = {
  id: string,                   // "EC-2026-0001": sequential per year
  severity: 'critical' | 'high' | 'moderate' | 'low',  // most severe first
  status: 'open' | 'matching' | 'partiallyFulfilled' | 'fulfilled' | 'escalated' | 'closed' | 'cancelled',
  patientRef: string,           // optional bed/triage tag, ≤ 30 chars; never a name
  hospital: { id: number, name: string } | null,
  createdBy: string, createdAt: string,
  items: RequestItem[]          // 1–10
}
RequestItem = { type: 'blood', group: BloodGroup, component: Component, quantity: number }  // 1–20
            | { type: 'bed', bedType: 'icu' | 'emergency' | 'general' | 'isolation' | 'nicu', quantity: number }  // 1–5
```

**Rules**

- A new case is always `open`, at the creator's hospital, and audit-logged (`emergencyrequest.created`). Its first
  timeline entry is the creation. Later moves are in [Status and its timeline](#status-and-its-timeline-34).
- **Severity (#31):** `critical`, `high`, `moderate`, `low`. The list is sorted by severity, then by age with the oldest
  case first within a level (the case waiting longest is handled first). The server does the sort; clients render
  the order they receive. Ties (same severity and time) fall back to id. Cases from before #31 were renamed:
  `urgent` → `high`, `routine` → `moderate`.
- No patient-identifying data is collected: `patientRef` is optional.
- Errors on one need come back keyed by its position: `{"items": {"0": {"quantity": ["..."]}}}`. An empty or
  over-long list is `{"items": ["..."]}`.

### Status and its timeline (#34)

```ts
EmergencyCaseDetail = EmergencyCase & {
  history: StatusChange[],      // oldest first; the first entry is the creation
  actions: CaseAction[]         // the moves valid from the current status, in table order
}
StatusChange = {
  fromStatus: CaseStatus | '',  // '' for the creation entry
  toStatus: CaseStatus,
  action: CaseAction | 'create',
  note: string,                 // up to 500 characters, may be ''
  actor: string | null,         // the user's name, or email if they have no name; null for the system (an automatic
                                //   escalation, #35) and for a user who has since been removed; the UI shows "System"
  at: string                    // ISO time
}
CaseAction = 'startMatching' | 'partiallyFulfil' | 'fulfil' | 'escalate' | 'resumeMatching' | 'close' | 'cancel'
```

`POST /emergencies/<id>/actions/` takes `{"action": "startMatching", "note": "Blood bank called back"}`. `note` is
optional, except for `close` (see [Escalation and closure](#escalation-and-closure-35)). Responses:

| Status | When |
|---|---|
| 200 | The move is made. The body is the case as it now is: its new `history` entry and its `actions`. |
| 400 | `action` is not a move in the lifecycle, or `note` is over 500 characters. Closing with a blank note is `{"note": ["Add an outcome note to close the case."]}`. Nothing changes. |
| 403 | The role can view emergencies but not change them (blood bank, pharmacist), or the user is not staff. |
| 404 | No such case, or another hospital's case (admins: any hospital). Nothing changes. |
| 409 | The lifecycle does not allow the move from the current status: `{"detail": "Can't close a case that is open."}`. Nothing changes and no timeline entry is written. |

**Transitions** (`REQUEST_LIFECYCLE` in `backend/apps/emergencies/models.py`):

| From | Action | To |
|---|---|---|
| open | startMatching | matching |
| matching | partiallyFulfil | partiallyFulfilled |
| matching | fulfil | fulfilled |
| partiallyFulfilled | fulfil | fulfilled |
| open, matching, partiallyFulfilled | escalate | escalated |
| escalated | resumeMatching | matching |
| fulfilled, partiallyFulfilled, escalated | close | closed |
| open, matching | cancel | cancelled |

`closed` and `cancelled` are terminal: no move leaves them. Until allocation sets fulfilment (#45), staff make every
move by hand.

Each move writes one timeline entry and one audit record (`emergencyrequest.status_changed`, with the before and after
status). The audit reason is the note, or the action when there is no note; the audit log keeps 300 characters of it.
The status change, the entry and the audit record are written in one transaction.

Reads follow the hospital rule above. So an admin who works at one hospital can move another hospital's case, as the
rule for moves says, but cannot open its page. That is an open question in the
[#34 inception spec](../aidlc/inception/2026-11-17-emergency-status-tracking.md).

### Local availability (#33)

The detail says what the case's own hospital has for each need. The list does not carry these fields.

```ts
EmergencyCaseDetail = EmergencyCase & {
  items: (RequestItem & {
    localAvailable: number,     // usable stock at the case's hospital that matches this need exactly
    shortfall: number           // max(0, quantity - fulfilled - localAvailable)
  })[],
  shortfallTotal: number        // sum of the items' shortfall: units and beds still needed from other hospitals
}
```

- **Blood** counts units at the case's hospital that are **exact** matches: the same group and the same component,
  status `available`, and not expired (`expires_at` after now, the same rule as the stock view). Quarantined, reserved,
  issued, discarded and expired units do not count. **Compatible groups do not count** (O− for an A+ need, for example):
  cross-group matching is story #37.
- **Beds** count free beds (`status` `free`) of the need's `bedType` at the case's hospital.
- Requirements that draw on the same stock share it in list order: the first sees the whole stock, the next sees what
  is left after it.
- A case with no hospital has `localAvailable` 0 for every need, so each need's shortfall is what is still unfulfilled.
- The shortfalls are computed on read and never stored. The matching step (#38) reads them through
  `shortfall_items(case)` in `backend/apps/emergencies/availability.py`.

### Escalation and closure (#35)

**Escalation.** A **critical** case in status `open`, `matching` or `partiallyFulfilled` is escalated to `escalated` when
its latest timeline entry (the time it entered that status) is older than `EMERGENCY_ESCALATION_MINUTES` minutes
(default 30, a whole number of 1 or more; the server does not start on any other value). Other severities, and cases
that are escalated, fulfilled, closed or cancelled, are never escalated automatically. A case resumed to `matching`
after an escalation gets a fresh window, because its resume is a new entry.

- The move is the same one a person makes (`escalate`), written through the same code: one timeline entry and one audit
  record (`emergencyrequest.status_changed`), both with **no actor**. The note is
  `Not fulfilled within 30 minutes (automatic)`, with the setting's value. The timeline shows the actor as **System**.
- It runs as a request-time sweep: the case list and the case detail check and escalate overdue cases before they
  answer, so staff see an up-to-date state. The check is one query when nothing is overdue. The sweep covers every
  hospital's cases, whoever is reading.
- A management command runs the same check and prints the count, for a scheduler later:
  `python manage.py escalate_overdue_cases` → `Escalated 2 overdue cases.`. Running it twice escalates nothing the
  second time.
- Two runs at once do not escalate the same case twice: each candidate is locked with `skip_locked`, and its status and
  latest entry are checked again under the lock.

**Closing needs an outcome note.** `POST /emergencies/<id>/actions/` with `{"action": "close"}` needs a `note` that is not
blank (spaces only count as blank). Without one the answer is **400** `{"note": ["Add an outcome note to close the case."]}`
and nothing changes. A close the lifecycle refuses (a case that is already closed, say) is still 409, checked first.
Other moves keep their note optional.

The outcome note is the note of the close entry in the timeline. The detail shows it as `outcome`:

```ts
EmergencyCaseDetail = EmergencyCase & {
  outcome: string | null        // the note of the close entry; null until the case is closed
}
```

## Demo data

```bash
docker compose exec backend python manage.py seed_demo          # safe to re-run
docker compose exec backend python manage.py seed_demo --reset  # start the demo data over
```

Creates 3 hospitals (CityCare General, Seaview, Northside Children's) with 10 departments, 12 wards / 164 beds
(ICU, emergency, general, isolation and NICU) and 10 storage locations, plus 320 blood units (with screening results), 60 synthetic donors (two deferred) and 6 upcoming donation
appointments, 23 medicines, 14 doctor shifts, the ER status, and one login per
role (`admin@`, `doctor@`, `nurse@`, `bloodbank@`, `pharmacist@`, `patient@demo.citycare.pk`, password
`CityCare-demo-1`). Demo only: never run it against real data.
