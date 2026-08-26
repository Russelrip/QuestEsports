#!/bin/sh
set -eu

certificate=${POSTGRES_CERT_RUNTIME_FILE:-/run/postgresql/tls/server.crt}

test -r "$certificate"
pg_isready -h 127.0.0.1 -p 5432 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-quest}" >/dev/null
openssl x509 -in "$certificate" -noout -checkhost quest-postgres >/dev/null
