BEGIN;

ALTER TABLE "recruitment_applications"
ADD COLUMN "privacy_policy_version" TEXT,
ADD COLUMN "privacy_accepted_at" TIMESTAMP(3);

COMMIT;
