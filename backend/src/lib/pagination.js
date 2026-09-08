const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

const normalizePageNumber = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

// maxPageSize is opt-in per endpoint rather than a single global ceiling: the
// admin registrations table needs to show 100 rows at once, and raising the
// shared limit would widen every other list endpoint's maximum response at the
// same time.
const buildPagination = ({ page, pageSize }, { maxPageSize = MAX_PAGE_SIZE } = {}) => ({
  page: normalizePageNumber(page, DEFAULT_PAGE),
  pageSize: Math.min(
    normalizePageNumber(pageSize, DEFAULT_PAGE_SIZE),
    normalizePageNumber(maxPageSize, MAX_PAGE_SIZE)
  ),
});

const buildPagedResponse = ({ items, total, page, pageSize }) => ({
  items,
  pagination: {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  },
});

module.exports = {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  normalizePageNumber,
  buildPagination,
  buildPagedResponse,
};
