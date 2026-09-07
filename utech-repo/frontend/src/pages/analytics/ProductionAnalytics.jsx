import { useEffect, useState } from 'react';
import { Factory, ClipboardCheck, TrendingUp, BarChart3, AlertTriangle } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';

function MetricCard({ title, value, subtitle, icon: Icon }) {
  return (
    <div className="card p-5 sm:p-6 hover:shadow-lg transition-all duration-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">{title}</div>
          <div className="text-3xl font-bold text-slate-900 mb-1 tabular-nums">{value}</div>
          <div className="text-sm text-slate-600">{subtitle}</div>
        </div>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600" aria-hidden="true">
          <Icon className="w-5 h-5" />
        </span>
      </div>
    </div>
  );
}

export default function ProductionAnalytics() {
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/dashboard/summary');
      setTrend(r.data.productionTrend || []);
    } catch (err) {
      console.error(err);
      setError('Failed to load production analytics');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-5 space-y-3">
              <div className="skeleton h-3 w-20 rounded" />
              <div className="skeleton h-8 w-24 rounded" />
              <div className="skeleton h-3 w-24 rounded" />
            </div>
          ))}
        </div>
        <div className="card-flat p-5 space-y-4">
          <div className="skeleton h-4 w-40 rounded" />
          <div className="skeleton h-64 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-10 text-center max-w-md mx-auto mt-10">
        <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-danger-50 text-danger-600">
          <AlertTriangle className="w-6 h-6" aria-hidden="true" />
        </span>
        <div className="font-semibold text-slate-800 mb-1">Couldn't load analytics</div>
        <div className="text-sm text-slate-500 mb-4">{error}</div>
        <button className="btn-primary" onClick={load}>Retry</button>
      </div>
    );
  }

  const totalPlanned = trend.reduce((s, w) => s + w.planned, 0);
  const totalCompleted = trend.reduce((s, w) => s + w.completed, 0);
  const efficiency = totalPlanned ? Math.round((totalCompleted / totalPlanned) * 100) : 0;

  return (
    <div className="animate-fade-in space-y-8">
      <PageHeader title="Production Analytics" subtitle="Planned vs. completed quantity, last 4 weeks" icon={BarChart3} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard title="Planned Quantity" value={totalPlanned.toLocaleString('en-IN')} subtitle="Last 4 weeks" icon={ClipboardCheck} />
        <MetricCard title="Completed Quantity" value={totalCompleted.toLocaleString('en-IN')} subtitle="Last 4 weeks" icon={Factory} />
        <MetricCard title="Efficiency" value={`${efficiency}%`} subtitle="Completed vs. planned" icon={TrendingUp} />
      </div>

      <div className="card-flat p-5 sm:p-6">
        <div className="flex items-start gap-3 mb-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600" aria-hidden="true">
            <BarChart3 className="w-4 h-4" />
          </span>
          <h3 className="pt-2 text-sm font-semibold text-slate-800">Weekly Planned vs. Completed</h3>
        </div>
        <div className="h-80">
          {trend.length === 0 || (totalPlanned === 0 && totalCompleted === 0) ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon={Factory}
                title="No production batches in the last 4 weeks"
                description="Weekly planned vs. completed appears once batches are logged."
                className="py-6"
              />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="week" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} />
                <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px' }} />
                <Bar dataKey="planned" fill="#fb923c" radius={[4, 4, 0, 0]} />
                <Bar dataKey="completed" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
