const { closeDatabase } = require("../src/lib/database");
const { applyDataHygiene, previewDataHygiene } = require("../src/lib/data-hygiene");

const apply = process.argv.includes("--apply");

const main = async () => {
  const before = await previewDataHygiene();
  process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "preview", before }, null, 2)}\n`);
  if (!apply) return;
  const changed = await applyDataHygiene();
  const after = await previewDataHygiene();
  process.stdout.write(`${JSON.stringify({ changed, after }, null, 2)}\n`);
};

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
