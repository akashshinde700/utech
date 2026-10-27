import { useCallback, useEffect, useState } from 'react';
import api from './api';

// Master lists are paginated to 100 on the server. Cache search results so a
// previously selected option remains labeled when another row is searched.
function mergeById(existing, incoming) {
  const rows = new Map(existing.map((row) => [String(row.id), row]));
  for (const row of incoming.filter(Boolean)) {
    const key = String(row.id);
    rows.set(key, { ...rows.get(key), ...row });
  }
  return [...rows.values()];
}

export default function useRemoteOptions(endpoint, filters = {}) {
  const filterKey = JSON.stringify(filters);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(false);
  const include = useCallback((rows) => setItems((old) => mergeById(old, rows)), []);
  const search = useCallback(async (q = '') => {
    try {
      const { data } = await api.get(endpoint, { params: { ...JSON.parse(filterKey), pageSize: 100, q } });
      include(data.items || []);
      setError(false);
    } catch {
      setError(true);
    }
  }, [endpoint, filterKey, include]);

  useEffect(() => { search(); }, [search]);
  return { items, search, error, include };
}
