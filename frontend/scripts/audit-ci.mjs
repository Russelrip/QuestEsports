import { spawnSync } from "node:child_process";

// The same gate mobile-admin runs, and deliberately a copy rather than a shared
// module: the two workspaces have separate dependency trees and separate npm
// installs, so each owns the exceptions it has actually reviewed.
const minimumSeverity = "high";
const severityRanks = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const allowedAdvisories = new Map([
  // braces has no fixed release: the advisory covers every published version,
  // and the only remedy npm offers is downgrading eslint-config-next from 16 to
  // 14, which would stop it linting Next 16 at all. It reaches us solely through
  // @next/eslint-plugin-next -> fast-glob -> micromatch, so it runs in lint on a
  // developer or CI machine and is never part of a build output or served to a
  // browser. Revisit when braces publishes a patched release.
  [1240992, {
    packageName: "braces",
    advisory: "GHSA-vfj7-8cjw-p6xm",
    owner: "repository-owner",
    expiresOn: "2027-01-05",
    scope: "ESLint tooling only; never bundled or served.",
  }],
]);

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const audit = spawnSync(npmCommand, ["audit", "--json"], {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: process.platform === "win32",
});

if (audit.error) {
  console.error(`Could not run npm audit: ${audit.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error("npm audit did not return valid JSON.");
  if (audit.stderr) console.error(audit.stderr.trim());
  process.exit(1);
}

if (report.error || report.auditReportVersion !== 2 || typeof report.vulnerabilities !== "object") {
  console.error("npm audit returned an error or an unsupported report format.");
  if (report.error) console.error(JSON.stringify(report.error));
  process.exit(1);
}

const findings = new Map();
for (const vulnerability of Object.values(report.vulnerabilities || {})) {
  for (const cause of vulnerability.via || []) {
    if (typeof cause !== "object" || cause === null) continue;
    if ((severityRanks[cause.severity] ?? -1) < severityRanks[minimumSeverity]) continue;
    findings.set(cause.source, cause);
  }
}

const blocked = [];
const allowed = [];

for (const finding of findings.values()) {
  const exception = allowedAdvisories.get(finding.source);
  const exceptionExpired = exception && Date.now() > Date.parse(`${exception.expiresOn}T23:59:59Z`);
  if (
    exception?.packageName === finding.name &&
    finding.url?.endsWith(exception.advisory) &&
    !exceptionExpired
  ) {
    allowed.push(finding);
  } else {
    blocked.push(finding);
  }
}

for (const finding of allowed) {
  const exception = allowedAdvisories.get(finding.source);
  console.warn(
    `Allowed temporary build-tool advisory until ${exception.expiresOn} (${exception.owner}): ${finding.name} ${finding.url}`,
  );
}

if (blocked.length > 0) {
  console.error(`npm audit found ${blocked.length} unapproved ${minimumSeverity}-or-higher advisory finding(s):`);
  for (const finding of blocked) {
    console.error(`- ${finding.severity}: ${finding.name} - ${finding.title} (${finding.url})`);
  }
  process.exit(1);
}

console.log(`npm audit passed with ${allowed.length} explicitly allowed build-tool advisory finding(s).`);
