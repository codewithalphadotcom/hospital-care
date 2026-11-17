# Construction Plan: Distance and estimated travel time

**Spec:** [docs/aidlc/inception/2026-11-11-distance-and-travel-time.md](../inception/2026-11-11-distance-and-travel-time.md)
**Date:** 2026-11-11

## Units of work

| Unit | Description | Files touched | Tests |
|---|---|---|---|
| 1 | Add a `distance` module to `apps/matching` with a Haversine distance function and a travel-time estimate function; unit tests for both | `backend/apps/matching/distance.py` (new), `backend/apps/matching/tests/test_distance.py` (new) | pytest: zero-distance case, known city-pair sanity check, travel-time conversion at default and custom speed |
| 2 (2026-11-17, gap fix) | Close the gaps a review of unit 1 against this spec found: the default speed becomes the `MATCHING_AVERAGE_SPEED_KMH` setting (env-overridable, like the blood rules) so it is configurable without code changes; impossible inputs (speed ≤ 0, negative distance) raise `ValueError` | `distance.py`, `test_distance.py`, `backend/config/settings.py`, `backend/.env.example` | pytest: London–Paris and Karachi–Lahore against published straight-line distances (unit 1 only asserted an equator reference value, not a city pair), default speed read from settings, invalid inputs refused |

## Sequencing

No dependencies — `Hospital.latitude`/`longitude` already exist, and this unit doesn't touch any
other app or model.

## Test plan

- `cd backend && pytest apps/matching/` — new tests pass.
- `cd backend && ruff check . && ruff format --check .` — matches existing CI lint step.
- No migrations, no frontend changes, so `npm test`/`npm run build` are unaffected by this unit.

## Review

This unit's PR requires reviewer approval per [CONTRIBUTING.md](../../../CONTRIBUTING.md) before
merge — that approval is the Construction gate.
