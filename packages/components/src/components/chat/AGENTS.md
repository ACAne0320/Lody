# components/chat

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.
Index and rationale: [README.md](README.md).

## Composer and selectors

- `attachment-add-menu.tsx` owns the single composer "+" menu and per-turn MCP
  selection (`ChatComposer mcp` → `AttachmentAddMenuMcp`), never the footer row.
  MCP uses a desktop hover submenu or a touch panel on the same surface with a
  back row. Toggling keeps it open; an empty catalog hides the entry.
- Desktop project pickers use DropdownMenu with local/GitHub projects by recency.
  Pin no-project/add-local/connect-GitHub actions; mount at most 20 rows (most
  recent if empty, first matches from all options if searching). Scope order:
  machine → project → worktree/branch. Direct local sessions neither render nor
  pass a branch; local worktrees and GitHub sessions keep theirs. GitHub projects
  are machine-independent. Machine changes filter local projects/configs and clear
  incompatible local projects without replacement. Keep mobile pickers independent.
- Single-member workspaces pass no project-sharing state. Otherwise local project
  options and the selected desktop trigger show only effective `Private`; hide Team
  and unresolved states. Effective access is `machine.sharedWithTeam &&
project.sharedWithTeam`. The selected Private segment opens `ProjectShareDialog`;
  its project share mutation also shares the machine atomically. Use
  `useConvexErrorMessage` for failures (auth recovery, no raw Convex toast).
  GitHub options have no access badge. A desktop machine option is local only when
  its value equals `visibleLocalMachineId`, never by ownership or Private access.
- The sharing-review landing notice has two distinct durable actions: dismissal
  keeps the current source revision quiet, while "Don't remind me again"
  suppresses that user's notice for the workspace across future revisions.
- The composer box border is 1px (`border`), not a 0.5px hairline. Light fill is
  `--composer`, dark fill stays `bg-input/90`, and the box is `rounded-2xl` with a
  soft wide lift (`COMPOSER_ELEVATION_CLASS`). The session info bar uses the same
  fill with its own `INFO_BAR_ELEVATION_CLASS`.
- Desktop footer order: run config → permission → usage. Provider interaction mode
  belongs inside run config; the standalone button is explicit permission mode,
  falling back to legacy ACP modes. Plus / model / mode share `gap-x-1.5`; when
  labels hide (`@max-[280px]/composer-face`) the two triggers are 28px squares
  matching the plus hit box, and lucide mode/model glyphs use stroke 1.5. Mobile
  new-chat and in-session composers share `MobileSessionRunConfig` face + sheet,
  with adjacent usage; see [mobile rules](../mobile/AGENTS.md). Never restore
  separate model/thinking chips or below-composer agent/permission rows. Usage
  reads the selected agent's Machine Flock subscription limits; hide it for
  custom or environment-overridden providers.
- Desktop "Recently used" (`lib/recent-run-configs.ts`) is device-local localStorage
  history per workspace, recorded only on chat START, never on setting changes.
  Rows offer the entire agent/model/config combination, filter by selected machine,
  and exclude the current combination. Apply the agent first; wait for
  `appliedTargetKey` in `use-acp-session-config-selection.ts` to name it before
  applying model/options.
- Every landing branch exposes ONE unfiltered hidden file input and one
  `onAttachmentAddClick`; selected files are split by MIME into the image and file
  draft hooks, exactly like paste and drop.
- Paste routes through `selectPastedClipboardFiles`: clipboard text beats an image
  the source app rendered beside it (unnamed or `image.<ext>`); named images and
  non-image files still attach. Contract:
  [paste precedence](../../../../../specs/composer-paste-precedence.md).

## Invariants

- The chat-route URL declares selection, never one-shot event nonces. Once it names
  a selection, mirror composer steering through desktop `onSelectionUrlSync` using
  replace (incomplete selection → empty search). Plain `/chat` stays plain; restored
  defaults/auto-selection never rewrite it. Mobile keeps base context with no callback.
- `use-chat-landing-draft-session.ts` owns the landing's reserved session id, and
  images, files, ACP preparation, and `startSession({ sessionId }, firstTurn)`
  MUST consume that same identity. Attachment hooks never reset it independently;
  reset only after a full draft clear. Submit blocks while `hasBlockingImages` or
  `hasBlockingFiles`.
- Key the whole landing draft with `buildChatLandingDraftKey` using the workspace SLUG,
  not its initially unresolved id. Persist prompt/pasted text/mentions through
  localStorage; workspace windows are peers and MUST NOT select draft persistence by
  window launch relationship. Keep the reserved session id and attachments
  in module-level atoms. Route unmount neither revokes previews nor aborts uploads;
  revoke/abort only on removal/full draft clear. App restart may lose attachments.
- Every new-chat entry point within a workspace reuses that one landing draft. Project
  selection may change, but navigation MUST NOT clear or replace Composer content;
  only an accepted submit or an explicit user removal may release draft resources.
