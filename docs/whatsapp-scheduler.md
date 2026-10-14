# WhatsApp Automation Scheduler Trigger Setup

This document describes how the automated WhatsApp queue (abandoned cart sequences, template retry queue) is triggered in production.

## Architecture

The endpoint `/api/cron/whatsapp-scheduler` processes campaigns, standard message retries, campaign recipient retries, and automated cart recoveries.

In production, the scheduler is triggered by a **GitHub Actions Scheduled Workflow** running every **5 minutes**. This cadence satisfies the business requirement of recovering abandoned carts and retrying orders, without incurring the cost of an always-on DigitalOcean worker.

---

## Primary Trigger: GitHub Actions (Active Production Trigger)

A scheduled GitHub Actions workflow runs every 5 minutes in production to ping the scheduler endpoint.

### 1. Workflow File
Located in `.github/workflows/whatsapp-scheduler.yml`, the workflow runs the following:
- Frequency: `*/5 * * * *` (Every 5 minutes)
- Manual triggers enabled via `workflow_dispatch`
- Method: HTTP GET to `https://app.zicabella.com/api/cron/whatsapp-scheduler`
- Header: `Authorization: Bearer ${{ secrets.CRON_SECRET }}`

### 2. Configuration Setup
1. **GitHub secrets**: Navigate to your GitHub Repository Settings → **Secrets and variables** → **Actions**, and add a Repository Secret:
   - Key: `CRON_SECRET`
   - Value: a long random string (for example the output of `openssl rand -hex 32`). It must match the `CRON_SECRET` configured in DigitalOcean. Never write the real value in this repository.
2. **DigitalOcean Environment variables**: Ensure `CRON_SECRET` is added to your App-level environment variables on the App Platform settings (Settings → Next.js component → App-Level Environment Variables → Encrypted).

---

## Alternative/Fallback: DigitalOcean App Platform Worker

If you ever need a tighter cadence (e.g. 1-2 minutes) and choose to host an always-on paid container, you can use the daemon script `scripts/whatsapp-scheduler-pinger.js`.

> [!NOTE]
> The pinger daemon script `scripts/whatsapp-scheduler-pinger.js` is **not currently deployed** to DigitalOcean. It is only relevant if you choose to activate this fallback worker.

### 1. App Spec Configuration
Add the following `worker` block to your DigitalOcean App Spec configuration:

```yaml
workers:
  - name: whatsapp-scheduler-pinger
    run_command: node scripts/whatsapp-scheduler-pinger.js
    environment_slug: node-js
    instance_count: 1
    instance_size_slug: basic-xxs
    envs:
      - key: CRON_SECRET
        scope: RUN_TIME
        value: "${CRON_SECRET}"
      - key: NEXT_PUBLIC_APP_URL
        scope: RUN_TIME
        value: "https://app.zicabella.com"
```

---

## Alternative/Fallback: External Pingers

You can also use external cron services (e.g. UptimeRobot or Cron-Job.org) to request:
`https://app.zicabella.com/api/cron/whatsapp-scheduler?secret=YOUR_CRON_SECRET`

---

## Verification & Auditing

Every time the scheduler runs, it writes a log record to the database table `whatsapp_scheduler_runs` containing execution counts, successes, and errors. These run logs are displayed in the **WhatsApp Hub** status panel inside the admin dashboard.
