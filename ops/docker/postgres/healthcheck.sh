#!/bin/sh
set -eu

certificate=${POSTGRES_CERT_RUNTIME_FILE:-/run/postgresql/tls/server.crt}
ca_certificate=${POSTGRES_CA_RUNTIME_FILE:-/run/postgresql/tls/ca.crt}
database=${POSTGRES_DB:-quest}
user=${POSTGRES_USER:-postgres}
host=quest-postgres
port=5432

test -r "$certificate"
test -r "$ca_certificate"

# Check the live listener, not merely the mounted certificate. verify-full
# validates both the private CA chain and the hostname SAN during the actual
# PostgreSQL TLS handshake; the explicit checkhost keeps the SAN requirement
# visible and prevents a CN-only certificate from being accepted by policy.
openssl x509 -in "$certificate" -noout -checkhost quest-postgres >/dev/null
openssl x509 -in "$certificate" -noout -ext subjectAltName |
  grep -Eq 'DNS:quest-postgres([,[:space:]]|$)'
pg_isready \
  -d "host=$host port=$port dbname=$database user=$user sslmode=verify-full sslrootcert=$ca_certificate" \
  >/dev/null
