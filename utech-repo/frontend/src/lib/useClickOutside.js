import { useEffect } from 'react';

// useClickOutside(ref, onAway, opts) — shared popover/dropdown dismissal hook
// (task 6-a). Fires `onAway` when a mousedown/touchstart lands outside `ref`
// and, by default, when Escape is pressed. Pass { active: false } to pause the
// listeners while the popover is closed; pass { escape: false } to opt out of
// the Escape handling. Used by SearchableSelect, the topbar user dropdown and
// the notifications popover.
export default function useClickOutside(ref, onAway, { active = true, escape = true, events = ['mousedown', 'touchstart'] } = {}) {
  useEffect(() => {
    if (!active) return undefined;

    const handlePointer = (e) => {
      const el = ref?.current;
      if (el && !el.contains(e.target)) onAway(e);
    };
    const handleKey = (e) => {
      if (escape && e.key === 'Escape') onAway(e);
    };

    events.forEach((ev) => document.addEventListener(ev, handlePointer));
    if (escape) document.addEventListener('keydown', handleKey);
    return () => {
      events.forEach((ev) => document.removeEventListener(ev, handlePointer));
      if (escape) document.removeEventListener('keydown', handleKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, escape, onAway]);
}
