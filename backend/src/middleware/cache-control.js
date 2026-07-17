const cachePublicData = ({ browserSeconds = 15, sharedSeconds = 30 } = {}) =>
  (req, res, next) => {
    res.setHeader(
      "Cache-Control",
      `public, max-age=${browserSeconds}, s-maxage=${sharedSeconds}, stale-while-revalidate=${sharedSeconds}`
    );
    next();
  };

module.exports = { cachePublicData };
