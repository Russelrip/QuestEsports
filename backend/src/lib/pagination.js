const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

const normalizePageNumber = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const buildPagination = ({ page, pageSize }) => ({
  page: normalizePageNumber(page, DEFAULT_PAGE),
  pageSize: Math.min(
    normalizePageNumber(pageSize, DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE
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
