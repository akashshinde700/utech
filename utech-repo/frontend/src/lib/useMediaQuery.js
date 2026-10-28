import { useEffect, useState } from 'react';

// useMediaQuery — reactive CSS media query for the rare cases where CSS
// alone cannot restructure the DOM (e.g. DataTable swapping a wide <table>
// for stacked record cards on phones). Prefer plain responsive classes;
// reach for this only when the markup itself must change.
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);
    setMatches(mql.matches);
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
    else mql.addListener(onChange);
    return () => {
      if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange);
      else mql.removeListener(onChange);
    };
  }, [query]);

  return matches;
}
