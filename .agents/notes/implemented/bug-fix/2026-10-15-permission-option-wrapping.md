# Compact permission controls with readable option names

Status: implemented
Translation: current

[中文](2026-10-15-permission-option-wrapping.zh.md)

## Abstract

Long permission names could push refusal buttons outside the prompt and hide
future authorization scope behind menu ellipses. The prompt keeps short answers
directly clickable and moves a family with a long shown answer into a compact
menu trigger. Menus show complete provider names, left-aligned and wrapping
within the viewport. Long answers require an additional menu-opening step; six
browser cases pass in an isolated presentation harness, while full-app and
native-device verification remain outstanding.

## Decision and ownership

This supplements the [split-button decision](../feature/2026-09-24-permission-prompt.md#fifth-review-split-buttons)
and updates the existing draft [permission presentation contract](../../../../specs/permission-requests.md#contract).
Simply wrapping the original button labels produced large centered paragraphs
with a small detached chevron. That approach was rejected during visual review:
it fixed overflow but overwhelmed the composer-scale prompt.

[PermissionPrompt](../../../../packages/components/src/components/sessions/floating-permission-request.tsx)
owns the compact-control budget: 32 character places, counting characters above
Latin-1 twice. A main option exceeding that budget moves its entire family into
a menu, preserving provider order and original names. The trigger says Decline,
Allow, or Choose an answer according to the main option's tone; it names a group
and never submits an option. Short names retain the existing direct answer and
optional split-menu interaction. Both paths use the existing Button and Menu
primitives without changing their appearance or adding a multiline Button API.

The menu's provider labels preserve whitespace, wrap long paths, have a 32em
width ceiling, and shrink within the popup's existing viewport limit. They use
an element child to bypass the primitive's automatic ellipsis wrapper, leaving
other menus unchanged. Arrow navigation still focuses the family's control;
Enter opens a long-answer menu, and selecting its original row submits the
original option ID. Escape on the prompt retains its one-time-refusal behavior.

## Verification and limits

The [permission stories](../../../../packages/components/src/stories/PermissionPrompt.stories.tsx)
provide synthetic English and Chinese long names, a long path, and a visible
selected-ID outcome. Six [browser cases](../../../../packages/components/tests/e2e/composer-submission-focus.spec.ts)
pass in Playwright 1.58.2 with Chrome at 320, 390, and 1280 pixels. They check
compact control height, containment, wrapped menu text, viewport bounds, and
keyboard opening without submission followed by selection of the original ID.

The harness reuses the main checkout's dependencies, extracts unchanged prompt
presentation bodies, and renders the real Button, Menu, StyleX tokens, and story
data. It excludes session lifecycle composition and stubs an unused command-title
truncation helper; the fixtures are edit requests. Ignored screenshots under
`.lody/permission-acceptance/screenshots/` compare the Git baseline, the rejected
multiline-button iteration, and the compact revision. They were uploaded to the
task conversation. This verifies presentation and selection, not daemon delivery
or native devices; full Storybook and component unit tests were not rerun.

Root `pnpm format`, `pnpm lint:i18n`, Oxfmt 0.65.0, and `git diff --check` pass.
`pnpm check` stops at the unchanged `e2ee-core` package's missing dependencies.
Components typecheck also reports missing dependencies and existing errors in
other modules, with no diagnostics in the changed prompt or stories. The public
boundary check reports missing ACP submodule workspaces; `docs check` reports 82
links to those missing submodules and no errors in changed documentation. No
protected documentation topics are registered.
