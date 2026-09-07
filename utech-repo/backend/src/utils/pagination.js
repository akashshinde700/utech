'use strict';

// Parse standard query pagination + sorting.
// ?page=1&pageSize=20&sortBy=createdAt&sortDir=desc&q=search
function parseListQuery(q, allowedSorts = ['createdAt']) {
  // NaN-safe: ?page=abc used to poison skip/take and 500 the whole list
  const pageNum = parseInt(q.page, 10);
  const sizeNum = parseInt(q.pageSize, 10);
  const page = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
  const pageSize = Math.min(100, Math.max(1, Number.isFinite(sizeNum) && sizeNum > 0 ? sizeNum : 20));
  const sortBy = allowedSorts.includes(q.sortBy) ? q.sortBy : allowedSorts[0];
  const sortDir = q.sortDir === 'asc' ? 'asc' : 'desc';
  const search = (q.q || '').trim();
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize, sortBy, sortDir, search };
}

function paginated(items, total, page, pageSize) {
  return {
    items,
    pagination: {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    },
  };
}

module.exports = { parseListQuery, paginated };
