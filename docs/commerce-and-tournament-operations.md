# Commerce and Tournament Operations

This guide covers ongoing tournament registration, payment, shop, and entrance-ticket operations. Use [Admin Operations](./admin-operations.md) for UI procedures and [API Documentation](./api-documentation.md) for endpoint contracts.

## Safety Boundaries

- Apply the complete committed Prisma migration history before deploying either application.
- Treat PostgreSQL, public uploads, and private uploads as one backup set.
- `COMMERCE_MAINTENANCE_ENABLED` controls cleanup jobs; it is not the visitor-facing maintenance switch.
- Full-site maintenance preserves PayHere callbacks and workers so in-flight payments can settle. Stop the backend only when an approved operation requires a true write freeze.
- Never expose payment provider secrets, bank-transfer evidence, order capabilities, or ticket signing material to the frontend.

## Tournament Registration

Tournament configuration controls entry type, roster limits, substitutes, custom fields, capacity, payment method, fee tiers, reservation duration, and bank-review duration.

Free registrations submit immediately. Paid registrations reserve capacity for the configured window. Private admin holds lock a concrete slot and its quoted fee/currency until released or consumed.

Older registrations remain readable for compatibility. Do not remove legacy fields or routes without a separately reviewed data migration and retirement plan.

## Bank Transfers

Bank-transfer tournaments create a local payment transaction and return the assigned slot, quoted fee, and bank instructions. Captains upload one PNG, JPEG, or WebP receipt through:

```text
POST /api/payments/:orderId/bank-transfer-proof
```

Proofs are normalized, deduplicated by SHA-256, and stored below `PRIVATE_UPLOAD_ROOT/bank-transfer-proofs`. They are never served through public upload routes. Admin approval confirms the payment and registration; rejection records a reason and releases the slot according to current rules.

Keep `BANK_TRANSFER_PROOF_RETENTION_DAYS` aligned with the approved privacy and accounting policy.

## PayHere

PayHere configuration is backend-only:

```env
PAYHERE_MODE=sandbox
PAYHERE_MERCHANT_ID=
PAYHERE_MERCHANT_SECRET=
PAYHERE_NOTIFY_URL=https://api.example.com/api/payments/payhere/notify
```

The callback URL must be public HTTPS. The backend validates merchant, signature, order, amount, currency, and status, and processes notifications idempotently. Browser return pages only poll local status; the callback is authoritative.

Use sandbox mode until paid, failed, cancelled, duplicated, mismatched-amount, refund, and chargeback journeys pass through the public callback. Production credentials require live mode unless sandbox-in-production is explicitly approved.

If credentials are blank, PayHere checkout remains unavailable while free and bank-transfer tournament flows continue. Merchandise and entrance-ticket checkout currently require PayHere and LKR pricing.

## Products and Orders

Create products, variants, prices, inventory, and images under `/admin/products`. The backend recalculates every quote and total; client totals are never authoritative. Monitor fulfilment in `/admin/orders` and payment reconciliation in `/admin/payments`.

Order-status links contain a private bearer capability in the URL fragment. Do not place those URLs in logs, support tickets, analytics, screenshots, or public messages.

## Entrance Tickets

Entrance tickets reserve capacity for `TICKET_ORDER_RESERVATION_MINUTES`. Each paid attendee receives a distinct signed QR payload. A scan is accepted only for the selected event, a paid order, an active ticket, and the current ticket version.

Check-in is online-only and atomic. Test the web scanner and private Android client against the target environment before doors open; no offline admission mode exists.

## Content Setup Order

1. Create game categories and event series.
2. Configure tournaments, registration fields, payment settings, schedules, and rulebooks.
3. Add sponsors, hero media, participant approvals, and bracket data.
4. Create products and variants, upload images, then publish products.
5. Create ticket events and confirm sales windows, capacity, and single/pair prices.
6. Verify registrations, payments, orders, tickets, and check-ins from their admin screens.

## Release Checks

Before release, verify:

- free, bank-transfer, and enabled PayHere journeys
- slot/capacity races and reservation expiry
- proof review, rejection, duplicate detection, and retention
- shop quotes, inventory release, fulfilment, refunds, and private order lookup
- ticket pricing, QR validation, duplicate scans, reissue, and wrong-event handling
- account history, policy links, keyboard/mobile behavior, and maintenance behavior

Run the repository release suite from [Pre-deployment Checklist](./pre-deployment-checklist.md), then follow the [Production Operations Runbook](./production-runbook.md) for deployment and rollback.
