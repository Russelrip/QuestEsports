#!/bin/sh
set -eu

certificate=${POSTGRES_CERT_RUNTIME_FILE:-/run/postgresql/tls/server.crt}
ca_certificate=${POSTGRES_CA_RUNTIME_FILE:-/run/postgresql/tls/ca.crt}
private_key=${POSTGRES_KEY_RUNTIME_FILE:-/run/postgresql/tls/server.key}
database=${POSTGRES_DB:-quest}
user=${POSTGRES_USER:-postgres}
host=quest-postgres
port=5432

test -r "$certificate"
test -r "$ca_certificate"
test -r "$private_key"

# Check the live listener, not merely the mounted certificate. verify-full
# validates both the private CA chain and the hostname SAN during the actual
# PostgreSQL TLS handshake; the explicit hostname and IP checks keep both
# documented client identities in the certificate contract and prevent a
# CN-only or DNS-only certificate from being accepted by policy.
openssl x509 -in "$certificate" -noout -checkhost quest-postgres >/dev/null
openssl x509 -in "$certificate" -noout -checkip 127.0.0.1 >/dev/null
openssl x509 -in "$certificate" -noout -ext subjectAltName |
  grep -Eq 'DNS:quest-postgres([,[:space:]]|$)'
openssl x509 -in "$certificate" -noout -ext subjectAltName |
  grep -Eq 'IP Address:127\.0\.0\.1([,[:space:]]|$)'
pg_isready \
  -d "host=$host port=$port dbname=$database user=$user sslmode=verify-full sslrootcert=$ca_certificate" \
  >/dev/null
