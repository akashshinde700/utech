import { useState } from 'react';
import { CheckSquare, Square, ListChecks } from 'lucide-react';
import api from '../../lib/api';
import EmptyState from '../ui/EmptyState';
import toast from 'react-hot-toast';

export default function ChecklistWidget({ jobcardId, checklist, editable, onUpdated }) {
  const [busy, setBusy] = useState(false);

  async function toggle(key) {
    if (!editable || busy) return;
    const next = (checklist || []).map((i) => (i.key === key ? { ...i, done: !i.done } : i));
    setBusy(true);
    try {
      const r = await api.patch(`/jobcards/${jobcardId}/progress`, { checklist: next });
      onUpdated(r.data);
    } catch {
      toast.error('Could not update checklist');
    } finally {
      setBusy(false);
    }
  }

  if (!(checklist || []).length) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No checklist items"
        description="Progress checklist items appear here once defined."
        className="py-8"
      />
    );
  }

  const doneCount = checklist.filter((i) => i.done).length;

  return (
    <div className="flex flex-col gap-1">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
        {doneCount} of {checklist.length} done
      </div>
      {checklist.map((item) => (
        <button
          key={item.key}
          type="button"
          disabled={!editable || busy}
          onClick={() => toggle(item.key)}
          className={`flex items-center gap-2 text-sm text-left rounded-lg border border-transparent px-2 py-1.5 transition-colors ${
            editable ? 'hover:bg-slate-50 hover:border-slate-100 cursor-pointer' : 'cursor-default'
          } disabled:opacity-60`}
        >
          {item.done ? (
            <CheckSquare className="w-4 h-4 text-brand-600 shrink-0" aria-hidden="true" />
          ) : (
            <Square className="w-4 h-4 text-slate-300 shrink-0" aria-hidden="true" />
          )}
          <span className={item.done ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-700'}>
            {item.label}
          </span>
        </button>
      ))}
    </div>
  );
}
