# Project default MCP selection

Status: draft
Translation: current

[中文](project-default-mcp.zh.md)

## Scenario and scope

A person opens a project's **Default MCP** tab, sees the current workspace's
registered MCP servers, and switches the defaults for conversations in that
project. The proposed first version seeds new conversations, including their
first turn from CLI/MCP entry points. Existing conversations retain their own
selection; changing a project default does not modify accepted or running turns.
This is proposed behavior, not an implemented or approved guarantee.

## Ownership

The workspace catalog remains the sole owner of MCP names and connections.
A new project preference family in the same workspace Flock document stores
only project identity, MCP id and an enabled/disabled override. It contains no
connection values or credentials. The actual selected ids remain in each user
turn's `inputConfig.mcpServerIds`; the runtime consumes that frozen selection.

Project identity excludes branch, session and worktree path. A local project is
identified by machine id plus local project id; a GitHub project by its canonical
repository identity within the workspace. A local checkout with a GitHub remote
remains a local project, with no implicit merging of the two identities. This
machine component identifies the local project; it does not bind MCP connections
or make them available on that machine.

Project preferences follow the project's existing management authorization.
Reads and mutations validate workspace and project scope. Storage visibility is
not a confidentiality guarantee. Public local desktop access uses existing local
repo/platform ports, with no authenticated product-cloud dependency.

## Selection behavior

For each server, a project override wins over catalog `enabledByDefault`; an
absent override inherits that catalog default. The switch displays this effective
value. Switching writes an explicit boolean; **Reset to workspace defaults**
removes project overrides. Newly registered servers inherit their workspace
default unless explicitly overridden for this project.

Selection precedence when authoring a turn is:

1. Explicit selection for the send, including an empty array.
2. The target conversation's existing selection when continuing it.
3. Effective project/workspace defaults when starting a new conversation.

An existing legacy conversation without a recorded selection is treated as empty,
not retroactively enrolled in project defaults. No-project conversations use
workspace defaults. Fork/edit-resend preserve their source selection by default;
a genuinely new delegated conversation uses its target project's defaults unless
its caller explicitly supplies ids. Role configuration does not store MCP ids,
and the caller's project selection is not implicitly copied to another project.

Default resolution happens before a send or operation is accepted. The resolved
ids, including `[]`, are frozen in the accepted request and resulting turn before
dispatch. Retries, queued work, deferred attachment sends and recovery use those
ids. Startup does not reapply project defaults. Only ids are frozen: current
catalog connections and target runtime capabilities are still resolved at startup.

## Interface and failure behavior

Place **Default MCP** between Skills and Conversations. Rows show name, description,
transport, configuration state and a switch. Offer search, selected count, reset,
and a link to workspace MCP management. Do not expose connection secrets. Clearly
state that defaults apply to new conversations and can be changed in the composer.
No catalog entries produces a management empty state, not an empty saved policy.

Keep draft selection scoped to workspace and project. Changing either resets the
previous project's temporary override. A local preference write succeeds when
durable; upload follows independently where supported. Failed writes restore the
row and display an error. Concurrent changes to different servers must not replace
each other. Read-only users can inspect but cannot switch or reset.

Before accepting a default-derived send, resolve a ready local policy/catalog
snapshot. Loading/error must not masquerade as an empty list. Deferred sends keep
the click-time selection even when project settings change during upload.
Missing catalog ids remain diagnosable; deletion must never redirect a selection
to another entry with the same name. Invalid connections and unsupported transports
use the existing runtime problem reporting. A selected switch means selected,
not connected, authorized, or successfully loaded.

## Compatibility and acceptance

Add a versioned machine protocol capability for default-aware authoring. New
clients must not advertise working defaults for an unsupported authoring path.
Explicit frozen selections can still use existing compatible dispatch. Old clients
must preserve unknown preference rows; omission by an old client must not be
silently reinterpreted at runtime. Confirm this with mixed-version tests.

Acceptance covers precedence (especially `[]` and explicit project-off), local and
GitHub identity isolation, worktree inheritance, read/write authorization, loading
and persistence failures, concurrent row edits, UI/CLI/MCP authoring parity,
deferred send/retry/recovery, preparation-cache identity and runtime recreation,
deletion/rename, unsupported transports, and zero product-cloud access locally.

The first-version choice to affect only new conversations remains a product
proposal. Live inheritance by existing conversations would require a separate
inherit/override contract; it must not be implemented by blindly unioning ids.

## Evidence

- [Current catalog and resolver](../packages/shared/src/workspace-mcp.ts)
- [Current composer selection](../packages/components/src/hooks/use-session-mcp-selection.ts)
- [Per-turn dispatch](../apps/cli/src/session/session-dispatch-watcher.ts)
- [Architecture proposal](../.agents/notes/proposed/architecture/2026-10-09-project-default-mcp.md)

No runtime implementation or behavioral validation accompanies this draft.
