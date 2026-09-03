# RecoverAI — Vercel Deployment Guide

> Frontend + Next.js API routes → **Vercel**
> Database → **Neon PostgreSQL**
> Payments → **Razorpay TEST MODE only** (never live)

## A. Prerequisites

- Neon project with a PostgreSQL database (pooled + direct connection strings).
- Razorpay Test Mode API keys (`rzp_test_…`).
- Vercel account connected to the GitHub repo.
- Node 20+ locally for DB setup.

## B. Environment Variables on Vercel

In Vercel → Project → Settings → Environment Variables, add:

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@ep-xxx-pooler…/neondb?sslmode=require` | Neon **pooled** URL — used at runtime via `@prisma/adapter-pg`. Required. |
| `DIRECT_URL` | `postgresql://user:pass@ep-xxx…/neondb?sslmode=require` | Neon **direct** URL — used by `prisma migrate deploy` / `prisma db seed`. Required for deploys/seeding. |
| `SHADOW_DATABASE_URL` | _(empty)_ | Optional — only if you run `prisma migrate dev` against Neon. Leave empty on Vercel. |
| `AI_PROVIDER` | `mock` | `mock` (default) \| `gemini` \| `groq` |
| `GEMINI_API_KEY` | _(key or empty)_ | Required only if `AI_PROVIDER=gemini` |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` | Default is correct; override rarely needed |
| `GEMINI_MODEL` | `gemini-2.5-flash` | |
| `GROQ_API_KEY` | _(key or empty)_ | Required only if `AI_PROVIDER=groq` |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | |
| `INTERNAL_API_TOKEN` | _(empty or token)_ | If set, `POST /api/ai/recovery/[id]/analyze` requires header `x-internal-token` |
| `PAYMENT_PROVIDER` | `simulation` | `simulation` (default) \| `razorpay`. **`razorpay` means Razorpay TEST MODE for this hackathon — never live payments.** |
| `RAZORPAY_KEY_ID` | `rzp_test_xxxxxxxxxxxxxx` | Razorpay Dashboard → Settings → API Keys (Test Mode) |
| `RAZORPAY_KEY_SECRET` | `xxxxxxxxxxxx` | Same place |
| `RAZORPAY_WEBHOOK_SECRET` | `whsec_xxxxxxxxxxxx` | Razorpay Dashboard → Settings → Webhooks → Secret |
| `RAZORPAY_MERCHANT_ID` | `cmxxxxxxxxxxxx` | **RecoverAI `Merchant.id` from Neon — NOT the Razorpay account ID.** See §D. |
| `RAZORPAY_API_BASE_URL` | `https://api.razorpay.com/v1` | Default; change only for mocks |
| `DEMO_RESET_TOKEN` | _(random string or empty)_ | If set, `POST /api/demo/reset` requires header `x-demo-reset-token`. In production the endpoint is always `403` regardless; this adds a second gate for non-prod. |

> Use `.env.example` as a template. Never commit `.env`.

### Where to get `RAZORPAY_MERCHANT_ID`

This is **not** your Razorpay account ID. It is the `Merchant.id` row that `prisma/seed.ts` creates in Neon.

After seeding (step D), run:

```bash
# from your local checkout with DATABASE_URL set
npx tsx -e "import{PrismaPg}from'@prisma/adapter-pg';import{PrismaClient}from'./src/generated/prisma/client.js';const c=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});c.merchant.findFirst().then(m=>{console.log(m?.id);c.\$disconnect()})"
# or via SQL:
# SELECT id FROM "Merchant" LIMIT 1;
```

Copy that CUID (or the value of `RAZORPAY_MERCHANT_ID` you set before seeding) into Vercel env. If you seeded with `RAZORPAY_MERCHANT_ID` already set, the merchant was created with that exact ID — reuse the same value on Vercel.

## C. Deploy Migrations (before first app deploy)

Migrations are committed under `prisma/migrations/` and run with `prisma migrate deploy` (never `migrate dev` in production).

From your local machine with `DIRECT_URL` (or `DATABASE_URL`) set:

```bash
npm ci
npm run db:deploy   # runs: prisma migrate deploy
```

Verify:

```bash
npx prisma migrate status
```

All 6 migrations should show as applied:
`20260824100257_init`, `20260824112630_case_approval_and_policy_defaults`, `20260824132200_ai_decision_fields`, `20260824153000_approval_rejection_fields`, `20260827100000_add_razorpay_webhook_events`, `20260827110000_add_recovery_provider_fields`.

## D. Seed Demo Database (once)

