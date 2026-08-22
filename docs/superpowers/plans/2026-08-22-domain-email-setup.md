# Quest Esports Domain Email Setup Plan

**Goal:** Deliver inbound mail for `russel@questesports.lk` into Russel's existing
Gmail inbox and allow Gmail to send as that address, without disturbing the live
site or the queued transactional email the backend already sends through Resend.

**Scope:** One human address only. No mailbox hosting, no mail server, no change
to application email code.

**Audited:** 2026-08-22 against this repository and live public DNS.

---

## 1. Verified Current State

### 1.1 DNS (public resolution via 8.8.8.8, 2026-08-22)

| Name | Type | Value | Meaning |
| --- | --- | --- | --- |
| `questesports.lk` | NS | `sun.namebirth.com`, `moon.namebirth.com` | **DNS is not on Cloudflare.** SOA contact is `root.masterdns.register.lk` (LK Domain Registry / NameBirth). |
| `questesports.lk` | A | `216.198.79.1` | Vercel frontend. |
| `www.questesports.lk` | CNAME | `questesports.lk` | Vercel frontend. |
| `api.questesports.lk` | A | `161.97.162.27` | Backend VPS (France). |
| `questesports.lk` | MX | `0 questesports.lk` | Points inbound mail at the Vercel A record. No SMTP listener exists there. |
| `questesports.lk` | TXT | `google-site-verification=Qxz8Ut_...` | Search Console. **No SPF record exists at the apex.** |
| `_dmarc.questesports.lk` | TXT | `v=DMARC1; p=none;` | DMARC already exists. No `rua`, no `sp`. |
| `mail.questesports.lk` | CNAME | `questesports.lk` | **Stray record.** See 2.6. |
| `resend._domainkey.mail.questesports.lk` | TXT | `p=MIGfMA0GCSqGSIb3...` | Resend DKIM, RSA-1024, no optional `v=DKIM1` tag. Valid. |
| `send.mail.questesports.lk` | TXT | `v=spf1 include:amazonses.com ~all` | Resend Return-Path SPF. |
| `send.mail.questesports.lk` | MX | `10 feedback-smtp.ap-northeast-1.amazonses.com` | Resend bounce/complaint path. Region is **ap-northeast-1 (Tokyo)**. |

There is no other inbound mail service. Nothing currently receives mail at
`@questesports.lk`; messages sent there today fail.

### 1.2 Application email (this repository)

