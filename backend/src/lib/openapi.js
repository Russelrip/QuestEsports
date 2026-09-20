const { monitoringStatus } = require("./monitoring");
const { suggestedJobBackends } = require("./jobs");
const { apiBaseUrl } = require("./openapi/helpers");
const { components } = require("./openapi/components");
const { corePaths } = require("./openapi/paths-core");
const { ticketsPaths } = require("./openapi/paths-tickets");
const { publicCompetitionPaths } = require("./openapi/paths-public-competition");
const { matchRoomsSupportPaths } = require("./openapi/paths-match-rooms-support");
const { vetoPaths } = require("./openapi/paths-veto");
const { valorantAndStaffPaths } = require("./openapi/paths-valorant-and-staff");
const { accountsAndContentPaths } = require("./openapi/paths-accounts-and-content");
const { adminPaths } = require("./openapi/paths-admin");
const { uploadsPaths } = require("./openapi/paths-uploads");

const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Quest E-sports API",
    version: "2.0.0",
    description:
      "Core contracts for auth, tournament series, configurable registrations, PayHere payments, merchandise, admin workflows, and readiness including the shared clustered realtime transport when enabled.",
  },
  servers: [{ url: apiBaseUrl }],
  tags: [
    { name: "System" },
    { name: "Auth" },
    { name: "Tournaments" },
    { name: "Registrations" },
    { name: "Series" },
    { name: "Shop" },
    { name: "Tickets" },
    { name: "Payments" },
    { name: "Account" },
    { name: "Contact" },
    { name: "Recruitment" },
    { name: "Games" },
    { name: "Rulebooks" },
    { name: "Media" },
    { name: "Teams" },
    { name: "Admin" },
    { name: "Match Rooms" },
    { name: "Notifications" },
    { name: "Support" },
  ],
  components,
  paths: { ...corePaths },
  "x-quest-operations": {
    monitoring: monitoringStatus(),
    suggestedBackgroundJobs: suggestedJobBackends,
  },
};

// Added path by path as features shipped; spread in that order so the
// document lists them exactly as before.
const additionalPaths = {
  ...ticketsPaths,
  ...publicCompetitionPaths,
  ...matchRoomsSupportPaths,
  ...vetoPaths,
  ...valorantAndStaffPaths,
  ...accountsAndContentPaths,
  ...adminPaths,
  ...uploadsPaths,
};

for (const [path, operations] of Object.entries(additionalPaths)) {
  openApiDocument.paths[path] = {
    ...(openApiDocument.paths[path] || {}),
    ...operations,
  };
}

module.exports = {
  openApiDocument,
};
