# Effect lint integration

Status: implemented
Translation: current

Implementation: [#1530](https://github.com/LodyAI/Lody/pull/1530)

English | [中文](2026-10-13-effect-lint-integration.zh.md)

## Abstract

The existing type-aware lint did not check Effect-specific mistakes, and its
quiet mode would hide advisory rules. A dedicated Effect lint command with an
isolated tool package now runs
five official correctness rules and a community function-style rule, displaying
warnings through the existing static check paths. Compatible tools are pinned in
that package
and patched without changing TypeScript or Effect runtime versions. The initial
policy is advisory: it exposes a baseline without turning integration into a
repository-wide code migration, and does not prove complete lifecycle correctness.

## Decision

`lint:effect` selects a separate config, disables nested config discovery, and
patches Oxlint before execution. The installing workspace also patches those
tool binaries on prepare;
repeating the idempotent patch supports installations with lifecycle scripts
omitted. Ordinary lint and fast lint retain their existing versions and
configuration.
The runner explicitly selects the tooling package's type-aware engine through
`OXLINT_TSGOLINT_PATH`, so the root engine cannot be used accidentally.
Embedded checkouts run the installing parent's Effect lint command and never
install a second store.

Pin `@effect/tsgo@0.48.1`, `oxlint@1.86.0`, `oxlint-tsgolint@7.0.2003`, and
`effect-rules@0.3.5`. These match the official supported-version table. All
selected versions satisfy the existing release-age waiting period; no
exceptions are added. `--no-typescript --oxlint` deliberately leaves
the existing TypeScript compiler installation unchanged.

Upgrading the ordinary Oxlint activated 22 additional rules and changed existing
rule behavior, producing unrelated diagnostics on the same source tree. Rather
than disabling those checks or editing product code, the workspace contains
`scripts/effect-lint` with a separate dependency closure. Only this tool package's
binaries are patched. Both toolchains satisfy the existing release-age policy.

Five official rules check floating Effects, runners inside Effects, bare yield,
Effects returned from generators, and Promise-returning sync thunks. The
community `effect/prefer-effect-fn` is selected for its verified reusable generator
wrapper convention. Do not enable whole community presets: they impose broader policies on ordinary
code and adapters than this task requires. The official `effecttsgo/` and selected
community `effect/` namespaces are distinct.

`check:quick` and `check` run the command without `--quiet`. The CI scope selector
treats the new config as a full-check input. Generated code and vendor ACP
workspaces are excluded, while maintained app/package sources remain covered.
Warnings start at `warn`; promote correctness rules after baseline review.
The [Effect guide](../../../docs/cli-effect-ts.md#effect-lint) owns current usage.

## Verification boundary

`scripts/effect-lint.test.mjs` invokes the installed Oxlint on synthetic TypeScript
projects. It checks all six diagnostic codes and their visible warning severity,
strict invocation exit status, and valid composition, top-level runners, and
ordinary code. Fixtures resolve the consuming CLI package's actual Effect dependency.

The initial isolated Linux probe verified both plugin namespaces together.
`runSync` applied to an asynchronous constructor remains outside this rule set;
[upstream proposal #430](https://github.com/Effect-TS/tsgo/issues/430) is not a
coverage guarantee. Missing context/error rules and other platforms require
separate verification before claiming coverage. No product lifecycle code changes.
