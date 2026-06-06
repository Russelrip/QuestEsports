ALTER TABLE "recruitment_applications"
ALTER COLUMN "applicant_id_number_ciphertext" DROP NOT NULL;

ALTER TABLE "recruitment_applications"
ADD COLUMN "details" JSONB NOT NULL DEFAULT '{}';
