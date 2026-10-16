import { z } from 'zod';

export const BUG_REPORT_LOG_PATH_PREFIX = '/bug-report-logs/workspaces/';

export const buildBugReportLogObjectKey = (workspaceId: string, logId: string): string =>
  `bug-reports/${workspaceId}/${logId}.log`;

export const buildBugReportLogPath = (workspaceId: string, logId: string): string =>
  `${BUG_REPORT_LOG_PATH_PREFIX}${encodeURIComponent(workspaceId)}/${encodeURIComponent(logId)}`;

export const parseBugReportLogPath = (
  pathname: string
): { workspaceId: string; logId: string } | null => {
  if (!pathname.startsWith(BUG_REPORT_LOG_PATH_PREFIX)) {
    return null;
  }
  const rest = pathname.slice(BUG_REPORT_LOG_PATH_PREFIX.length);
  const segments = rest.split('/').filter(Boolean);
  if (segments.length !== 2) {
    return null;
  }
  try {
    const workspaceId = decodeURIComponent(segments[0] ?? '');
    const logId = decodeURIComponent(segments[1] ?? '');
    if (!workspaceId || !logId) {
      return null;
    }
    return { workspaceId, logId };
  } catch {
    return null;
  }
};

/**
 * Budgets for the renderer's own log riding along a machine-backed bug report.
 * The raw bound matches what the client keeps (2 MiB or 48 hours); the
 * compressed bound matches the 1 MiB Code Collab / file-preview payload that
 * already crosses the Loro Streams request path.
 */
export const BUG_REPORT_CLIENT_LOG_LIMITS = {
  maxRawBytes: 2 * 1024 * 1024,
  maxCompressedBytes: 1024 * 1024,
} as const;

/** The client log as sent in `machine/bug-report`: UTF-8 text, gzipped, base64. */
export const BugReportClientLogSchema = z
  .object({
    encoding: z.literal('gzip-base64'),
    data: z.string().min(1),
    rawBytes: z.number().int().positive().max(BUG_REPORT_CLIENT_LOG_LIMITS.maxRawBytes),
    compressedBytes: z
      .number()
      .int()
      .positive()
      .max(BUG_REPORT_CLIENT_LOG_LIMITS.maxCompressedBytes),
  })
  .strict();
export type BugReportClientLog = z.infer<typeof BugReportClientLogSchema>;
