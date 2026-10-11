import type { MessageContent } from '../ai';
import { ToolCallContentSchema, ToolCallLocationSchema } from '../message-schemas';

type ToolCallMessage = Extract<MessageContent, { type: 'tool_call' }>;
type ToolCallContent = NonNullable<ToolCallMessage['content']>;
type ToolCallKind = ToolCallMessage['kind'] | null | undefined;
type ToolCallLocations = NonNullable<ToolCallMessage['locations']>;

/**
 * Session history is persisted in a Loro CRDT document.
 *
 * Tool calls are the biggest contributor to document size because providers often include:
 * - full file contents on reads
 * - full old/new text on edits
 * - snapshot-style terminal output repeated on every incremental update
 *
 * This module centralizes the "what is safe to store" policy so we can:
 * - keep history useful for follow-along (titles, status, commands, paths)
 * - avoid persisting large / redundant payloads across trust boundaries
 */

export const deriveLocationsFromToolCallContent = (
  content: unknown
): ToolCallLocations | undefined => {
  if (!Array.isArray(content)) return undefined;
  const paths = new Set<string>();
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (!('type' in block)) continue;
    if ((block as { type?: unknown }).type !== 'diff') continue;
    const maybePath = (block as { path?: unknown }).path;
    if (typeof maybePath !== 'string' || maybePath.length === 0) continue;
    paths.add(maybePath);
  }
  if (paths.size === 0) return undefined;
  return Array.from(paths).map((path) => ({ path }));
};

/**
 * Best-effort path extraction from raw tool input when the upstream doesn't send `locations`.
 *
 * This is intentionally heuristic: rawInput is unstructured by ACP spec and differs per agent.
 * We only try a small set of common keys to keep behavior predictable.
 */
export const deriveLocationsFromRawInput = (rawInput: unknown): ToolCallLocations | undefined => {
  if (!rawInput || typeof rawInput !== 'object') return undefined;
  const record = rawInput as Record<string, unknown>;

  const candidates: unknown[] = [
    record.path,
    record.file_path,
    record.filePath,
    record.absolute_file_path,
  ];

  const args = record.args;
  if (args && typeof args === 'object') {
    const argsRecord = args as Record<string, unknown>;
    candidates.push(
      argsRecord.path,
      argsRecord.file_path,
      argsRecord.filePath,
      argsRecord.absolute_file_path
    );
  }

  const unique = new Set<string>();
  for (const value of candidates) {
    if (typeof value !== 'string' || value.length === 0) continue;
    unique.add(value);
  }
  if (unique.size === 0) return undefined;
  return Array.from(unique).map((path) => ({ path }));
};

export const MAX_TOOL_HISTORY_TEXT_BYTES = 16 * 1024;
export const MAX_TOOL_HISTORY_JSON_BYTES = 32 * 1024;
export const MAX_TOOL_HISTORY_CONTENT_BYTES = 64 * 1024;
const OMITTED = '[Binary data omitted]';
const TRUNCATED = '\n[Tool history truncated]';
const encoder = new TextEncoder();

