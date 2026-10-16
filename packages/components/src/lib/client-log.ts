/**
 * The renderer's own log of important events: crashes a boundary caught,
 * failures nothing else retries, and the page lifecycle around them. It lives
 * in IndexedDB so it survives the event it explains — an iOS WebView the system
 * killed and reloaded, a renderer that crashed — and rides along a
 * machine-backed bug report as its own section (`buildClientLogUpload`).
 *
 * Only what callers pass to `recordClientLog` / `recordClientError` is kept;
 * nothing intercepts `console`. Callers record events and identifiers, never
 * prompts, conversation text, or file contents. Every string is still passed
 * through `redactClientLogText`, which strips tokens from URLs and headers.
 *
 * Bounded twice: entries older than 48 hours are dropped, and the newest
 * 2 MiB are kept. A cache clear keeps the log (it is what explains why the
 * clear was needed); a full reset removes it with everything else.
 */
import { BUG_REPORT_CLIENT_LOG_LIMITS, type BugReportClientLog } from '@lody/shared/bug-report';
import { collectClientBuildInfo } from '@/lib/client-build-info';

export type ClientLogLevel = 'error' | 'warn' | 'info';
export type ClientLogDetails = Record<string, string | number | boolean | null | undefined>;

export const CLIENT_LOG_DATABASE = 'lody-client-log';
const STORE = 'entries';

export const CLIENT_LOG_LIMITS = {
  maxBytes: BUG_REPORT_CLIENT_LOG_LIMITS.maxRawBytes,
  maxAgeMs: 48 * 60 * 60 * 1000,
  /** One entry, stack included. */
  maxEntryBytes: 16 * 1024,
  /** Entries held in memory while IndexedDB is unavailable or a write is pending. */
  maxPendingEntries: 500,
} as const;

/** Device-local diagnostics, like `lody:lastActiveAt`: not in the cache-clear DELETE list. */
const BOOT_MARKER_KEY = 'lody:clientLog:boot';
const FLUSH_DELAY_MS = 1000;
const PRUNE_EVERY_FLUSHES = 20;

type StoredEntry = { at: number; bytes: number; line: string };

type BootMarker = {
  bootId: string;
  startedAt: number;
  visibility: string;
  changedAt: number;
  /** `pagehide` ran: the page went away the ordinary way. */
  ended: boolean;
};

const encoder = new TextEncoder();

let now: () => number = Date.now;
let bootId = createBootId();
let pending: StoredEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> = Promise.resolve();
let flushCount = 0;
let dbPromise: Promise<IDBDatabase | null> | null = null;
/** Kept when IndexedDB cannot be opened, under the same limits. */
let memoryEntries: StoredEntry[] = [];

function createBootId(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** This page load's id; every line carries it, so a reload reads as a new id. */
export function getClientLogBootId(): string {
  return bootId;
}

/**
 * Strip credentials a message can carry: bearer headers, JWTs, and token-like
 * query parameters. Applied to every string the log keeps.
 */
export function redactClientLogText(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu, '[jwt]')
    .replace(
      /([?&#](?:access_token|token|auth|code|key|sig|signature|jwt|ott|session|secret)[^=&#\s]*=)[^&#\s"']+/giu,
      '$1[redacted]'
    );
}

function truncateToBytes(text: string, maxBytes: number): string {
  if (encoder.encode(text).byteLength <= maxBytes) return text;
  const marker = '…[truncated]';
  let end = Math.min(text.length, maxBytes);
  while (end > 0 && encoder.encode(text.slice(0, end)).byteLength + marker.length > maxBytes) {
    end = Math.floor(end * 0.9);
  }
  return `${text.slice(0, end)}${marker}`;
}

function formatLine(
  at: number,
  level: ClientLogLevel,
  event: string,
  message: string | undefined,
  details: ClientLogDetails | undefined,
  stack: string | undefined
): string {
  const fields: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    if (value === undefined) continue;
    fields[key] = typeof value === 'string' ? redactClientLogText(value) : value;
  }
  let line = `${new Date(at).toISOString()} ${level.toUpperCase().padEnd(5)} ${bootId} ${event}`;
  if (message) line += ` ${redactClientLogText(message)}`;
  if (Object.keys(fields).length > 0) line += ` ${JSON.stringify(fields)}`;
  if (stack) {
    line += `\n${redactClientLogText(stack)
      .split('\n')
      .map((stackLine) => `    ${stackLine.trim()}`)
      .join('\n')}`;
  }
  return truncateToBytes(line, CLIENT_LOG_LIMITS.maxEntryBytes);
}

/**
 * Record one important event. Synchronous and never throws: it is called from
 * error paths, which must not fail because diagnostics did.
 */
export function recordClientLog(
  level: ClientLogLevel,
  event: string,
  message?: string,
  details?: ClientLogDetails,
  stack?: string
): void {
  try {
    const at = now();
    const line = formatLine(at, level, event, message, details, stack);
    pending.push({ at, line, bytes: encoder.encode(line).byteLength + 1 });
    if (pending.length > CLIENT_LOG_LIMITS.maxPendingEntries) {
      pending = pending.slice(-CLIENT_LOG_LIMITS.maxPendingEntries);
    }
    scheduleFlush(level === 'error' ? 0 : FLUSH_DELAY_MS);
  } catch {
    // Diagnostics only.
  }
}

/** Record a caught error with its name, message and stack. */
export function recordClientError(
  event: string,
  error: unknown,
  details?: ClientLogDetails,
  level: ClientLogLevel = 'error'
): void {
  const name =
    typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string'
      ? error.name
      : typeof error;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  recordClientLog(level, event, `${name}: ${message}`, details, stack);
}

function scheduleFlush(delayMs: number): void {
  if (flushTimer !== null) {
    if (delayMs > 0) return;
    clearTimeout(flushTimer);
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushClientLog();
  }, delayMs);
}

