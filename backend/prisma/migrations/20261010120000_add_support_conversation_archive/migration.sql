-- Staff can archive a support conversation to clear it from the queue without
-- losing it. NULL means not archived, which is every existing row.
--
-- Additive only: a nullable column with no default is a catalog change in
-- PostgreSQL, so this applies to a running deployment without rewriting the
-- table.
ALTER TABLE "support_conversations" ADD COLUMN "archived_at" TIMESTAMP(3);
