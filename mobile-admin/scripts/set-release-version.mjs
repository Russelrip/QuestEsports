import { readFile, writeFile } from "node:fs/promises";

const [, , rawTag, rawVersionCode] = process.argv;
const version = String(rawTag || "").replace(/^admin-v/, "");
const versionCode = Number.parseInt(String(rawVersionCode || ""), 10);

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("Release tag must use admin-vMAJOR.MINOR.PATCH.");
}
if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > 2_100_000_000) {
  throw new Error("Android versionCode must be a positive 32-bit integer.");
}

const appConfig = JSON.parse(await readFile(new URL("../app.json", import.meta.url), "utf8"));
appConfig.expo.version = version;
appConfig.expo.android.versionCode = versionCode;
await writeFile(new URL("../app.json", import.meta.url), `${JSON.stringify(appConfig, null, 2)}\n`);
