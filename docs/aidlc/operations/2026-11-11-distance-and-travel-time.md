# Operations Notes: Distance and estimated travel time

**Construction plan:** [docs/aidlc/construction/2026-11-11-distance-and-travel-time.md](../construction/2026-11-11-distance-and-travel-time.md)
**Merged to `main`:** 2026-11-11, [PR #91](https://github.com/harishassan-code/hospital-care/pull/91); unit 2 (gap fix) 2026-11-17
**Deployed to staging:** N/A — backend utility with no endpoint yet; nothing to deploy or observe in staging until it's wired into the matching engine.

## Outcome

- [x] Haversine straight-line distance in km between two hospitals' coordinates — met. See
      `backend/apps/matching/distance.py:haversine_km` / `hospital_distance`.
- [x] Simulated travel-time estimate in minutes from a configurable average city speed — met after
      unit 2. Unit 1 only allowed a per-call argument; the default (40 km/h, as agreed in the Inception
      spec) is now the `MATCHING_AVERAGE_SPEED_KMH` setting.
- [x] Exposed as a reusable utility for the matching engine — met. No endpoint/UI yet, as scoped
      (non-goal in the Inception spec).
- [x] Unit tests: zero distance, known real-world pair, travel-time conversion — met after unit 2, which
      added the London–Paris and Karachi–Lahore checks the spec asked for (unit 1 had an equator
      reference value only). 15 tests in `backend/apps/matching/tests/test_distance.py`.

## Process notes

- **Gates were not sequential for unit 1.** The Inception spec, Construction plan and code all landed in
  PR #91, and that PR went straight to `main` rather than through a weekly integration. So the spec's
  approval did not happen before the code was written, as Inception requires. From now on the spec
  is committed and approved first (see the [AIDLC README](../README.md#1-inception)).
- **#39 is not fully done.** The backlog story says distance and travel time are *shown* to the
  coordinator (area: backend + frontend). This cycle deliberately delivered only the backend utility, so
  #39 stays open until the UI shows them, through #41 below.

## Monitoring notes

No runtime behaviour to monitor yet — this unit only added a pure-function utility and its tests,
with no new endpoint, migration, or UI surface. CI (`ruff check`, `ruff format --check`, `pytest`)
was green on merge.

## Follow-ups

- Wire `hospital_distance`/`estimated_travel_minutes` into the scoring model once
  [#40 Configurable scoring model](https://github.com/harishassan-code/hospital-care/issues/40) is
  built — that PR should go through its own AIDLC cycle, with its Inception spec referencing this
  utility as already available.
- [#41 Ranked results with explanation](https://github.com/harishassan-code/hospital-care/issues/41)
  and [#42 Multi-resource matching](https://github.com/harishassan-code/hospital-care/issues/42) are
  the other consumers; no action needed on this unit until they're scheduled.

This closes one Inception → Construction → Operations loop for the backend part of #39. The UI part goes
through its own cycle with #41.
