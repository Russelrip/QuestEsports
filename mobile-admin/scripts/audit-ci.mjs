import { spawnSync } from "node:child_process";

const minimumSeverity = "high";
const severityRanks = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const allowedAdvisories = new Map([
  // node-forge has no fixed release at all: the advisory covers every published
  // version, and the only remedy npm offers is downgrading Expo 57 to 44, which
  // is not one. It reaches us through @expo/cli and its code-signing
  // certificates, so it runs on a developer or build machine and never inside
  // the shipped app. Revisit when node-forge publishes a patched release.
  [1240912, {
    packageName: "node-forge",
    advisory: "GHSA-86w9-cpqp-85rv",
    owner: "repository-owner",
    expiresOn: "2027-01-05",
    scope: "Expo CLI code-signing tooling only; never bundled into the shipped app.",
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
