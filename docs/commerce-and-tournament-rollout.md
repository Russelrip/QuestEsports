# Commerce and Tournament Rollout

## Database deployment

Apply the complete migration history before deploying either application. `20260713220000_complete_platform_foundations` adds event series, configurable solo/team registration, account history, products, orders, and generic payments. Later migrations add date statuses, tiered bank-transfer registration, duplicate-proof prevention, and payment reconciliation.

```bash
cd backend
npm run prisma:migrate:deploy
npm run prisma:generate
```

Unmatched legacy registrations remain readable in admin and public participant views.

Current commerce migrations are:

- `20260713220000_complete_platform_foundations`
- `20260714010000_add_tournament_date_statuses`
- `20260714140000_add_bank_transfer_registration`
- `20260714170000_enforce_unique_bank_transfer_proofs`
- `20260714180000_add_payment_reconciliation`

Never mark a migration as applied manually unless its SQL has actually completed. Production CD runs `prisma migrate deploy`; its code rollback does not reverse database migrations, so migrations must remain compatible with the previous release.

## Bank-transfer tournaments

Bank transfer is independent of PayHere. Configure a tournament with `paymentMethod=bank_transfer`, currency, fee tiers, bank details, and review window. Fee tiers are assigned by reserved slot number, allowing schedules such as the first three slots at one price and later slots at higher prices.

The registration response creates a local payment transaction and returns the quoted slot/fee plus bank instructions. A verified user uploads one receipt through:

```text
POST /api/payments/:orderId/bank-transfer-proof
```

Receipts are stored under `PRIVATE_UPLOAD_ROOT/bank-transfer-proofs`, never under public uploads. JPEG, PNG, and WebP are decoded and re-encoded before storage. PDF remains disabled unless `PAYMENT_PROOF_PDF_ENABLED=true` and an external malware-scanning/sanitization process is in place. SHA-256 uniqueness prevents the same normalized receipt from being attached to multiple transactions.

Admins review/download receipts from `/admin/payments`. Approval confirms payment and registration; rejection records a reason. Keep `BANK_TRANSFER_PROOF_RETENTION_DAYS` aligned with the approved business/privacy retention policy.

## PayHere

Configure these backend-only values:

```env
PAYHERE_MODE=sandbox
PAYHERE_MERCHANT_ID=
PAYHERE_MERCHANT_SECRET=
PAYHERE_NOTIFY_URL=https://api.example.com/api/payments/payhere/notify
SHOP_DELIVERY_FEE_LKR=500
SHOP_ORDER_RESERVATION_MINUTES=30
APP_URL=https://www.example.com
```

`PAYHERE_NOTIFY_URL` must be public HTTPS. Never expose the merchant secret to the frontend. The server signs checkout fields and verifies merchant, order, signature, amount, currency, and status for every form-encoded notification. Processing is idempotent; the callback is authoritative and browser return pages only poll local status.

If PayHere credentials are blank, the public capability endpoint reports PayHere unavailable. Free registrations and paid tournaments configured for bank transfer continue to work. PayHere tournament checkout and merchandise checkout remain disabled without creating PayHere drafts or reserving shop inventory.

Bank-transfer tournaments continue to operate when PayHere is blank. Merchandise checkout currently requires PayHere and LKR products.

Use sandbox credentials until successful paid, failed, cancelled, duplicate-notification, amount-mismatch, and chargeback journeys have been verified through a public callback URL. Change `PAYHERE_MODE` to `live` only after merchant approval, live domain registration, and policy review.

## Content setup order

1. Create event series in `/admin/event-series` and attach tournaments from the tournament editor.
2. Configure each tournament's entry type, roster limits, substitutes, JSON field schema, payment method, fee/currency or tiers, reservation/review duration, and bank details when applicable.
3. Upload schedules and rulebooks, approve participants, generate the bracket, and publish it when ready.
4. Create products and variants in `/admin/products`. Upload product images in the same editor, then activate the product.
5. Monitor `/admin/orders` for fulfilment and `/admin/payments` for reconciliation.

Registration field definitions accept only `text`, `number`, or `select`; `entry` or `member` scope; and required/optional flags. Select fields must include an `options` list. A zero tournament fee submits immediately; paid entries reserve capacity for the configured window (15 minutes by default).

## Policy and launch checks

The footer publishes Privacy, Terms, and Refund/Return policies. Customized shirts are not returnable for change of mind, customization, or incorrect size selection; wrong, damaged, and defective goods retain a support path. Successful tournament fees are non-refundable unless Quest cancels the event. Obtain final business/legal approval before launch.

Before release, run:

```bash
cd backend && npm run test:coverage && npm run lint
cd ../frontend && npm run lint && npm run build && npm run test:e2e
```

Before production rollout, also verify the account dashboard, avatar replacement/removal, solo and team forms, slot-capacity races, free registration, bank proof review/rejection, PayHere duplicate callbacks when configured, shop quotes, inventory expiry, policy links, and mobile/keyboard behavior.
