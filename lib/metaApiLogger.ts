/**
 * Meta API Request Logger
 * In-memory ring buffer that stores the last 200 Meta Graph API requests
 * for dashboard troubleshooting. Not persisted across restarts.
 */

export interface MetaApiLogEntry {
  timestamp: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'DELETE';
  fields?: string;
  httpStatus: number;
  errorCode?: number;
  errorSubcode?: number;
  errorMessage?: string;
  fbtrace_id?: string;
  response_time_ms: number;
  success: boolean;
  /** Truncated response body for debugging */
  responsePreview?: string;
}

const MAX_LOG_ENTRIES = 200;
const logBuffer: MetaApiLogEntry[] = [];

/**
 * Add a log entry to the ring buffer.
 */
export function logMetaApiRequest(entry: MetaApiLogEntry): void {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.shift();
  }
}

/**
 * Get all log entries (newest first).
 */
export function getMetaApiLogs(): MetaApiLogEntry[] {
  return [...logBuffer].reverse();
}

/**
 * Clear all log entries.
 */
export function clearMetaApiLogs(): void {
  logBuffer.length = 0;
}

/**
 * Get log summary stats.
 */
export function getMetaApiLogStats(): {
  total: number;
  successes: number;
  failures: number;
  avgResponseMs: number;
  lastRequestAt: string | null;
} {
  const total = logBuffer.length;
  const successes = logBuffer.filter(e => e.success).length;
  const failures = total - successes;
  const avgResponseMs = total > 0
    ? Math.round(logBuffer.reduce((sum, e) => sum + e.response_time_ms, 0) / total)
    : 0;
  const lastRequestAt = total > 0 ? logBuffer[total - 1].timestamp : null;

  return { total, successes, failures, avgResponseMs, lastRequestAt };
}

/**
 * Wrapper: execute a Meta Graph API fetch, log it, and return the result.
 * This is the primary way to make logged Meta API requests.
 */
export async function fetchMetaApi(
  url: string,
  options?: {
    method?: 'GET' | 'POST' | 'DELETE';
    body?: any;
    /** Human-readable label for logs, e.g. "GET /PIXEL_ID" */
    label?: string;
  }
): Promise<{ response: Response; data: any; logEntry: MetaApiLogEntry }> {
  const method = options?.method || 'GET';
  const startMs = Date.now();

  // Extract fields from URL for logging
  const urlObj = new URL(url);
  const fields = urlObj.searchParams.get('fields') || undefined;
  // Remove access token from the logged endpoint for security
  urlObj.searchParams.delete('access_token');
  const cleanEndpoint = options?.label || urlObj.pathname + (urlObj.search ? urlObj.search : '');

  let response: Response;
  let data: any;
  let httpStatus = 0;

  try {
    const fetchOptions: RequestInit = {
      method,
      cache: 'no-store',
    };

    if (options?.body) {
      fetchOptions.headers = { 'Content-Type': 'application/json' };
      fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    response = await fetch(url, fetchOptions);
    httpStatus = response.status;
    data = await response.json().catch(() => ({}));
  } catch (err: any) {
    const elapsed = Date.now() - startMs;
    const entry: MetaApiLogEntry = {
      timestamp: new Date().toISOString(),
      endpoint: cleanEndpoint,
      method,
      fields,
      httpStatus: 0,
      errorMessage: `Network error: ${err.message}`,
      response_time_ms: elapsed,
      success: false,
    };
    logMetaApiRequest(entry);
    console.error(`[Meta API] ${method} ${cleanEndpoint} — NETWORK ERROR (${elapsed}ms):`, err.message);
    throw err;
  }

  const elapsed = Date.now() - startMs;
  const hasError = !!data?.error;
  const entry: MetaApiLogEntry = {
    timestamp: new Date().toISOString(),
    endpoint: cleanEndpoint,
    method,
    fields,
    httpStatus,
    errorCode: data?.error?.code,
    errorSubcode: data?.error?.error_subcode || data?.error?.subcode,
    errorMessage: data?.error?.message,
    fbtrace_id: data?.error?.fbtrace_id || response.headers?.get('x-fb-trace-id') || undefined,
    response_time_ms: elapsed,
    success: response.ok && !hasError,
    responsePreview: JSON.stringify(data).slice(0, 500),
  };

  logMetaApiRequest(entry);

  if (hasError) {
    console.warn(`[Meta API] ${method} ${cleanEndpoint} — ERROR ${data.error.code} (${elapsed}ms): ${data.error.message}`);
  } else {
    console.log(`[Meta API] ${method} ${cleanEndpoint} — ${httpStatus} OK (${elapsed}ms)`);
  }

  return { response, data, logEntry: entry };
}
