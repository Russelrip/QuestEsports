# Quest PostgreSQL 17 production contract

This directory contains the first-boot role bootstrap and the PostgreSQL
healthcheck used by `ops/docker/compose.production.yml`. The Compose file is
the only production database topology: PostgreSQL 17 Bookworm is supplied as
`POSTGRES_IMAGE` by the signed release manifest and is never built or exposed
on a host port.

## Host preparation

The root-capable host bootstrap actor creates these directories before starting
the stack:

```text
/srv/quest-esports/postgres/17/data
/srv/quest-esports/postgres/init
/srv/quest-esports/uploads
/srv/quest-esports/private
/etc/quest-esports/tls
/etc/quest-esports/postgres-healthcheck.sh
```

The checked-in `001-bootstrap-roles.sql` is copied to
`/srv/quest-esports/postgres/init/001-bootstrap-roles.sql`. The host operator
also installs `healthcheck.sh` as
`/etc/quest-esports/postgres-healthcheck.sh` before startup. The host operator
must provision `/etc/quest-esports/tls/quest-private-ca.crt`,
`/etc/quest-esports/tls/quest-postgres.crt`, and
`/etc/quest-esports/tls/quest-postgres.key` from the private CA process; no
certificate or key is stored in this repository. Mounts are read-only runtime
files. The key must be readable by the PostgreSQL container user and must not
be group/world writable.

The PostgreSQL certificate **must** contain `DNS:quest-postgres` in its SAN.
Verify the actual provisioned certificate before startup:

```bash
openssl x509 -in /etc/quest-esports/tls/quest-postgres.crt \
  -noout -checkhost quest-postgres
```

The command must report a matching identity. A common name without that SAN is
not sufficient for `sslmode=verify-full`.

## Four-role and schema contract

The bootstrap creates four distinct roles:

| Role | Schema | Responsibility |
| --- | --- | --- |
| `quest_migrator` | `public` | Quest Prisma DDL and migrations |
| `quest_runtime` | `public` | Quest application DML only |
| `val_migrator` | `valorant` | VALORANT migration ledger and DDL |
| `val_runtime` | `valorant` | VALORANT application DML only |

`public` is owned by `quest_migrator`; `valorant` is owned by
`val_migrator`. Runtime roles receive schema usage, table DML, and sequence
usage. They do not receive schema ownership or DDL privileges, and neither
runtime role receives privileges on the other service's schema. `PUBLIC` has no
privileges on `valorant`. Default privileges are set for each migrator so new
tables and sequences retain this posture.

The SQL creates login roles without embedding passwords. Before admitting a
runtime or migrator writer, the operator sets each role password through the
secret-management/bootstrap procedure (for example, an interactive `psql`
password operation or an approved secret-injection command). Passwords must
never be placed in this repository, the Compose file, an image layer, or an
image tag. The four URL variables in the production env file then use those
secret-managed values.

Run the bootstrap only as the PostgreSQL bootstrap administrator. It is
idempotent and is intended for a fresh data directory or an explicit,
operator-approved role repair; it does not replace either repository's
migration ledger.

## TLS consumers

Quest's `DATABASE_URL` and `DIRECT_URL` use libpq's
`sslmode=verify-full&sslrootcert=/run/secrets/quest-private-ca.crt` and the
stable host `quest-postgres`. The Quest backend receives the CA as a read-only
runtime file and also exposes it through `NODE_EXTRA_CA_CERTS` for the private
VALORANT HTTPS client. The sibling VALORANT Compose deployment must mount the
same approved CA trust material and use its asyncpg SSL-context equivalent;
`sslmode` is not an asyncpg URL parameter.

The database healthcheck runs `pg_isready` and checks the provisioned
certificate against `quest-postgres`. A successful process check without a
valid SAN is not considered healthy.
