import { useEffect, useState } from 'react';
import { Activity, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { datetime } from '../../lib/format';
import EmptyState from '../ui/EmptyState';

const ACTION_LABELS = {
  create: 'Project created',
  update: 'Project updated',
  assign: 'Operator assigned',
  statusChange: 'Status changed',
  progress: 'Progress updated',
  complete: 'Marked as completed',
  revert: 'Reverted',
  upload: 'File uploaded',
  delete: 'File deleted',
};

function describe(e) {
  if (e.source === 'note') return e.kind === 'WORK_UPDATE' ? `Work update: ${e.body}` : `Comment: ${e.body}`;
  return ACTION_LABELS[e.action] || e.action;
}

export default function ActivityTimeline({ jobcardId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get(`/jobcards/${jobcardId}/activity`).then((r) => { if (!cancelled) setEvents(r.data); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [jobcardId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }
  if (!events.length) {
    return (
      <EmptyState
        icon={Activity}
        title="No activity yet"
        description="Status changes, assignments and file uploads will be logged here."
        className="py-8"
      />
    );
  }

  return (
    <div className="relative pl-4 max-h-96 overflow-y-auto">
      <div className="absolute left-1.5 top-1 bottom-1 w-px bg-slate-200" />
      <div className="flex flex-col gap-4">
        {events.map((e) => (
          <div key={e.id} className="relative">
            <div className="absolute -left-[15px] top-1 w-2.5 h-2.5 rounded-full bg-brand-500 ring-4 ring-white" aria-hidden="true" />
            <div className="text-xs text-slate-400">{datetime(e.createdAt)}</div>
            <div className="text-sm text-slate-700 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
              <span>{describe(e)}</span>
              {e.by && <span className="text-slate-400">— {e.by}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
