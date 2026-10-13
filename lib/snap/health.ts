/**
 * Turns the outcome of a Snap retry run (and the current configuration) into the
 * list of things a human has to act on. An empty list = healthy.
 *
 * The retry endpoint answers `ok: false` with these alerts, and the scheduled
 * workflow (.github/workflows/snap-conversions.yml) then fails its run so GitHub
 * notifies the maintainers — a missing or refused access token can no longer go
 * unnoticed. Messages name the variable to fix and never contain a secret.
 */
import { MAX_ATTEMPTS } from '@/lib/snap/ledger';
import { describeSnapToken, snapCapiConfigError, type SnapProbeResult } from '@/lib/snap-capi';

export type SnapTally = Record<string, number>;

export interface SnapHealthState {
  /** Why the website Conversions API cannot send (pixel id / token), or null. */
  configError: string | null;
  /** The configured token is the one that was published in the Git history. */
  exposedToken: boolean;
}

export function currentSnapHealthState(): SnapHealthState {
  return { configError: snapCapiConfigError(), exposedToken: describeSnapToken().exposed };
}

export function snapDeliveryAlerts(
  run: { web?: SnapTally; app?: SnapTally; probe?: SnapProbeResult },
  state: SnapHealthState = currentSnapHealthState(),
): string[] {
  const web = run.web || {};
  const app = run.app || {};
  const alerts: string[] = [];

  if (state.configError) {
    alerts.push(`snap_config_missing: ${state.configError} — no server event (including Purchase) is reaching Snapchat`);
  }
  if (state.exposedToken) {
    alerts.push('snap_token_exposed: SNAP_CAPI_ACCESS_TOKEN is the token that was published in the Git history — delete it in Snapchat (Business Details → Conversions API Tokens) and set a new one');
  }
  if (web.blocked_auth || run.probe?.state === 'auth_rejected') {
    alerts.push('snap_auth_rejected: Snapchat refused SNAP_CAPI_ACCESS_TOKEN — create a new Conversions API token for the pixel and update the server variable (unsent Purchases are kept and retried)');
  }
  if (app.blocked_auth) {
    alerts.push('snap_app_auth_rejected: Snapchat refused the access token for the native-app events (SNAP_APP_CAPI_ACCESS_TOKEN, or SNAP_CAPI_ACCESS_TOKEN when it is unset)');
  }
  const exhausted = (web.exhausted || 0) + (app.exhausted || 0);
  if (exhausted) {
    alerts.push(`attempts_exhausted: ${exhausted} Purchase(s) could not be delivered to Snapchat after ${MAX_ATTEMPTS} attempts and were closed (website ${web.exhausted || 0}, app ${app.exhausted || 0}) — the reason is in the server log and in ad_conversion_deliveries.lastError`);
  }
  if (web.ledger_table_missing || app.ledger_table_missing) {
    alerts.push('ledger_table_missing: table ad_conversion_deliveries does not exist — apply migration 20261009010000_snap_delivery_and_newsletter');
  }
  if (web.ledger_error || app.ledger_error) {
    alerts.push('ledger_error: the delivery ledger could not be read or written — see the server log');
  }
  return alerts;
}
