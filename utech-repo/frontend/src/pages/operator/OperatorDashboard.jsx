import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Calendar, UserCircle, Clock } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import { date, datetime } from '../../lib/format';

export default function OperatorDashboard() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/jobcards', { params: { pageSize: 100 } })
      .then((r) => setItems(r.data.items))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    // skeleton mirrors the card grid so the layout doesn't jump when data lands
    return (
      <div>
        <PageHeader title="My Projects" subtitle="Projects assigned to you" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-3 w-20 rounded" />
                  <div className="skeleton h-5 w-36 rounded" />
                </div>
                <div className="skeleton h-5 w-16 rounded-full" />
              </div>
              <div className="skeleton h-4 w-28 rounded" />
              <div className="skeleton h-2 w-full rounded-full" />
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                <div className="skeleton h-3 w-24 rounded" />
                <div className="skeleton h-3 w-24 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="My Projects" subtitle="Projects assigned to you" />
      {items.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No projects assigned to you yet"
          description="Once a supervisor assigns you to a jobcard, it will appear here."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((jc) => (
            <button
              key={jc.id}
              type="button"
              onClick={() => navigate(`/jobcards/${jc.id}`)}
              className="card p-5 text-left space-y-3 cursor-pointer hover:shadow-lg hover:border-brand-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 transition-all duration-200"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-slate-400 font-medium">{jc.number}</div>
                  <div className="font-bold text-slate-900">{jc.projectNumber || jc.number}</div>
                </div>
                <Badge status={jc.status}>{jc.status}</Badge>
              </div>

              <div className="text-sm text-slate-600 flex items-center gap-1.5">
                <UserCircle className="w-4 h-4 text-slate-400" /> {jc.party?.name || '—'}
              </div>

              <div>
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                  <span>Progress</span>
                  <span className="font-semibold text-brand-700 tabular-nums">{jc.progressPercent}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-brand-600 transition-all duration-500" style={{ width: `${jc.progressPercent}%` }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 pt-1 border-t border-slate-100">
                <div className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Due {date(jc.endDate)}</div>
                <div className="flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5" /> By {jc.createdBy?.name || '—'}</div>
                <div className="flex items-center gap-1 col-span-2"><Clock className="w-3.5 h-3.5" /> Updated {datetime(jc.updatedAt)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
