## Repository Map

This repository uses `codemap.md` files to document directory responsibility,
data flow, and integration boundaries. Read the nearest map before changing a
directory and update it when the responsibility or flow changes.

Quest Ascension event paths:

- [`backend/src/modules/series/codemap.md`](backend/src/modules/series/codemap.md)
  — EventSeries-as-Event API and aggregation.
- [`backend/src/modules/tournaments/codemap.md`](backend/src/modules/tournaments/codemap.md)
  — nullable child relation, registration capacity, and waitlist rules.
- [`backend/prisma/codemap.md`](backend/prisma/codemap.md) — additive schema
  migrations and deployment safety.
- [`frontend/app/tournaments/codemap.md`](frontend/app/tournaments/codemap.md)
  — merged public tournament and event routes.
- [`frontend/app/admin/codemap.md`](frontend/app/admin/codemap.md) — admin event
  routes.
- [`frontend/components/tournaments/event/codemap.md`](frontend/components/tournaments/event/codemap.md)
  — public event components.
- [`frontend/components/admin/codemap.md`](frontend/components/admin/codemap.md)
  — event dashboard and event-scoped registration UI.
