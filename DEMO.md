# RecoverAI — Demo Guide

> **Razorpay Test Mode only.** No live payments.
> Domestic Test Mode card: **`4100 2800 0000 1007`** — any future expiry, any valid CVV.
> If the card checkout misbehaves, use **Test Mode Netbanking → Success**.

---

## A. Pre-Demo Checklist

Do this once before the judge walks up:

- [ ] App deployed and reachable at `https://<vercel-domain>.vercel.app` (or `http://localhost:3000` locally).
- [ ] `GET /api/health` returns `{"status":"ok","database":"connected"}` — Neon is connected, no secrets leaked.
- [ ] `/settings/integrations` → **Razorpay — Test Mode** → **Test Connection** → `Connected` + `Test Mode` + masked Key ID. **Current Configuration** card shows `Razorpay: Configured`, `Payment Provider: Razorpay Test` (or `Simulation`), `AI: Mock/Gemini/Groq`.
- [ ] `AI_PROVIDER` set as desired (`mock` is fine — show `AI: Mock / Demo` in header). If `gemini`/`groq`, API key is valid or fallback to Mock will be visible.
- [ ] Razorpay webhook configured at `https://<vercel-domain>/api/webhooks/razorpay` with `RAZORPAY_WEBHOOK_SECRET`, subscribed to **`payment.failed`** and **`payment_link.paid`** (Razorpay Dashboard → Settings → Webhooks).
- [ ] `PAYMENT_PROVIDER` is correct for the demo you will run (`razorpay` for the payment-link path, `simulation` for the batch fallback).
- [ ] `RAZORPAY_MERCHANT_ID` matches `SELECT id FROM "Merchant" LIMIT 1;` in Neon — otherwise webhooks return `Merchant not found` / `does not belong to this merchant`.
- [ ] At least one seeded case exists — open `/cases` and confirm rows. If empty, you did not seed: `npm run db:seed` (local) — warning: this wipes and recreates.
- [ ] Pick your demo case in advance: one `FAILED_PAYMENT` under ₹5,000 (no approval) and one `FAILED_PAYMENT` over ₹5,000 (shows approval flow). The `?filter=approval` list helps.

## B. Primary Demo — Razorpay Test Mode Payment Link (60–90s)

1. **Dashboard** (`/`) — narrate in one sentence: "RecoverAI detects revenue at risk and turns it into an auditable recovery." Point to **Revenue at Risk / Revenue Recovered / Recovery Rate / Active Cases** (top hero) and the **Recovery Funnel** (At Risk → Analyzed → Eligible → Executed → Recovered).
2. **Open a case** — click any `RecoveryCase` in **Recent Recoveries** or `/cases`. The URL is `/cases/<id>`.
3. **Analyze with AI** — click **Analyze with AI**. Show the **AI Reasoning** card: diagnosis, risk, `Recommended Action`, confidence (e.g. `RETRY_PAYMENT · 82%`). Point to the provider badge (`Mock / Demo` vs `Gemini`/`Groq`).
4. **Policy Decision** — scroll to **Policy Decision**. Read the green `Case is eligible… Allowed: RETRY_PAYMENT` or amber `High-value case: merchant approval is required…`. This is the deterministic engine in `src/lib/policy/engine.ts` — the AI did not decide this.
5. **Approval (if high-value ≥ ₹5,000)** — the amber `Merchant Approval Required` banner is visible. Click **Approve Recovery** as the merchant → banner becomes `✓ RECOVERY APPROVED → execution is now unlocked`. Audit gets `APPROVAL_GRANTED`.
6. **Execute** — click **Execute: Retry Payment**. For `FAILED_PAYMENT` in Razorpay mode this creates a **Razorpay Test Mode payment link** (amount from DB, `reference_id = RECOVERAI-{caseId}`, `expire_by = windowExpiresAt`). The case becomes `IN_PROGRESS / AWAITING_PAYMENT` and shows **Awaiting Customer Payment** with **Open Payment Link ↗**.
7. **Open the payment link** — click **Open Payment Link ↗** (new tab).
8. **Complete the Test Mode payment:**

   **Card:** `4100 2800 0000 1007`
   - any future expiry date (e.g. `12/30`)
   - any valid-looking CVV (e.g. `123`)

   > If the card checkout shows "International cards are not supported" or any other card-specific error, **do not retry the same flow** — use **Test Mode Netbanking** on that same checkout page and choose **Success**. Both paths fire `payment_link.paid`.

9. **Webhook** — Razorpay sends `payment_link.paid` to `POST /api/webhooks/razorpay`. RecoverAI verifies HMAC (`x-razorpay-signature`), deduplicates (`RazorpayWebhookEvent.eventId`), and validates `amount === amountAtRisk && currency === INR`. On mismatch → `RECOVERY_PAYMENT_AMOUNT_MISMATCH` and no recovery.
10. **RECOVERED** — return to the case tab and refresh. The status badge is now **Recovered**; the header shows `Recovered ₹…`; the intervention row is `RETRY_PAYMENT · SUCCESS · +₹…`.
11. **Dashboard update** — back to `/`, **Revenue Recovered** and **Recovery Rate** have incremented; the case appears in **Recent Recoveries**.
12. **Audit trail** — open the case's **Audit Trail** (bottom of the page) or `/audit`. Show the chain: `AI_ANALYSIS_COMPLETED` → `APPROVAL_GRANTED` (if any) → `INTERVENTION_RETRY_PAYMENT` → `RECOVERY_PAYMENT_CREATED` → `RECOVERY_PAYMENT_CONFIRMED` → `RECOVERY_SUCCESS`. Every step is persisted, never computed on the fly.

