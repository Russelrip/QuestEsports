const resolveEffectiveTeamLogoName = (registration) => {
  if (registration?.savedTeam !== null && typeof registration?.savedTeam === "object") {
    return registration.savedTeam.logoName ?? null;
  }

  return registration?.teamLogoName ?? null;
};

const getTeamLogoUrl = (filename) => {
  if (filename === null || filename === undefined) return null;
  return `/api/uploads/team-logos/${filename}`;
};

module.exports = {
  resolveEffectiveTeamLogoName,
  getTeamLogoUrl,
};
