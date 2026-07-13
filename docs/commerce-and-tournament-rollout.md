# Commerce and Tournament Rollout

## Database deployment

Apply `20260713220000_complete_platform_foundations` before deploying either application. It preserves existing tournaments, registrations, teams, brackets, and rulebooks; adds nullable account links for legacy registrations; and backfills those links from saved-team captains, accepted captain members, or matching account email where possible.

```bash
cd backend
npm run prisma:migrate:deploy
npm run prisma:generate
```

Unmatched legacy registrations remain readable in admin and public participant views.

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

If PayHere credentials are blank, the public capability endpoint reports payments unavailable. Free tournaments continue to accept registrations, while paid registration and shop checkout remain disabled without creating drafts or reserving inventory.

Use sandbox credentials until successful paid, failed, cancelled, duplicate-notification, amount-mismatch, and chargeback journeys have been verified through a public callback URL. Change `PAYHERE_MODE` to `live` only after merchant approval, live domain registration, and policy review.

## Content setup order

1. Create event series in `/admin/event-series` and attach tournaments from the tournament editor.
2. Configure each tournament's entry type, roster limits, substitutes, JSON field schema, fee/currency, and reservation duration.
3. Upload schedules and rulebooks, approve participants, generate the bracket, and publish it when ready.
4. Create products and variants in `/admin/products`. Upload product images in the same editor, then activate the product.
5. Monitor `/admin/orders` for fulfilment and `/admin/payments` for reconciliation.

Registration field definitions accept only `text`, `number`, or `select`; `entry` or `member` scope; and required/optional flags. Select fields must include an `options` list. A zero tournament fee submits immediately; paid entries reserve capacity for the configured window (15 minutes by default).

## Policy and launch checks

The footer publishes Privacy, Terms, and Refund/Return policies. Customized shirts are not returnable for change of mind, customization, or incorrect size selection; wrong, damaged, and defective goods retain a support path. Successful tournament fees are non-refundable unless Quest cancels the event. Obtain final business/legal approval before launch.

Before release, run:

```bash
cd backend && npm test
cd ../frontend && npm run lint && npm run build && npm run test:e2e
```
