-- A player's in-game name, set on their profile and shown in place of their
-- real name wherever a solo entry is listed publicly. NULL means not set yet,
-- which is every existing account.
--
-- Additive only: a nullable column with no default is a catalog change in
-- PostgreSQL, so this applies to a running deployment without rewriting the
-- table.
ALTER TABLE "users" ADD COLUMN "in_game_name" TEXT;