- Submit immediately hides and disables the visible landing draft but preserves
  its controlled text, attachment resources, and reserved session id until
  `startSession` accepts. Failure must reveal the unchanged draft; only acceptance
  may clear resources or reset the reserved id. The accepted history entry is
  direct-authored into the renderer's own session store.
- Draft ACP preparation uses that same reserved id. It carries no prompt, env, or
  secret-shaped ACP option values; it may include the current sanitized
  mode/model/options. It is debounced/best-effort, replaced when routing or run
  config changes, cancelled on idle, and never awaited by submit. Once the initial
  user turn is locally accepted, submit MUST hand the lease to the durable session
  before clearing the draft or navigating; a successful handoff must not send
  `session/prepare-cancel`.
- The desktop landing keeps its composer docked at the bottom (the session composer's
  shell class); above it, centred in that band (not on the whole page), sit a plain heading
  and, in the composer's `ConversationColumn`, `HomeDashboard`: ONE line with a segment per board and
  under it the open board (folded by default; "now" or the last seven days when unfolded). The other segment swaps
  them; the open one or the end control folds it into the line, where each segment shows
  its summary. Never per-tile toggles or a settings list. The choice is device-local
  (`lody:homeBoard`). [Decisions](../../../../../.agents/notes/implemented/feature/2026-10-16-home-week-tiles.md).
- "Now" (`lib/home-now.ts` over `homeNowInputAtom`: the signed-in user's open root
  sessions, presence rolled up from child tabs) puts each session in ONE list by first
  reason: waiting > running > CI failed > unread > draft > ready to merge > open PR >
  recent. A running agent is never "needs you". Rows open their session. Height is
  `layoutHomeNow`'s: a row budget by priority (needs you never gives way) within the rows
  the landing stage has room for (`landing-stage.ts`), two columns levelled with real rows,
  empty lists not drawn, one calm tile when all are empty. "Show all" — or the tile itself,
  while it hides rows (`total > shown`), a row press excluded — opens the whole list
  in the board's frame, never grows a tile in place. Too short for one row per list, the
  board shows folded without changing `lody:homeBoard`. The plan usage
  (shortest window only; a known Codex reset in its own tile beside it, never inside) lives
  on "now"; the forecast loads only while "now" is open ([rules](../codex-reset/AGENTS.md)).
- The week board keeps the activity wall (workdays, newest weeks that fit, four blue steps
  over a neutral quiet gray, ONE shared day tooltip, never bars), merged PRs, streak,
  agents and repository; no cost, start-hours, longest conversation or busiest day.
- Both boards: tiles placed by hand, never auto-flow; rows are `minmax(…, auto)` floors;
  empty or not-yet-loaded data shows zeros or an empty-list line, never a hole. The well,
  no shadow, hairline charts, no canvas/WebGL/per-frame script; tile text is never
  `tertiaryLabel`. Motion: the week's one-time roll-up, the wall fading in, and switching
  as one quiet View Transition (height eases, boards cross-fade, the pill glides; never
  scaled or flown); all off under reduced motion.
- `chat-landing-view.tsx` renders `ChatComposer`; stateful loading stays in
  `chat-landing.tsx`, session-mention drop handling in the view. Paint the page-level
  `ConversationDropOverlay` when sidebar drag starts, before `dragenter`. Desktop
  only: mobile passes the handle but installs no HTML5 drop target. A dropped folder
  takes the same handle and becomes a `@<absolute path>` mention, never an upload.
- Apply `select-none` to composer dropdown/toggle chrome: top/footer selectors,
  bottom bar, ACP booleans, Workdir/agent/model/branch triggers, mobile inline
  triggers, and option rows. Keep prompt, pasted-text editor, and picker search
  selectable/editable; they must not inherit broad `select-none`.
- Desktop composer/landing menu selections return focus to the prompt
  (`[data-keyboard-nav="composer"]`), never the trigger. Use `lib/menu-focus.ts`
  through `ui/dropdown-menu` and `OptionSelector`, including keep-open run-config
  selections (`event.preventDefault`).
- Desktop landing's machine/project/branch menus always open upward with collision
  flipping disabled. Their top-row labels and glyphs, including disabled branch
  state, share the same neutral foreground level.
- The ACP provider cycle command uses the same single-machine scope as the visible
  provider menu. Never cycle all workspace configs while retaining the old machine id.
- Mobile composer pickers rely on `MobileInlinePicker` plus
  `MobileInlinePickerRowSlot` so dropdown panels project to a full-row slot,
  never resizing a narrow footer chip.
- Keep raw local Git, Machine RPC, and Streams failures out of landing status copy;
  retain them for submit blocking, telemetry, logging, and scoped retry. Status copy
  is for actionable validation and selected-machine project guidance.
- Chat Landing must not initiate ACP capability probes: startup refresh lives in
  the workspace runtime and explicit probes in settings/onboarding. Do not render
  their spinner, download progress, or ready state in the landing composer.
