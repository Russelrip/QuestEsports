UPDATE "background_jobs"
SET "payload" = "payload" - 'rawToken' - 'tokenCiphertext'
WHERE
  "status" IN ('succeeded', 'failed')
  AND (
    "payload" ? 'rawToken'
    OR "payload" ? 'tokenCiphertext'
  );