- Transport is **Nodemailer over Resend SMTP**, not the Resend REST API:
  `smtp.resend.com`, port `465`, implicit TLS, username `resend`, password
  `RESEND_API_KEY` — [transporter.js:22-33](backend/src/lib/mail/transporter.js#L22-L33).
- Sends are queued as `email.send` rows in `background_jobs` and delivered by the
  in-process worker when `JOB_WORKER_ENABLED=true`. See [email-system.md](docs/email-system.md).
- Sender is `MAIL_FROM`, documented as `Quest Esports <no-reply@mail.questesports.lk>`
  — the **sending subdomain**, not the root domain.
- `MAIL_PROVIDER` accepts `resend` or `smtp` and is validated at startup;
  production refuses to boot without complete provider config plus
  `MAIL_DELIVERY_REQUIRED=true` and `JOB_WORKER_ENABLED=true`
  — [env.js:592-612](backend/src/config/env.js#L592-L612).
- Secrets are environment-only. `.env` and `.env.*` are gitignored; no address or
  credential is hardcoded. The only literal address in code is the Web Push
  contact default `mailto:admin@questesports.lk`
  — [env.js:321](backend/src/config/env.js#L321). That address does not currently
  receive mail (see Task 11).
- `backend` exposes `npm run mail:verify`, which checks SMTP connection and auth
  without sending.

**Conclusion: the existing Resend setup is healthy and self-contained on
`mail.questesports.lk`. No application code change is required by this plan.**

---

## 2. Corrections To The Original Plan

These are the points where the original document assumed something that is not
true of this domain or this codebase.

1. **Cloudflare does not manage this zone.** The original plan treats Cloudflare
   Email Routing as available. Cloudflare's documentation states plainly that the
   domain must use Cloudflare DNS; partial/CNAME setup is not supported. Using
   Email Routing therefore requires migrating authoritative nameservers away from
   NameBirth — the single largest production risk in this task, and absent from
   the original plan. See Section 3 for the decision.
2. **The website uses Resend SMTP, not the Resend API.** Every architecture
   diagram saying `Website -> Resend API` is inaccurate; it is
   `Website -> background_jobs queue -> worker -> Nodemailer -> Resend SMTP`.
3. **Resend authenticates a subdomain, not the root.** `questesports.lk` itself is
   not verified in Resend. `russel@questesports.lk` therefore **cannot** be sent
   through the current Resend configuration until the apex is added as a second
   domain in Resend. The original plan assumed this might already work.
4. **The existing apex MX is not protecting anything.** `0 questesports.lk` is a
   registrar default aimed at the web server. Replacing it loses no working
   service — but it must still be recorded before removal.
5. **The SPF instruction is misdirected.** There is no apex SPF to merge into, and
   SPF is evaluated against the Return-Path domain, not the visible From. App mail
   authenticates under `send.mail.questesports.lk`; Gmail-via-Resend will
   authenticate under `send.questesports.lk`; Cloudflare forwarding needs its own
   apex SPF. These are three different hostnames — **do not hand-merge them into
   one record.** The "one SPF TXT per hostname" rule still applies per hostname.
6. **`mail.questesports.lk` has a stray CNAME to the apex.** A CNAME at a node
   that also has children (`resend._domainkey.`, `send.`) violates RFC 1034/2181.
   Public resolvers tolerate it today, but a stricter resolver could occlude the
   Resend DKIM lookup and break DKIM signing for all application mail. This is a
   latent production defect worth fixing during the migration — after confirming
   nothing depends on the CNAME.
7. **DMARC already exists** (`p=none`). The original plan's "if none exists,
   create one" branch does not apply; the work is adding `rua` reporting, then
   deciding on progression.
8. **Cost is not fully zero-risk.** Free tiers cover everything, but Resend's free
   tier is 3,000 messages/month and 100/day. Routing Russel's personal
   correspondence through the same Resend account consumes the same quota that
   verification and password-reset email depends on.

---

## 3. Decision Required Before Any Change

Inbound routing needs one of two paths. **Choose before Task 1.**

**Option A — Migrate DNS to Cloudflare (enables Cloudflare Email Routing).**
- Recreate all nine live records in a Cloudflare zone, then change nameservers at
  register.lk / NameBirth.
- Pros: free, native routing UI, trivial to add future addresses, Cloudflare
  manages its own SPF/DKIM for forwarded mail.
- Cons: a nameserver change is a whole-zone cutover. A missed record takes the
  site, the API, or application email down. Requires registrar access and can
  take up to 24 hours to propagate.

**Option B — Keep DNS at NameBirth, use an MX-only forwarding provider.**
- Add MX + one TXT at the apex only; leave everything else untouched.
- Pros: no nameserver change, far smaller blast radius, reversible in minutes.
- Cons: introduces a provider outside the approved Cloudflare/Gmail/Resend set,
  which the original plan's Rule 7 says requires explicit approval.

**Recommendation: Option A**, but only if register.lk custom-nameserver access is
confirmed and the record inventory in 1.1 is reproduced exactly. The zone is
small and fully enumerated above, which makes the migration tractable.

---

## 4. Global Constraints

- The site, the API, and application email must stay up throughout.
- Never delete an existing record without capturing its current value first.
- Do not touch `resend._domainkey.mail.questesports.lk` or the
  `send.mail.questesports.lk` MX/TXT pair.
- Do not modify `A`, `AAAA`, or `CNAME` records for the apex, `www`, or `api`.
- No mail server, no Docker mail stack, no IMAP/POP hosting.
- No application code change. No new Resend key committed anywhere.
- One SPF TXT record per hostname.
- Stop at every **STOP** gate and hand the exact action back to Russel.

---

## 5. Tasks

### Task 1: Back Up The Zone

- [ ] Export or screenshot every record in the NameBirth panel.
- [ ] Save the export alongside the inventory in Section 1.1 as the restore
      reference.
- [ ] Record the current TTLs; lower the apex MX TTL if the panel allows it, to
      shorten the rollback window.

### Task 2: Confirm Registrar Capability — **STOP**

- [ ] Confirm register.lk / NameBirth allows setting custom nameservers for
      `questesports.lk`.
- [ ] Confirm who holds the registrar login.
- [ ] Report back before proceeding. If custom nameservers are unavailable,
      switch to Option B.

### Task 3: Build The Cloudflare Zone (Option A)

- [ ] Add `questesports.lk` to Cloudflare on the Free plan.
- [ ] Verify Cloudflare's automatic import captured all nine records from 1.1.
      Add anything missing by hand.
- [ ] Set the apex and `www` records to **DNS only** (grey cloud) unless proxying
      is deliberately wanted; Vercel serves TLS for these names.
- [ ] Set `api` to **DNS only** — the backend terminates its own TLS behind Nginx.
- [ ] Do **not** yet add MX or SPF for routing.
- [ ] Leave the `mail.questesports.lk` CNAME out of the new zone **only after**
      confirming nothing resolves it; otherwise recreate it as-is and address it
      separately.

### Task 4: Cut Over Nameservers — **STOP**

- [ ] Russel sets the Cloudflare-assigned nameservers at the registrar.
- [ ] Wait for Cloudflare to report the zone active.
- [ ] Verify before continuing:
      `nslookup -type=A questesports.lk`, `-type=A api.questesports.lk`,
      `-type=TXT resend._domainkey.mail.questesports.lk`,
      `-type=MX send.mail.questesports.lk`.
- [ ] Load `https://questesports.lk` and `https://api.questesports.lk/api/health`.
- [ ] Trigger one real password-reset email and confirm delivery. **Application
      email must be re-verified here, before any mail record changes**, so a later
      failure can be attributed correctly.

### Task 5: Enable Cloudflare Email Routing — **STOP** for verification

- [ ] Ask Russel for the destination Gmail address. Do not guess it.
- [ ] Add it as a destination in Cloudflare and have Russel click **Verify email
      address** in the message Cloudflare sends.
- [ ] Create the single custom address rule `russel@questesports.lk` -> that Gmail
      address.
- [ ] Let Cloudflare publish its MX records and routing SPF TXT at the apex,
      replacing `0 questesports.lk`.
- [ ] Leave catch-all **disabled** (Cloudflare's default action is drop).
- [ ] Confirm the apex now holds exactly one SPF TXT.

### Task 6: Test Inbound

- [ ] Send from an external account to `russel@questesports.lk`.
- [ ] Confirm arrival in Russel's Gmail.
- [ ] Confirm the Google Search Console TXT still resolves and the site is up.

### Task 7: Verify The Apex Domain In Resend — **STOP** for DNS

- [ ] In Resend, add `questesports.lk` as a **second domain**, region
      **ap-northeast-1** to match the existing setup.
- [ ] Publish the records Resend generates. Expect
      `resend._domainkey.questesports.lk` plus an MX and TXT at
      `send.questesports.lk`. These are new hostnames and do not collide with the
      existing `mail.questesports.lk` set or with Cloudflare's apex SPF.
- [ ] Wait for Resend to report the domain verified.
- [ ] Re-confirm `mail.questesports.lk` verification is still green.

### Task 8: Gmail Send-As Over Resend SMTP — **STOP** for credentials

- [ ] Create a **separate** Resend API key with sending permission, restricted to
      `questesports.lk`. Do not reuse the production website key. Never paste the
      full key into a file, a log, or this document.
- [ ] In Gmail: Settings -> Accounts and Import -> Send mail as -> Add another
      email address.
      - Name: `Russel | Quest Esports`
      - Email: `russel@questesports.lk`
      - Uncheck "Treat as an alias" so replies are threaded correctly.
      - SMTP server: `smtp.resend.com`, port `465` (SSL) — Resend also supports
        `587`/`2587` with STARTTLS if Gmail rejects 465.
      - Username: `resend`
      - Password: the new API key.
- [ ] Gmail sends a confirmation code to `russel@questesports.lk`; it arrives via
      Cloudflare routing. Enter the code.
- [ ] Set the default From, and set "Reply from the same address the message was
      sent to."

**Known caveats to accept before doing this:**
- Resend is a transactional ESP. Personal correspondence sent through it appears
  in Resend's message logs, and shares the account's sending reputation and
  free-tier quota (3,000/month, 100/day) with the site's verification and
  password-reset mail.
- If either is unacceptable, the alternative for outbound human mail is a real
  hosted mailbox — Google Workspace (~$7/user/month), or a low-cost provider such
  as Purelymail or Migadu. Those are outside the approved provider set and need
  explicit approval first. Inbound via Cloudflare stays the same either way.

### Task 9: Authentication And Reply Behaviour

- [ ] Send from Gmail as `russel@questesports.lk` to an external account.
- [ ] In the recipient, More -> Show original. Confirm SPF, DKIM and DMARC all
      show PASS, and note the `d=` signing domain and the Return-Path.
- [ ] Reply to an inbound message and confirm the From is `russel@questesports.lk`,
      not Russel's personal Gmail.
- [ ] Confirm the personal Gmail address is not exposed in the visible From or
      Reply-To. Document any forwarding header that unavoidably carries it.
- [ ] Add `rua=mailto:` reporting to the existing `_dmarc` record and keep
      `p=none` until reports confirm both Resend domains are aligned. Only then
      consider `p=quarantine`.

### Task 10: Re-Test Application Email

- [ ] `cd backend && npm run mail:verify` against production config.
- [ ] Trigger a real signup verification and a real password reset.
- [ ] Check `background_jobs` for `status=failed` rows and `lastError`.
- [ ] Confirm the From is still `no-reply@mail.questesports.lk` and DKIM still
      signs as `mail.questesports.lk`.

### Task 11: Documentation

- [ ] Add a DNS and inbound-routing section to [production-runbook.md](docs/production-runbook.md)
      recording the Cloudflare zone, the destination Gmail, and the rollback
      nameservers.
- [ ] Note in [email-system.md](docs/email-system.md) that `questesports.lk` and
      `mail.questesports.lk` are two separate verified Resend domains with
      different purposes, and that the website must keep using the subdomain.
- [ ] Document how to add a future address: Cloudflare -> Email Routing -> Routing
      rules -> Create address. No DNS change, no code change.
- [ ] Decide whether `admin@questesports.lk` (the Web Push contact default in
      [env.js:321](backend/src/config/env.js#L321)) should get a routing rule so it
      stops being an unreachable address.

---

## 6. Aliases Versus Mailboxes

A Cloudflare routing rule is an **alias**: no storage, no login, no password. Mail
addressed to it is forwarded and lives only in the destination Gmail. Outbound
capability is separate and comes from Gmail Send-As.

A **hosted mailbox** has its own storage, credentials, IMAP/SMTP access, and can
be handed to a different person later. That matters when Russel leaves the role
and `russel@questesports.lk` needs to survive independently of his personal Gmail.
Aliases are the right call now; note the limitation before creating shared staff
addresses.

## 7. Catch-All

Leave `*@questesports.lk` disabled. A catch-all accepts every typo and every
address a spammer invents, forwards it all into a personal inbox, confirms to
senders that the domain accepts mail for anything, and makes per-address filtering
meaningless. Enable only on explicit request, and only with a filter in place.

## 8. Rollback

| Failure | Action |
| --- | --- |
| Site or API breaks after nameserver cutover | Restore the NameBirth nameservers at the registrar. Propagation is the recovery time. |
| Application email stops | Compare `resend._domainkey.mail.questesports.lk` and `send.mail.questesports.lk` against 1.1 and restore any missing record. |
| Inbound routing misbehaves | Disable Email Routing in Cloudflare; nothing else depends on the apex MX. |
| Gmail Send-As fails or is rejected | Delete the Send-As entry and revoke the second Resend key. Inbound forwarding is unaffected. |

## 9. Cost

| Item | Cost |
| --- | --- |
| Cloudflare DNS + Email Routing | Free |
| Gmail inbox | Existing |
| Resend | Existing account, free tier — 3,000/month, 100/day, shared with app mail |
| Mailbox hosting | None |
| Domain renewal at register.lk | Unchanged |

Recurring cost of this plan: **zero**, provided combined app and human volume
stays inside Resend's free tier. Re-check current Resend pricing before relying on
this.

## 10. Final Report Template

Fill in after Task 10, using measured values only.

| Component | Status | Note |
| --- | --- | --- |
| Website reachable | | |
| API reachable | | |
| Application email delivering | | |
| Cloudflare Email Routing active | | |
| `russel@questesports.lk` receiving | | |
| Gmail Send-As configured | | |
| `russel@questesports.lk` sending | | |
| Reply identity correct | | |
| SPF | | Return-Path domain |
| DKIM | | `d=` domain |
| DMARC | | alignment mode |
