# Construction Plan: <feature name>

**Spec:** [docs/aidlc/inception/<file>.md](../inception/<file>.md)
**Date:** <YYYY-MM-DD>

## Units of work

Break the spec into small, independently reviewable units, each small enough to review on its own in
the weekly PR.

| Unit | Description | Files touched | Tests |
|---|---|---|---|
| 1 | <what it does> | <paths> | <test plan> |
| 2 | | | |

## Sequencing

Note any ordering dependencies between units (e.g. backend model before frontend UI).

## Test plan

How the full feature will be verified once all units land (manual steps, automated tests, which CI
checks must be green).

## Review

Each unit is reviewed in the developer's weekly PR and again at the weekly integration PR, per
[CONTRIBUTING.md](../../../CONTRIBUTING.md). Those approvals are the Construction gate.
