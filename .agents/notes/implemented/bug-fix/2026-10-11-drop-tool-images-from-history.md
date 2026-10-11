# Drop tool images from persisted history

Status: implemented
Translation: current
PR: [LodyAI/Lody#1456](https://github.com/LodyAI/Lody/pull/1456)
Follow-up PR: [LodyAI/Lody#1473](https://github.com/LodyAI/Lody/pull/1473)

[中文](2026-10-11-drop-tool-images-from-history.zh.md)

## Abstract

Ordinary ACP tools could persist image data and embedded image blob resources in
session history, although conversation attachments already use references. The
first shared projection dropped tool images instead of uploading them. A follow-up
extends this to tool audio, all resource blobs, embedded base64 and bounded raw
records/metadata across root, imported and normalized child tools. Small readable
output and scheduling/permission fields survive; oversized tool display content
may be omitted or truncated. Existing stored history is not bulk migrated, and
provider execution output remains unchanged.

## Initial image decision (#1456)

```text
Root tool / replay → root content projection ─┐
                                            ├→ drop tool images → HistoryWriter
Normalized child tool → child projection ────┘
```

`packages/shared/src/acp/tool-call-history.ts` owns image removal. Drop every ACP
image block, plus blob resources identified by an image MIME type or image data
URI. Keep resource links, textual resources and other media. Child projection
uses only this filter, preserving its read results and diffs rather than adopting
root terminal compaction. Omitted content retains the previous list; an image-only
replacement becomes an empty list.

Uploading every tool image was rejected because these execution artifacts need no
durable conversation copy. Filtering only root notifications was insufficient:
external imports share the root reducer, but normalized child tools have a separate
projection. This does not inspect arbitrary raw fields or rewrite legacy records;
unchanged opaque data still follows the [single writer decision](../architecture/2026-09-07-single-history-writer.md).
Existing R2-backed image and image-group attachments remain distinct from tool content.

## Verification

Behavioral coverage crosses a real Loro HistoryWriter for root and child output,
checks sparse updates and image-only replacements, and copies filtered history to
a fork. Import coverage exercises the shared replay boundary. Fixtures are
synthetic; this change does not migrate existing history or alter provider schemas.

## Follow-up: binary and redundant payloads

The audit found remaining audio/non-image blobs, data URIs, text/extension base64,
unbounded raw records and metadata, and duplicate child scalar/array output. The
follow-up uses one tool-history policy for ACP root/replay, canonical tool writes,
normalized children and permission data. Structured images/audio, all resource
blobs and data-URI resources are dropped without decoding/uploading. Text removes
embedded data URIs, unbroken base64-like runs of at least 4096 characters and
whole wrapped base64; a huge ordinary unbroken token can also be redacted.

Display strings are limited to 16 KiB UTF-8 without splitting a code point. JSON
is limited to 32 KiB, depth 8, 256 visited nodes and 128 fields/elements per
container; `blob`/`base64` fields and nested image/audio objects are removed.
Content lists are limited to 128 blocks and 64 KiB serialized UTF-8. Diffs whose
text would change are omitted, avoiding false partial diffs. Terminal snapshots
keep the actual combined 1 KiB tail before the generic text budget. Location
extension dictionaries use the same bounded JSON policy, retaining valid paths/lines.

Child raw input is dropped. Object raw output and metadata retain bounded useful
JSON; scalar/array raw output has one bounded readable copy and no
`_meta.lody.subagentRaw` duplicate. Root scheduling input selects only the six
fields consumed by the task panel; scheduling output remains bounded JSON/text
for job-id matching and committed fire times. Permission request/options/outcome
keep their identity, selected option and bounded metadata, including question
definitions and answers; unused option/outcome extensions are dropped.

Ordinary assistant audio/resources use `acp-agent-attachments.ts` to upload attachments
and persist references; image
and file uploads have 5 MiB and 100 MiB limits respectively. Inline ACP bytes are
decoded before checking those limits, so the limits do not bound decode memory.
Expanded tool details have an audio player in `components/ai-gui/view.tsx`; removing
tool audio would remove that preview. These are code-path findings, not observed
production payload sizes. This follow-up does not bound ordinary conversation
text, provider execution memory, cumulative transcript length or legacy history.
Useful tool text above the new limits is intentionally truncated/omitted.
Behavioral tests exercise real Loro persistence/fork copies, imported audio/blobs,
canonical raw extensions, sparse child updates and permission question answers.
