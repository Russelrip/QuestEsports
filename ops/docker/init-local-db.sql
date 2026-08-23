-- Local development database bootstrap.
--
-- Mirrors the two-schema topology documented in docs/setup-and-deployment.md:
-- Prisma owns `public`, the FastAPI service owns `valorant`, and the two never
-- share a runtime role. Locally this replaces the shared Supabase test project,
-- so a developer can work without touching a remote database at all.
--
-- Passwords here are LOCAL-ONLY fixtures for a container that listens on
-- 127.0.0.1. They are deliberately not secrets and must never be reused.

-- The FastAPI runtime role. Its migration runner creates the `valorant` schema
-- and applies the grants and RLS policies to this role.
CREATE ROLE val_runtime LOGIN PASSWORD 'local_val_runtime';

-- Quest connects as the owner locally, matching the documented local setup
-- where Quest runs as the project owner on `public`.
GRANT ALL ON DATABASE quest TO val_runtime;