## C. Simulation Fallback (if Razorpay Test Mode / payment methods misbehave)

If the Razorpay payment link, card, or webhook is flaky during judging:

1. Set `PAYMENT_PROVIDER=simulation` in `.env` (or Vercel env and redeploy).
2. Dashboard header and `/settings/integrations` will show `Recovery: Simulation Mode`.
3. On the dashboard click **Run Recovery Batch**.
4. The streaming batch processes every active case through the deterministic policy engine — show `Cases analyzed / Actions executed / Recovered / Failed / Blocked / Approval required` and the resulting `Revenue Recovered` / `Recovery Rate`.
5. Open `/cases` — cases have moved to `RECOVERED / FAILED / STOPPED / ESCALATED` accordingly; `/audit` shows `RECOVERY_SUCCESS / RECOVERY_FAILED / ACTION_BLOCKED / CASE_STOPPED`.
6. This path is fully deterministic and needs no external calls.

## D. Common Demo Failures

### Razorpay says: `International cards are not supported`

→ You used an unsupported international test card or the gateway flagged the card for this account.
→ **Use `4100 2800 0000 1007`** — the Razorpay domestic Test Mode card for this demo — with any future expiry and any valid CVV.
→ If it still fails, on the same Razorpay checkout use **Test Mode Netbanking** and choose **Success** — it also fires `payment_link.paid`.

### Webhook not firing

→ Verify the webhook URL is the **deployed HTTPS** URL: `https://<vercel-domain>/api/webhooks/razorpay` — not `localhost` or `ngrok` (those are local-only).
→ Verify `payment.failed` and `payment_link.paid` are enabled on the webhook in the Razorpay Dashboard.
→ Verify `RAZORPAY_WEBHOOK_SECRET` on Vercel matches the Dashboard webhook secret — HMAC mismatch returns `400 Invalid webhook signature`.
→ Check `RazorpayWebhookEvent` rows: `SELECT eventType, status, errorMessage FROM "RazorpayWebhookEvent" ORDER BY "receivedAt" DESC LIMIT 5;`.

### `Merchant not found` or `Payment link does not belong to this merchant`

→ `RAZORPAY_MERCHANT_ID` on Vercel does **not** match `Merchant.id` in Neon.
→ Fix: seed with `RAZORPAY_MERCHANT_ID` set so `prisma/seed.ts` creates the merchant with that ID, or copy the existing `Merchant.id` from Neon (`SELECT id FROM "Merchant" LIMIT 1;`) into the Vercel env and redeploy.

### AI still shows `Mock`

→ `AI_PROVIDER` is `mock` or the selected provider key is missing/empty.
→ `AI_PROVIDER=gemini` requires `GEMINI_API_KEY`; `AI_PROVIDER=groq` requires `GROQ_API_KEY`. The header on every page shows `AI: Mock / Demo | Gemini | Groq` — check there first.
→ When Mock is active the dashboard funnel/AI cards still work — the Mock provider is deterministic and sufficient for the demo.

### Payment Link created but case not `RECOVERED`

→ The `payment_link.paid` webhook probably did not arrive or was rejected.
→ Check the webhook `RazorpayWebhookEvent` with `eventType = 'payment_link.paid'` — `status = FAILED` means validation failed; read `errorMessage`.
→ Common validation failures: `Payment amount does not match the recovery amount` — the paid amount must equal `RecoveryCase.amountAtRisk` and `currency` must be `INR`; `Invalid payment amount`; `No recovery intervention found for this payment link` (wrong `providerReference`).
→ Use browser Network tab or `curl /api/health` to confirm the app is up; check Vercel function logs for the webhook route.

## E. Reset Warning

- `npm run db:seed` and `POST /api/demo/reset` **wipe and recreate** all demo data — `Merchant`/`Customer`/`Transaction`/`RecoveryCase`/`AIDecision`/`AuditLog` are deleted and reinserted deterministically. Never run against a database you care about.
- `POST /api/demo/reset` is **`403` in production** (`NODE_ENV=production`) regardless of token. The dashboard **Reset Demo Data** button is hidden in production. In a Vercel preview, if `DEMO_RESET_TOKEN` is set, the endpoint requires header `x-demo-reset-token`; the token is never exposed in browser JS.
- For a clean hackathon reset: `npm run db:deploy && npm run db:seed` locally (with `DATABASE_URL`/`DIRECT_URL` set), then redeploy Vercel if `RAZORPAY_MERCHANT_ID` changed.

---

*RecoverAI — Razorpay AI Buildathon, Track 3. Test Mode only.*