/** Remove encoded binary before terminal tail selection can discard its header. */
export const stripToolHistoryBinaryText = (text: string): string => {
  const cleaned = text
    .replace(/data:[\w.+-]+\/[\w.+-]+(?:;[^,\s]*)?,[^\s"'<>)]*/gi, OMITTED)
    .replace(/[A-Za-z0-9+/_=-]+/g, (token) => (token.length >= 4096 ? OMITTED : token));
  // Wrapped base64 has no spaces and long, regularly wrapped lines.
  if (
    cleaned.length >= 4096 &&
    /^(?:[A-Za-z0-9+/_=-]{64,}\r?\n)+[A-Za-z0-9+/_=-]*$/.test(cleaned.trim())
  )
    return OMITTED;
  return cleaned;
};

/** Bound display text without decoding binary data or splitting UTF-8 characters. */
export const sanitizeToolHistoryText = (text: string): string => {
  const cleaned = stripToolHistoryBinaryText(text);
  if (
    cleaned.length <= MAX_TOOL_HISTORY_TEXT_BYTES &&
    encoder.encode(cleaned).byteLength <= MAX_TOOL_HISTORY_TEXT_BYTES
  )
    return cleaned;
  let end = 0;
  let bytes = 0;
  const budget = MAX_TOOL_HISTORY_TEXT_BYTES - encoder.encode(TRUNCATED).byteLength;
  for (const point of cleaned) {
    const size = encoder.encode(point).byteLength;
    if (bytes + size > budget) break;
    bytes += size;
    end += point.length;
  }
  return cleaned.slice(0, end) + TRUNCATED;
};

/** Small opaque JSON survives; binary fields and oversized/deep extensions do not. */
export const sanitizeToolHistoryJson = (value: unknown): unknown => {
  let nodes = 0;
  const visit = (input: unknown, depth: number): unknown => {
    if (++nodes > 256 || depth > 8) return undefined;
    if (typeof input === 'string') return sanitizeToolHistoryText(input);
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number') return Number.isFinite(input) ? input : undefined;
    if (!input || typeof input !== 'object') return undefined;
    if (Array.isArray(input))
      return input.slice(0, 128).flatMap((item) => {
        const next = visit(item, depth + 1);
        return next === undefined ? [] : [next];
      });
    const record = input as Record<string, unknown>;
    if (record.type === 'image' || record.type === 'audio') return undefined;
    return Object.fromEntries(
      Object.entries(record)
        .slice(0, 128)
        .flatMap(([key, item]) => {
          if (key.length > 128 || key === 'base64' || key === 'blob') return [];
          const next = visit(item, depth + 1);
          return next === undefined ? [] : [[key, next]];
        })
    );
  };
  const result = visit(value, 0);
  return result !== undefined &&
    encoder.encode(JSON.stringify(result)).byteLength <= MAX_TOOL_HISTORY_JSON_BYTES
    ? result
    : undefined;
};

export const sanitizeToolHistoryRecord = (value: unknown): Record<string, unknown> | undefined => {
  const result = sanitizeToolHistoryJson(value);
  return result && typeof result === 'object' && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : undefined;
};

export const sanitizeToolHistoryLocations = (
  locations: ToolCallMessage['locations']
): ToolCallMessage['locations'] => {
  if (locations === undefined) return undefined;
  const cleaned = sanitizeToolHistoryJson(locations);
  if (!Array.isArray(cleaned)) return [];
  return cleaned.flatMap((location) => {
    const parsed = ToolCallLocationSchema.safeParse(location);
    return parsed.success ? [parsed.data] : [];
  });
};

/** Binary execution artifacts never become durable conversation attachments. */
export const stripToolCallBinaryForHistory = (content: ToolCallContent): ToolCallContent => {
  const result: ToolCallContent = [];
  let bytes = 2; // JSON array brackets, plus commas counted below.
  for (const block of content.slice(0, 128)) {
    // A partial old/new pair would invent a different diff. Omit an oversized
    // or binary diff instead; location/status remain on the owning tool.
    if (
      block.type === 'diff' &&
      [block.oldText, block.newText].some(
        (text) => typeof text === 'string' && sanitizeToolHistoryText(text) !== text
      )
    )
      continue;
    if (block.type === 'content') {
      if (block.content.type === 'image' || block.content.type === 'audio') continue;
      if (block.content.type === 'resource' && 'blob' in block.content.resource) continue;
      if (
        (block.content.type === 'resource_link' && /^\s*data:/i.test(block.content.uri)) ||
        (block.content.type === 'resource' && /^\s*data:/i.test(block.content.resource.uri))
      )
        continue;
    }
    const parsed = ToolCallContentSchema.safeParse(sanitizeToolHistoryJson(block));
    if (!parsed.success) continue;
    const size = encoder.encode(JSON.stringify(parsed.data)).byteLength + (result.length ? 1 : 0);
    if (bytes + size > MAX_TOOL_HISTORY_CONTENT_BYTES) break;
    bytes += size;
    result.push(parsed.data as ToolCallContent[number]);
  }
  return result;
};

/**
 * Removes large data payloads from tool call blocks before persisting to session history.
 *
 * We still keep:
 * - the command block (what was executed)
 * - terminal output (for non-read tools), later truncated to a bounded size elsewhere
 * - metadata such as status/title/locations
 */
export const stripToolCallContentForHistory = (
  kind: ToolCallKind,
  content: ToolCallContent
): ToolCallContent => {
  if (kind === 'read') {
    // Reading a file often returns the full file text. We keep only the command and the path.
    return stripToolCallBinaryForHistory(
      content.filter((block) => block.type === 'terminal_command')
    );
  }
  if (kind === 'edit') {
    // Edits often include full old/new text in `diff` blocks; don't persist that.
    // Some agents also emit a human-readable success `content` block; keep history lean by dropping it.
    return stripToolCallBinaryForHistory(
      content.filter((block) => block.type !== 'diff' && block.type !== 'content')
    );
  }
  return stripToolCallBinaryForHistory(content);
};
