# E2EE UI

Parent instructions apply. `CLAUDE.md` is a symlink; edit `AGENTS.md` only.

## Status prototypes

- Components are presentational: callers supply states, affected scope and action
  callbacks. Never infer authorization, key possession or global failure policy
  from a click or a single failed item.
- Keep examples synthetic and isolated in Storybook. Do not add production entry
  points or connect cryptographic, authorization or recovery services here.
- Recovery evidence belongs to each workspace and a specific key update, not to
  account login or file creation. See [README](README.md) for preview and checks.
- Announce result changes by workspace ID, including its name. Initial/new rows,
  reordering and unchanged results stay silent; announcements must not move focus
  or imply that the whole recovery completed.

## Local agent approval

The sibling `../e2ee-local-agent-approval.tsx` requires explicit consent and file-custody disclosure. Hide approval without a local credential. Re-prepare on retry; retain consent only for the same session, and require fresh consent for a replacement session. Local status failures must remain retryable. Credentials stay in main; UI consumes availability only.
