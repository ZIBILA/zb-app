import { NextResponse } from 'next/server';
import {
  graphUrl,
  parseMetaError,
  validateTokenFormat,
  validatePixelIdFormat,
  META_GRAPH_API_VERSION,
} from '@/lib/metaErrors';
import { fetchMetaApi } from '@/lib/metaApiLogger';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Admin only: operational Meta diagnostics are never public.
  try { await requireAdmin(); } catch (authErr) { return handleAuthError(authErr); }
  const PIXEL_ID = process.env.META_PIXEL_ID;
  const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;

  // Validate configuration before making any requests
  const pixelError = validatePixelIdFormat(PIXEL_ID);
  if (pixelError) {
    return NextResponse.json(
      { error: { summary: 'Configuration Error', detail: pixelError, code: 'CONFIG_MISSING_PIXEL_ID' } },
      { status: 400 }
    );
  }

  const tokenError = validateTokenFormat(ACCESS_TOKEN);
  if (tokenError) {
    return NextResponse.json(
      { error: { summary: 'Configuration Error', detail: tokenError, code: 'CONFIG_MISSING_TOKEN' } },
      { status: 400 }
    );
  }

  try {
    // Fetch pixel info with all available fields in a single request.
    // Using event_time_max instead of the deprecated event_last_fired_time edge.
    // Using event_stats as a field instead of the separate /stats edge.
    const pixelFields = 'name,creation_time,id,event_time_max,event_time_min,event_stats';

    const { data: pixelData, logEntry: pixelLogEntry } = await fetchMetaApi(
      graphUrl(`/${PIXEL_ID}?fields=${pixelFields}&access_token=${ACCESS_TOKEN}`),
      { label: `GET /${PIXEL_ID} [dashboard]` }
    );

    // Check for errors in the primary pixel request
    if (!pixelLogEntry.success || pixelData?.error) {
      // If the combined request fails, try a minimal request to identify which fields are the problem
      const diagnostic = parseMetaError(pixelData, `GET /${PIXEL_ID}?fields=${pixelFields}`, pixelFields);
      console.error('[Meta Event Stats API Error]', JSON.stringify(diagnostic, null, 2));

      // Attempt a fallback with minimal fields
      let fallbackData: any = null;
      try {
        const { data: fb, logEntry: fbLog } = await fetchMetaApi(
          graphUrl(`/${PIXEL_ID}?fields=name,id,creation_time&access_token=${ACCESS_TOKEN}`),
          { label: `GET /${PIXEL_ID} [fallback]` }
        );
        if (fbLog.success && !fb?.error) {
          fallbackData = fb;
        }
      } catch {
        // Fallback also failed — return the original error
      }

      if (fallbackData) {
        // Return partial data from fallback + the original error as a warning
        return NextResponse.json({
          id: fallbackData.id || PIXEL_ID,
          name: fallbackData.name || null,
          creation_time: fallbackData.creation_time || null,
          event_time_max: null,
          event_time_min: null,
          event_stats: [],
          _sync: {
            timestamp: new Date().toISOString(),
            api_version: META_GRAPH_API_VERSION,
            pixel_ok: true,
            stats_ok: false,
            last_fired_ok: false,
          },
          _warnings: [diagnostic],
        });
      }

      return NextResponse.json(
        { error: diagnostic },
        { status: pixelLogEntry.httpStatus || 400 }
      );
    }

    // Build the response from the single request
    const response: Record<string, any> = {
      // Primary pixel info
      id: pixelData?.id || PIXEL_ID,
      name: pixelData?.name || null,
      creation_time: pixelData?.creation_time || null,

      // Timestamps from the pixel node
      event_time_max: pixelData?.event_time_max || null,
      event_time_min: pixelData?.event_time_min || null,

      // Formatted last fired time for dashboard display
      last_fired_time: pixelData?.event_time_max || null,

      // Event stats from the field (not the edge)
      event_stats: pixelData?.event_stats || [],

      // Legacy compat: wrap stats in { data: [...] }
      stats: { data: pixelData?.event_stats || [] },

      // Sync metadata
      _sync: {
        timestamp: new Date().toISOString(),
        api_version: META_GRAPH_API_VERSION,
        pixel_ok: !!pixelData?.id,
        stats_ok: Array.isArray(pixelData?.event_stats) && pixelData.event_stats.length > 0,
        last_fired_ok: !!pixelData?.event_time_max,
      },
    };

    return NextResponse.json(response);
  } catch (err: any) {
    console.error('[Meta Event Stats Catch Error]', err);
    return NextResponse.json(
      { error: { summary: 'Internal Server Error', detail: err.message || 'Failed to fetch event stats', code: 'INTERNAL_ERROR' } },
      { status: 500 }
    );
  }
}
