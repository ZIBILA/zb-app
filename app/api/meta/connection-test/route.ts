import { NextResponse } from 'next/server';
import {
  graphUrl,
  parseMetaError,
  validateTokenFormat,
  validatePixelIdFormat,
  tokenSummary,
  META_GRAPH_API_VERSION,
} from '@/lib/metaErrors';
import { fetchMetaApi } from '@/lib/metaApiLogger';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  detail?: string;
}

export async function GET() {
  // Admin only: operational Meta diagnostics are never public.
  try { await requireAdmin(); } catch (authErr) { return handleAuthError(authErr); }
  const PIXEL_ID = process.env.META_PIXEL_ID;
  const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;
  const META_APP_ID = process.env.META_APP_ID;

  const checks: CheckResult[] = [];

  // ────────────────────────────────────────
  // 1. Check META_PIXEL_ID is configured
  // ────────────────────────────────────────
  const pixelError = validatePixelIdFormat(PIXEL_ID);
  if (pixelError) {
    checks.push({ name: 'Pixel ID Configuration', status: 'fail', message: pixelError });
  } else {
    checks.push({ name: 'Pixel ID Configuration', status: 'pass', message: `META_PIXEL_ID is set: ${PIXEL_ID}` });
  }

  // ────────────────────────────────────────
  // 2. Check META_CAPI_ACCESS_TOKEN is configured
  // ────────────────────────────────────────
  const tokenError = validateTokenFormat(ACCESS_TOKEN);
  if (tokenError) {
    checks.push({ name: 'Access Token Configuration', status: 'fail', message: tokenError });
  } else {
    checks.push({
      name: 'Access Token Configuration',
      status: 'pass',
      message: `META_CAPI_ACCESS_TOKEN is set (${tokenSummary(ACCESS_TOKEN)})`,
    });
  }

  // If either config is missing, we can't proceed with API checks
  if (pixelError || tokenError) {
    return NextResponse.json({
      overall: 'fail',
      checks,
      api_version: META_GRAPH_API_VERSION,
      timestamp: new Date().toISOString(),
    });
  }

  // ────────────────────────────────────────
  // 3. Test Graph API Connectivity
  // ────────────────────────────────────────
  let meData: any = null;
  try {
    const { data: connectData, logEntry } = await fetchMetaApi(
      graphUrl(`/me?access_token=${ACCESS_TOKEN}`),
      { label: 'GET /me' }
    );

    if (logEntry.success && connectData && !connectData.error) {
      meData = connectData;
      checks.push({
        name: 'Graph API Connectivity',
        status: 'pass',
        message: `Connected to Graph API ${META_GRAPH_API_VERSION} successfully`,
        detail: connectData.name ? `Authenticated as: ${connectData.name} (ID: ${connectData.id})` : `Token ID: ${connectData.id}`,
      });
    } else if (connectData?.error) {
      const diagnostic = parseMetaError(connectData, '/me');
      checks.push({
        name: 'Graph API Connectivity',
        status: 'fail',
        message: diagnostic.summary,
        detail: `${diagnostic.detail}\n\nFix: ${diagnostic.fix}`,
      });
    } else {
      checks.push({
        name: 'Graph API Connectivity',
        status: 'fail',
        message: `Graph API returned HTTP ${logEntry.httpStatus}`,
      });
    }
  } catch (err: any) {
    checks.push({
      name: 'Graph API Connectivity',
      status: 'fail',
      message: `Network error connecting to Graph API: ${err.message}`,
    });
  }

  // ────────────────────────────────────────
  // 4. Token Debug Info (app_id, scopes, expiry)
  // ────────────────────────────────────────
  let tokenDebugData: any = null;
  try {
    // Use the app token approach: input_token + access_token for debug_token
    const debugUrl = graphUrl(`/debug_token?input_token=${ACCESS_TOKEN}&access_token=${ACCESS_TOKEN}`);
    const { data: debugData, logEntry } = await fetchMetaApi(debugUrl, { label: 'GET /debug_token' });

    if (logEntry.success && debugData?.data) {
      tokenDebugData = debugData.data;
      const scopes = debugData.data.scopes?.join(', ') || 'none listed';
      const appId = debugData.data.app_id || 'unknown';
      const isValid = debugData.data.is_valid;
      const expiresAt = debugData.data.expires_at;
      const type = debugData.data.type || 'unknown';

      let expiryStr = 'never (non-expiring)';
      if (expiresAt && expiresAt > 0) {
        const expiryDate = new Date(expiresAt * 1000);
        const now = new Date();
        if (expiryDate < now) {
          expiryStr = `EXPIRED on ${expiryDate.toISOString()}`;
        } else {
          const daysLeft = Math.round((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          expiryStr = `${expiryDate.toISOString()} (${daysLeft} days remaining)`;
        }
      }

      if (isValid === false) {
        checks.push({
          name: 'Token Debug Info',
          status: 'fail',
          message: 'Token is marked as INVALID by Meta',
          detail: `App ID: ${appId}\nType: ${type}\nExpires: ${expiryStr}\nScopes: ${scopes}`,
        });
      } else {
        const hasAdsRead = debugData.data.scopes?.includes('ads_read');
        const hasBusinessMgmt = debugData.data.scopes?.includes('business_management');

        checks.push({
          name: 'Token Debug Info',
          status: hasAdsRead ? 'pass' : 'warn',
          message: hasAdsRead
            ? `Valid token — Type: ${type}, App: ${appId}, Scopes include ads_read`
            : `Valid token but missing ads_read scope — Type: ${type}, App: ${appId}`,
          detail: `Scopes: ${scopes}\nExpires: ${expiryStr}${!hasBusinessMgmt ? '\n⚠ Missing business_management scope' : ''}`,
        });
      }
    } else if (debugData?.error) {
      // debug_token can fail for some token types — non-critical
      checks.push({
        name: 'Token Debug Info',
        status: 'warn',
        message: `Could not debug token: ${debugData.error.message}`,
        detail: 'This can be normal for certain System User token types.',
      });
    }
  } catch (err: any) {
    checks.push({
      name: 'Token Debug Info',
      status: 'warn',
      message: `Could not check token debug info: ${err.message}`,
    });
  }

  // ────────────────────────────────────────
  // 5. Test Token Permissions
  // ────────────────────────────────────────
  try {
    const { data: permData, logEntry } = await fetchMetaApi(
      graphUrl(`/me/permissions?access_token=${ACCESS_TOKEN}`),
      { label: 'GET /me/permissions' }
    );

    if (logEntry.success && permData?.data) {
      const perms = permData.data as Array<{ permission: string; status: string }>;
      const grantedPerms = perms.filter(p => p.status === 'granted').map(p => p.permission);
      const declinedPerms = perms.filter(p => p.status === 'declined').map(p => p.permission);

      const hasAdsRead = grantedPerms.includes('ads_read');
      const hasAdsManagement = grantedPerms.includes('ads_management');

      if (hasAdsRead || hasAdsManagement) {
        checks.push({
          name: 'Token Permissions',
          status: 'pass',
          message: `Granted: ${grantedPerms.join(', ')}`,
          detail: declinedPerms.length > 0 ? `Declined: ${declinedPerms.join(', ')}` : undefined,
        });
      } else {
        // System User tokens may not return permissions via /me/permissions
        // but can still access pixels directly — mark as warning, not fail
        checks.push({
          name: 'Token Permissions',
          status: 'warn',
          message: 'Could not confirm ads_read permission via /me/permissions. System User tokens may not list permissions here — will verify via direct Pixel access.',
          detail: `Returned permissions: ${grantedPerms.length > 0 ? grantedPerms.join(', ') : 'none listed'}`,
        });
      }
    } else if (permData?.error) {
      // System User tokens sometimes can't access /me/permissions — not a critical failure
      checks.push({
        name: 'Token Permissions',
        status: 'warn',
        message: `Could not query /me/permissions: ${permData.error.message}. This is normal for some System User tokens.`,
      });
    }
  } catch (err: any) {
    checks.push({
      name: 'Token Permissions',
      status: 'warn',
      message: `Could not check permissions: ${err.message}`,
    });
  }

  // ────────────────────────────────────────
  // 6. Business Manager verification
  // ────────────────────────────────────────
  try {
    const { data: bizData, logEntry } = await fetchMetaApi(
      graphUrl(`/me/businesses?access_token=${ACCESS_TOKEN}`),
      { label: 'GET /me/businesses' }
    );

    if (logEntry.success && bizData?.data && Array.isArray(bizData.data)) {
      if (bizData.data.length > 0) {
        const bizNames = bizData.data.map((b: any) => `${b.name} (${b.id})`).join(', ');
        checks.push({
          name: 'Business Manager',
          status: 'pass',
          message: `Connected to ${bizData.data.length} Business Manager(s)`,
          detail: bizNames,
        });
      } else {
        checks.push({
          name: 'Business Manager',
          status: 'warn',
          message: 'No Business Managers found for this token. System User tokens may not list businesses via this endpoint.',
        });
      }
    } else if (bizData?.error) {
      const diagnostic = parseMetaError(bizData, 'GET /me/businesses');
      checks.push({
        name: 'Business Manager',
        status: 'warn',
        message: `Could not query Business Managers: ${diagnostic.summary}`,
        detail: diagnostic.detail,
      });
    }
  } catch (err: any) {
    checks.push({
      name: 'Business Manager',
      status: 'warn',
      message: `Could not check Business Manager: ${err.message}`,
    });
  }

  // ────────────────────────────────────────
  // 7. Test Pixel/Dataset Accessibility
  // ────────────────────────────────────────
  const pixelFields = 'name,id,creation_time,event_time_max,event_time_min';
  try {
    const { data: pixelData, logEntry } = await fetchMetaApi(
      graphUrl(`/${PIXEL_ID}?fields=${pixelFields}&access_token=${ACCESS_TOKEN}`),
      { label: `GET /${PIXEL_ID}` }
    );

    if (logEntry.success && pixelData && !pixelData.error) {
      checks.push({
        name: 'Pixel/Dataset Access',
        status: 'pass',
        message: `Pixel accessible: "${pixelData.name}" (ID: ${pixelData.id})`,
        detail: [
          pixelData.creation_time ? `Created: ${pixelData.creation_time}` : null,
          pixelData.event_time_max ? `Last event: ${new Date(pixelData.event_time_max * 1000).toISOString()}` : null,
          pixelData.event_time_min ? `First event: ${new Date(pixelData.event_time_min * 1000).toISOString()}` : null,
        ].filter(Boolean).join('\n'),
      });
    } else if (pixelData?.error) {
      const diagnostic = parseMetaError(pixelData, `GET /${PIXEL_ID}`, pixelFields);
      checks.push({
        name: 'Pixel/Dataset Access',
        status: 'fail',
        message: diagnostic.summary,
        detail: `${diagnostic.detail}\n\nFix: ${diagnostic.fix}${diagnostic.fbtrace_id ? `\n\nRequest ID: ${diagnostic.fbtrace_id}` : ''}`,
      });
    } else {
      checks.push({
        name: 'Pixel/Dataset Access',
        status: 'fail',
        message: `Pixel request returned HTTP ${logEntry.httpStatus}`,
      });
    }
  } catch (err: any) {
    checks.push({
      name: 'Pixel/Dataset Access',
      status: 'fail',
      message: `Network error accessing pixel: ${err.message}`,
    });
  }

  // ────────────────────────────────────────
  // 8. Dataset Info (event_stats field)
  // ────────────────────────────────────────
  try {
    const { data: statsData, logEntry } = await fetchMetaApi(
      graphUrl(`/${PIXEL_ID}?fields=event_stats&access_token=${ACCESS_TOKEN}`),
      { label: `GET /${PIXEL_ID}?fields=event_stats` }
    );

    if (logEntry.success && statsData && !statsData.error) {
      const eventStats = statsData.event_stats;
      const statCount = Array.isArray(eventStats) ? eventStats.length : 0;
      checks.push({
        name: 'Dataset Event Stats',
        status: 'pass',
        message: `event_stats field accessible. ${statCount} event type(s) returned.`,
      });
    } else if (statsData?.error) {
      const diagnostic = parseMetaError(statsData, `GET /${PIXEL_ID}?fields=event_stats`, 'event_stats');
      checks.push({
        name: 'Dataset Event Stats',
        status: 'warn',
        message: `event_stats returned error: ${diagnostic.summary}`,
        detail: diagnostic.detail,
      });
    }
  } catch (err: any) {
    checks.push({
      name: 'Dataset Event Stats',
      status: 'warn',
      message: `Could not access event_stats: ${err.message}`,
    });
  }

  // ────────────────────────────────────────
  // 9. Test CAPI Event Sending
  // ────────────────────────────────────────
  try {
    const capiUrl = graphUrl(`/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`);
    const testPayload = {
      data: [
        {
          event_name: 'PageView',
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          event_source_url: 'https://zicabella.com',
          user_data: {
            client_user_agent: 'Meta-Connection-Test/1.0',
            client_ip_address: '127.0.0.1',
          },
        },
      ],
      test_event_code: 'CONNECTION_TEST_' + Date.now(),
    };

    const { data: capiData, logEntry } = await fetchMetaApi(capiUrl, {
      method: 'POST',
      body: testPayload,
      label: `POST /${PIXEL_ID}/events [test]`,
    });

    if (logEntry.success && capiData && !capiData.error) {
      checks.push({
        name: 'Conversions API (CAPI)',
        status: 'pass',
        message: `CAPI endpoint is accessible. Events processed: ${capiData.events_received || 0}`,
      });
    } else if (capiData?.error) {
      const diagnostic = parseMetaError(capiData, `POST /${PIXEL_ID}/events`);
      checks.push({
        name: 'Conversions API (CAPI)',
        status: 'fail',
        message: `CAPI error: ${diagnostic.summary}`,
        detail: `${diagnostic.detail}\n\nFix: ${diagnostic.fix}`,
      });
    }
  } catch (err: any) {
    checks.push({
      name: 'Conversions API (CAPI)',
      status: 'warn',
      message: `Could not test CAPI endpoint: ${err.message}`,
    });
  }

  // ────────────────────────────────────────
  // 10. Asset Assignment Check
  // ────────────────────────────────────────
  try {
    const { data: assignData, logEntry } = await fetchMetaApi(
      graphUrl(`/${PIXEL_ID}/assigned_users?access_token=${ACCESS_TOKEN}`),
      { label: `GET /${PIXEL_ID}/assigned_users` }
    );

    if (logEntry.success && assignData?.data && Array.isArray(assignData.data)) {
      if (assignData.data.length > 0) {
        const userNames = assignData.data.map((u: any) => `${u.name || u.id} (${u.role || 'unknown role'})`).join(', ');
        checks.push({
          name: 'Asset Assignment',
          status: 'pass',
          message: `${assignData.data.length} user(s) assigned to this Pixel`,
          detail: userNames,
        });
      } else {
        checks.push({
          name: 'Asset Assignment',
          status: 'warn',
          message: 'No users are assigned to this Pixel. The System User may need to be explicitly assigned.',
          detail: 'Go to Business Manager → Business Settings → System Users → [Your System User] → Assign Assets → Select this Pixel.',
        });
      }
    } else if (assignData?.error) {
      const diagnostic = parseMetaError(assignData, `GET /${PIXEL_ID}/assigned_users`);
      // assigned_users failing is often the same root cause as the pixel access failure
      checks.push({
        name: 'Asset Assignment',
        status: 'warn',
        message: `Could not check asset assignment: ${diagnostic.summary}`,
        detail: `${diagnostic.detail}\n\nThis usually means the System User does not have access to this Pixel, which is the root cause of other failures.`,
      });
    }
  } catch (err: any) {
    checks.push({
      name: 'Asset Assignment',
      status: 'warn',
      message: `Could not check asset assignment: ${err.message}`,
    });
  }

  // Calculate overall status — one fail = warn for overall (not fail), unless critical checks fail
  const hasFail = checks.some(c => c.status === 'fail');
  const hasWarn = checks.some(c => c.status === 'warn');
  const criticalFails = checks.filter(c =>
    c.status === 'fail' && ['Graph API Connectivity', 'Access Token Configuration', 'Pixel ID Configuration'].includes(c.name)
  );

  let overallStatus: 'pass' | 'fail' | 'warn' = 'pass';
  if (criticalFails.length > 0) {
    overallStatus = 'fail';
  } else if (hasFail) {
    overallStatus = 'warn';
  } else if (hasWarn) {
    overallStatus = 'warn';
  }

  // ────────────────────────────────────────
  // Root Cause Detection: Permission cascade pattern
  // When CAPI works but Business Manager / Pixel Access / Asset Assignment
  // fail with #100 errors, the root cause is always the same: the System User
  // doesn't have the Pixel assigned as an asset in Business Manager.
  // ────────────────────────────────────────
  let rootCauseSummary: string | null = null;

  const capiCheck = checks.find(c => c.name === 'Conversions API (CAPI)');
  const capiPassed = capiCheck?.status === 'pass';

  const permissionFailNames = ['Business Manager', 'Pixel/Dataset Access', 'Asset Assignment', 'Dataset Event Stats'];
  const permissionFails = checks.filter(c =>
    permissionFailNames.includes(c.name) && (c.status === 'fail' || c.status === 'warn')
  );

  if (capiPassed && permissionFails.length >= 2) {
    rootCauseSummary = [
      'Root cause: The Pixel/Dataset is not assigned to your System User in Business Manager.',
      '',
      'CAPI event sending works correctly — your events are being delivered to Meta.',
      'However, advanced diagnostic queries (Business Manager access, Pixel metadata, event stats, asset assignments) fail because the System User token lacks the required permissions.',
      '',
      'Required fix (manual step in Meta Business Manager):',
      '1. Go to Meta Business Manager → Business Settings → System Users',
      '2. Select the System User that owns this access token',
      '3. Click "Add Assets" → Select "Pixels" → Choose "' + (PIXEL_ID || 'your pixel') + '" → Grant Full Control',
      '4. Ensure the System User has ads_read and business_management permissions',
      '5. Regenerate the System User Access Token with those scopes',
      '6. Update META_CAPI_ACCESS_TOKEN in your environment variables',
    ].join('\n');
  }

  // ────────────────────────────────────────
  // Scope Validation: Compare required vs granted
  // ────────────────────────────────────────
  const requiredScopes = ['ads_read', 'business_management'];
  const grantedScopes = tokenDebugData?.scopes || [];
  const missingScopes = requiredScopes.filter(s => !grantedScopes.includes(s));

  if (missingScopes.length > 0) {
    checks.push({
      name: 'Required Scope Validation',
      status: 'warn',
      message: `Missing required scopes: ${missingScopes.join(', ')}`,
      detail: `Required: ${requiredScopes.join(', ')}\nGranted: ${grantedScopes.join(', ') || 'none detected'}\n\nTo fix: Regenerate the System User Access Token in Meta Business Manager with the missing scopes enabled.`,
    });
  } else if (grantedScopes.length > 0) {
    checks.push({
      name: 'Required Scope Validation',
      status: 'pass',
      message: `All required scopes present: ${requiredScopes.join(', ')}`,
    });
  }

  return NextResponse.json({
    overall: overallStatus,
    checks,
    root_cause_summary: rootCauseSummary,
    api_version: META_GRAPH_API_VERSION,
    pixel_id: PIXEL_ID,
    app_id: META_APP_ID || null,
    token_debug: tokenDebugData || null,
    timestamp: new Date().toISOString(),
  });
}
