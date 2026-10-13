# Restore the selected ACP dependency lock closure

Status: implemented
Translation: current

[中文](2026-10-13-selected-acp-lock-closure.zh.md)

## Abstract

Main 567afa18 selects Claude 2ff63b6 and Codex aae32a2 but retains older dependency importers. Complete fixed-submodule frozen installation fails before tests. Align only those two importers and add their required package/snapshot closure. Preserve all other importers, existing resolutions, catalogs, overrides, gitlinks and the seven-day release waiting rule. Exact waiting-rule exceptions cover only versions selected by those manifests and their matching platform/Vitest packages.

## Verification and limits

The original complete-submodule frozen install fails with nine Claude specifier mismatches; Codex also changes its declared Codex range and cross-spawn dependencies. The final repaired lock passes actual frozen installation with all eight fixed gitlinks. Generating the candidate lock is preparation, not frozen-install evidence. Unrelated peer/importer drift from the generator was discarded, retaining the original entries and their complete old closures. Root checks and latest-main E2EE composition are reported separately, with exact heads and exit codes. This dependency repair grants no E2EE protocol or production authorization.