function openDatabase(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const request = indexedDB.open(CLIENT_LOG_DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { autoIncrement: true });
      };
      request.onsuccess = () => {
        const db = request.result;
        // A full reset deletes this database; let it.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Newest first, delete everything past the byte budget or the age limit. */
function pruneEntries(entries: StoredEntry[]): StoredEntry[] {
  const cutoff = now() - CLIENT_LOG_LIMITS.maxAgeMs;
  const kept: StoredEntry[] = [];
  let bytes = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.at < cutoff || bytes + entry.bytes > CLIENT_LOG_LIMITS.maxBytes) break;
    bytes += entry.bytes;
    kept.push(entry);
  }
  return kept.reverse();
}

async function pruneDatabase(db: IDBDatabase): Promise<void> {
  const transaction = db.transaction(STORE, 'readwrite');
  const store = transaction.objectStore(STORE);
  const cutoff = now() - CLIENT_LOG_LIMITS.maxAgeMs;
  let bytes = 0;
  let dropping = false;
  const request = store.openCursor(null, 'prev');
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const entry = cursor.value as StoredEntry;
    if (!dropping && (entry.at < cutoff || bytes + entry.bytes > CLIENT_LOG_LIMITS.maxBytes)) {
      dropping = true;
    }
    if (dropping) cursor.delete();
    else bytes += entry.bytes;
    cursor.continue();
  };
  await transactionDone(transaction);
}

/** Write pending entries now. Bug reports and page hides call this; it never rejects. */
export function flushClientLog(): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushing = flushing.then(async () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    try {
      const db = await openDatabase();
      if (!db) {
        memoryEntries = pruneEntries([...memoryEntries, ...batch]);
        return;
      }
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      for (const entry of batch) store.add(entry);
      await transactionDone(transaction);
      flushCount += 1;
      if (flushCount % PRUNE_EVERY_FLUSHES === 1) await pruneDatabase(db);
    } catch {
      memoryEntries = pruneEntries([...memoryEntries, ...batch]);
    }
  });
  return flushing;
}

async function readStoredEntries(): Promise<StoredEntry[]> {
  await flushClientLog();
  const db = await openDatabase();
  let stored: StoredEntry[] = [];
  if (db) {
    try {
      const transaction = db.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).getAll();
      await transactionDone(transaction);
      stored = request.result as StoredEntry[];
    } catch {
      stored = [];
    }
  }
  return pruneEntries([...stored, ...memoryEntries]);
}

