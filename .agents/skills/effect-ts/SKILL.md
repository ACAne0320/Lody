---
name: effect-ts
description: Assess, implement, review or debug native Effect v4 TypeScript workflows in Lody using version-matched references and lifecycle behavior contracts.
---

# Native Effect work in Lody

Use this skill before assessing a native migration, choosing its structure or
changing Effect lifecycle behavior. Lody already uses v4; ordinary Promise-to-Effect
refactoring does not invoke the [v3-to-v4 skill](../effect-v3-to-v4/SKILL.md).
Use that skill only for an explicitly scoped version migration.

## Resolve the reference and scope

Keep the workspace catalog and lockfile version. Follow repository installation
rules if dependencies are missing; do not install latest, add a root dependency
or upgrade packages as a side effect. Resolve Effect from the consuming package,
read its `effect/AGENTS.md` completely and follow the links relevant to this task.
Search that release's `ai-docs` and `src` for APIs and lifecycle semantics. Upstream
main and a temporary exact-release reference are not local validation.

Read applicable scoped AGENTS.md and [Lody's Effect guide](../../docs/cli-effect-ts.md).
Consult the [migration charter and unit ledger](../../notes/proposed/architecture/2026-09-27-effect-lifecycle-migration-roadmap.md#unit-ledger)
for actual prerequisites and the separate kernel, consumer and ownership states.
Retain existing product contracts, pure computation, public/local boundaries and
disabled telemetry. Upstream Schema, SQL and CLI examples do not authorize replacing
Lody's existing validation, persistence or command frameworks.

## Choose the workflow from its behavior

1. Identify the complete responsibility being changed and its real consumers.
   Follow imports, injected callbacks, raw requests, resource handles and background
   tasks. Classify dependencies as native capabilities, genuine third-party I/O,
   or unfinished Lody orchestration. Record blockers and registered temporary
   upstream adapters; wrapping our own Promise workflow does not complete it.
2. State the behavioral constraints: ordering/reentry, local wait versus raw work,
   shared leases, stop reasons, replacement, release order and failure/recovery owner.
   Put resources and tasks under explicit ownership. Local cancellation must not
   release ownership of still-running raw work.
3. Prefer official capabilities and primitives, then check the installed source
   and topic examples for the relevant semantics. Verify fairness, replacement,
   interruption, finalizer bounds and error Cause preservation when applicable.
   Semaphore, RcMap and FiberMap are options, not automatic proofs of these
   contracts. Explain custom coordination with source/experiment evidence in the
   owning Note when official behavior does not meet the requirement.
4. Compose native Effects and provide dependencies through Services/Layers.
   Keep execution at application entries or one registered, deprecated Legacy
   facade with named consumers and a deletion condition. Propagate cancellation
   across real Promise boundaries, await actual cleanup and retain unresolved
   owners/failures. Use the guide's Promise/finalizer rules rather than assuming
   timeout around uninterruptible work bounds its cleanup.

Keep small cohesive modules simple. Split pure computation, platform-independent
Effect workflows and concrete platform adapters only when a large mixed module
needs it for clarity, testing or independent delivery. No fixed file skeleton or
line-count rule is required. A workflow may use abstract Services; a domain Layer
is not automatically a platform adapter. See the guide's
[structure criteria](../../docs/cli-effect-ts.md#choosing-a-native-unit-and-its-structure).

## Verify and leave a maintained boundary

Select relevant cases from the guide's [testing matrix](../../docs/cli-effect-ts.md#testing).
Use injected services, explicit readiness signals and TestClock/fake clocks.
Assert observable failure, cancellation, release and data/resource state; await
fibers and cleanup. Preserve meaningful real-boundary regressions. Type-checking
alone is not acceptance, and mock-call/source-string assertions are not substitutes.
Use temporary ablations for key lifecycle coordination when they add confidence.

Run repository-required checks; report environment limits and baseline failures
without weakening coverage. Update the owning Note, affected docs and nearest
AGENTS.md when the boundary changes, and maintain applicable static guards.
Update the ledger only for changed migration facts, removing obsolete Legacy
entries after consumers migrate. Keep verification revisions/platform limits
explicit; this skill is not proof that a unit or its upper workflow is complete.
