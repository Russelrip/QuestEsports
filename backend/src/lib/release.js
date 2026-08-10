const API_COMPATIBILITY_VERSION = 2;

const getApiCapabilities = () => ({
  apiCompatibilityVersion: API_COMPATIBILITY_VERSION,
  features: {
    paginatedMedia: true,
    headerOnlyOrderTokens: true,
    transactionalTicketConfirmation: true,
    mobileOAuthPkce: true,
  },
});

module.exports = { API_COMPATIBILITY_VERSION, getApiCapabilities };