/** The kept log, oldest first, within the age and byte limits. */
export async function readClientLog(): Promise<string> {
  const entries = await readStoredEntries();
  return entries.map((entry) => `${entry.line}\n`).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const body = new Response(buffer).body;
  if (!body) throw new Error('No readable body to compress.');
  return new Uint8Array(
    await new Response(body.pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
  );
}

/**
 * The log as a bug report carries it, or `null` when there is nothing to send
 * or this engine cannot compress. Keeps the newest lines that fit both the raw
 * and the compressed budget.
 */
export async function buildClientLogUpload(): Promise<BugReportClientLog | null> {
  if (typeof CompressionStream === 'undefined') return null;
  let entries = await readStoredEntries();
  while (entries.length > 0) {
    const raw = encoder.encode(entries.map((entry) => `${entry.line}\n`).join(''));
    if (raw.byteLength <= BUG_REPORT_CLIENT_LOG_LIMITS.maxRawBytes) {
      const compressed = await gzip(raw);
      if (compressed.byteLength <= BUG_REPORT_CLIENT_LOG_LIMITS.maxCompressedBytes) {
        return {
          encoding: 'gzip-base64',
          data: bytesToBase64(compressed),
          rawBytes: raw.byteLength,
          compressedBytes: compressed.byteLength,
        };
      }
    }
    // Over a budget: drop the older half and try again.
    entries = entries.slice(Math.ceil(entries.length / 2));
  }
  return null;
}

function readBootMarker(): BootMarker | null {
  try {
    const raw = localStorage.getItem(BOOT_MARKER_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<BootMarker>;
    return typeof value.bootId === 'string' &&
      typeof value.startedAt === 'number' &&
      typeof value.changedAt === 'number'
      ? {
          bootId: value.bootId,
          startedAt: value.startedAt,
          visibility: typeof value.visibility === 'string' ? value.visibility : 'unknown',
          changedAt: value.changedAt,
          ended: value.ended === true,
        }
      : null;
  } catch {
    return null;
  }
}

function writeBootMarker(marker: BootMarker): void {
  try {
    localStorage.setItem(BOOT_MARKER_KEY, JSON.stringify(marker));
  } catch {
    // Diagnostics only.
  }
}

function readNavigationType(): string | null {
  try {
    const entry = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    return entry?.type ?? null;
  } catch {
    return null;
  }
}

function stripQuery(url: string | undefined): string | undefined {
  return url?.split(/[?#]/u)[0];
}

/**
 * Mounted once by `AppInitializer`. Records the boot, reports a previous page
 * that never reached `pagehide` (the WebView or renderer was killed), and logs
 * uncaught errors and the visibility changes around them.
 */
export function installClientLog(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  const previous = readBootMarker();
  if (previous && !previous.ended) {
    recordClientLog('warn', 'page.previous_ended_without_unload', undefined, {
      previousBootId: previous.bootId,
      previousStartedAt: new Date(previous.startedAt).toISOString(),
      lastVisibility: previous.visibility,
      lastVisibilityAt: new Date(previous.changedAt).toISOString(),
    });
  }
  const startedAt = now();
  const marker: BootMarker = {
    bootId,
    startedAt,
    visibility: document.visibilityState,
    changedAt: startedAt,
    ended: false,
  };
  writeBootMarker(marker);
  const build = collectClientBuildInfo();
  recordClientLog('info', 'page.boot', undefined, {
    navigationType: readNavigationType(),
    visibility: document.visibilityState,
    path: window.location.pathname,
    appVersion: build.appVersion,
    build: build.build,
    userAgent: navigator.userAgent,
  });

  const onError = (event: ErrorEvent) => {
    recordClientLog(
      'error',
      'window.error',
      event.message,
      {
        source: stripQuery(event.filename),
        line: event.lineno,
        column: event.colno,
      },
      event.error instanceof Error ? event.error.stack : undefined
    );
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    recordClientError('window.unhandled_rejection', event.reason);
  };
  const onVisibilityChange = () => {
    marker.visibility = document.visibilityState;
    marker.changedAt = now();
    writeBootMarker(marker);
    recordClientLog('info', 'page.visibility', document.visibilityState);
    if (document.visibilityState === 'hidden') void flushClientLog();
  };
  const onPageHide = (event: PageTransitionEvent) => {
    marker.ended = true;
    marker.changedAt = now();
    writeBootMarker(marker);
    recordClientLog('info', 'page.hide', undefined, { persisted: event.persisted });
    void flushClientLog();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    // Restored from the back/forward cache: the same page is alive again.
    marker.ended = false;
    marker.changedAt = now();
    writeBootMarker(marker);
    recordClientLog('info', 'page.restored');
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  };
}

/**
 * Test-only: start a new page load. The database and boot marker stay, as they
 * would across a real reload.
 */
export async function simulateClientLogReloadForTests(clock?: () => number): Promise<void> {
  await flushClientLog();
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  const db = await dbPromise;
  db?.close();
  dbPromise = null;
  pending = [];
  memoryEntries = [];
  flushCount = 0;
  bootId = createBootId();
  if (clock) now = clock;
}

/** Test-only: forget everything, including the database. */
export async function resetClientLogForTests(clock: () => number = Date.now): Promise<void> {
  await simulateClientLogReloadForTests(clock);
  try {
    localStorage.removeItem(BOOT_MARKER_KEY);
  } catch {
    // ignore
  }
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(CLIENT_LOG_DATABASE);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