> ⚠️ `npm run db:seed` (`prisma db seed` → `prisma/seed.ts`) **wipes and reseeds** the database: it deletes all `Merchant`/`Customer`/`Transaction`/`RecoveryCase`/etc rows and recreates the deterministic demo dataset. Do NOT run it on every deployment.

```bash
# One-time, from local machine with DATABASE_URL set:
npm run db:seed
# or explicitly:
# npx prisma db seed
```

If `RAZORPAY_MERCHANT_ID` is set in your local `.env` at seed time, the merchant is created with that ID — this is what Vercel must use (see §B).

## E. Deploy to Vercel

1. Vercel → Add New Project → Import the GitHub repo.
2. Framework preset: **Next.js** (auto-detected). No `vercel.json` needed.
3. Add all Environment Variables from §B.
4. Deploy. Vercel runs `npm ci` → `postinstall` (`prisma generate`) → `next build` automatically.

No extra Build Command override is needed.

## F. Get the Vercel URL

After deploy, copy the domain, e.g. `https://recoverai-xxxx.vercel.app`.

## G. Configure Razorpay TEST Webhook

1. Razorpay Dashboard (Test Mode) → Settings → Webhooks → Add New Webhook
2. Webhook URL:
   ```
   https://<VERCEL_DOMAIN>/api/webhooks/razorpay
   ```
   Example: `https://recoverai-xxxx.vercel.app/api/webhooks/razorpay`
3. Secret: the same value as `RAZORPAY_WEBHOOK_SECRET`.
4. Do **not** use `localhost` or `ngrok` for the deployed webhook — those are for local dev only.

## H. Subscribe to Events

Enable these two events on the webhook:

- `payment.failed` — creates a `RecoveryCase` (idempotent; duplicate deliveries return `already_processed`).
- `payment_link.paid` — validates amount/currency and marks the linked case `RECOVERED` (amount must equal `RecoveryCase.amountAtRisk`, currency `INR`).

Other events are ignored (`event_ignored`) but still recorded as `RazorpayWebhookEvent` for idempotency.

## I. Test Health

```bash
curl https://<VERCEL_DOMAIN>/api/health
# → {"status":"ok","database":"connected"}  (or 503 if DB unreachable)
# Never exposes DATABASE_URL or secrets.
```

## J. Test Integrations Page

Open `https://<VERCEL_DOMAIN>/settings/integrations`:

- **Razorpay — Test Mode**: click **Test Connection** → should show `Connected` + `Test Mode` + masked Key ID. If it shows `Connection Failed`, check `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`.
- **Current Configuration** card shows `Razorpay: Configured/Not Configured`, `Payment Provider: Simulation/Razorpay Test`, `AI: Mock/Gemini/Groq`, `Webhook: /api/webhooks/razorpay` — all derived from env, no secrets exposed.

## K. Run One End-to-End Test Mode Recovery

1. Ensure `PAYMENT_PROVIDER=razorpay` and Razorpay Test keys are set on Vercel (redeploy if you changed env).
2. Trigger a `payment.failed` (use Razorpay Test Mode checkout with a failing test card, or send a test webhook from the Razorpay dashboard). It should appear as a new `FAILED_PAYMENT` case in `/cases`.
3. Open the case → **Analyze with AI** → if high-value (≥ ₹5,000) click **Approve Recovery**.
4. Click **Execute: Retry Payment** → a Razorpay Test Mode payment link is created; case becomes `IN_PROGRESS` with status `AWAITING_PAYMENT` and shows **Awaiting Customer Payment** + **Open Payment Link ↗**.
5. Open the link and pay with Razorpay test card `4111 1111 1111 1111` (any future expiry/CVV).
6. Razorpay fires `payment_link.paid` → webhook validates and case becomes `RECOVERED`; dashboard **Revenue Recovered** increments.

## Notes

- **Prisma client generation**: `postinstall: prisma generate` ensures `src/generated/prisma` is built on Vercel even on clean installs. The generated client is also committed, so local dev works without it.
- **Serverless**: webhook uses `runtime = "nodejs"`, reads raw body via `request.text()` for HMAC, and idempotency is DB-backed (`RazorpayWebhookEvent.eventId` unique) — no in-memory or filesystem state.
- **Demo reset**: `POST /api/demo/reset` is `403` in production. The dashboard Reset button is hidden when `NODE_ENV=production`. If you need it in a preview deployment, set `DEMO_RESET_TOKEN` and send `x-demo-reset-token`.
- **No `vercel.json`**: not required; Next.js defaults are correct.
