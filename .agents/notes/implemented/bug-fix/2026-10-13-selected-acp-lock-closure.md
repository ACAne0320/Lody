# Match the restored ACP gitlinks and dependency lock

Status: implemented
Translation: current

[中文](2026-10-13-selected-acp-lock-closure.zh.md)

## Abstract

Main c10ca856 restored four compatible ACP gitlinks, preserving the published runtime manifests. Its successor a4270dd8 still carries newer Claude/Codex lock importers and fails complete-submodule frozen installation on nine inverse Claude mismatches. Honor those restored gitlinks: restore only their previously compatible importers and add the exact missing resolution/snapshot closure. Preserve all other importers, existing current-main package/snapshot values, catalogs, overrides, waiting-rule exceptions, Specs and gitlinks.

## Evidence and limits

The earlier candidate for main567afa targeted the then-selected newer adapters. The owner's main fix supersedes that version choice; no new-version quarantine exceptions or stale historical-link edits remain in the current main diff. Recursively resolve only the restored importer dependencies, using existing main definitions where present and the prior compatible main567afa closure only where absent, including platform aliases. Keep original failure and candidate evidence separate from final complete-submodule frozen installation. Final combination root/build/smoke and remote CI have their own fixed revisions and results; no runtime upload, protocol approval or production activation is authorized by this lock repair.

Main1535 also declares providerRateLimitsRefresh version1. Its exhaustive machine-registration fixture omitted that key; add the literal expected version, preserving the entire strict equality assertion. Production negotiation and behavior remain unchanged.
