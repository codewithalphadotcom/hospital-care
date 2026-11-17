# AIDLC: AI-Driven Development Life Cycle

This project uses AIDLC alongside Scrum to structure how AI-assisted feature work moves from idea to
production. It does not replace the Scrum ceremonies in [docs/deliverables](../deliverables/README.md) —
it describes the three phases a single feature or story passes through *within* a sprint, each with a
human approval gate before the next phase starts.

| Phase | What happens | Approval gate | Template |
|---|---|---|---|
| [Inception](#1-inception) | Requirements captured as a spec: problem, user stories, acceptance criteria, open questions | Product Owner signs off on the spec before any code is written | [inception-spec-template.md](templates/inception-spec-template.md) |
| [Construction](#2-construction) | The approved spec becomes a technical plan broken into small units, each built on the developer's branch and reviewed in their weekly PR | A teammate approves the weekly PR, and the integration PR into `main` is approved (see [CONTRIBUTING.md](../../CONTRIBUTING.md)) | [construction-plan-template.md](templates/construction-plan-template.md) |
| [Operations](#3-operations) | CI runs, the weekly integration merges to `main`, the change ships to staging, and the outcome is observed | PO/team reviews the deployed outcome; follow-ups feed the next Inception | [operations-notes-template.md](templates/operations-notes-template.md) |

## 1. Inception

Before any implementation starts, write an inception spec using the
[template](templates/inception-spec-template.md) and save it under `docs/aidlc/inception/`
(e.g. `docs/aidlc/inception/2026-11-11-feature-name.md`).

The spec covers:

- The problem being solved and who it's for.
- User stories and acceptance criteria.
- Open questions / explicit non-goals.
- A sign-off line naming who approved it and when.

**Worked example:** [distance and travel time (#39)](inception/2026-11-11-distance-and-travel-time.md),
followed through [Construction](construction/2026-11-11-distance-and-travel-time.md) and
[Operations](operations/2026-11-11-distance-and-travel-time.md). The design docs in
[`docs/superpowers/specs/`](../superpowers/specs/) were written in the same spirit before AIDLC was adopted.

No code is written until the spec is approved. Commit the spec on its own (`docs(aidlc): ...`) and fill in
its Approval line when the Product Owner signs off; implementation commits come after that one.

## 2. Construction

Once a spec is approved, write a construction plan using the
[template](templates/construction-plan-template.md) and save it under `docs/aidlc/construction/`,
mirroring the spec's filename. The plan breaks the spec into small, independently reviewable units
(each one roughly a single PR), lists the files each unit touches, and names the tests that will
cover it.

Each unit is then committed on the developer's own branch and reviewed in their weekly pull request,
which needs at least one teammate's approval; the work reaches `main` through the Scrum Master's weekly
integration PR, which needs one more (see [CONTRIBUTING.md](../../CONTRIBUTING.md), sections 4 and 5).
Those reviews **are** the AIDLC Construction gate, so no separate process is added here. The PR template's
AIDLC checkbox reminds the reviewer to check the code against the approved spec, not only for style.

## 3. Operations

After the weekly integration merges to `main`, CI and the staging pipeline (Render + Vercel, see
[docs/setup/deployment.md](../setup/deployment.md)) take over. Once the feature is live on staging,
record the outcome using the [template](templates/operations-notes-template.md) under
`docs/aidlc/operations/`: what shipped, any monitoring notes, and follow-up items.

Follow-ups and issues observed here feed directly into the next Inception spec, and are also visible
in the sprint review/retrospective docs under [docs/deliverables](../deliverables/README.md).

## Why this on top of Scrum

Scrum answers *what we build this sprint and in what order*. AIDLC answers *how a single piece of
that work moves from an AI-drafted idea to something running in production, with a human approving
it at each handoff*. The two are complementary: a sprint's committed backlog items each go through
their own Inception -> Construction -> Operations cycle.
