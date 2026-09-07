import { useEffect, useState } from 'react';
import { Package, AlertTriangle, PieChart as PieChartIcon } from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';

// series palette kept to the app family (violet/amber/pink/green/slate) —
// the old fifth color was sky blue
const COLORS = ['#8b5cf6', '#fb923c', '#ec4899', '#22c55e', '#94a3b8'];

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

export default function InventoryAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/dashboard/summary');
      setData(r.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load inventory analytics');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="card p-5 space-y-3">
              <div className="skeleton h-3 w-20 rounded" />
              <div className="skeleton h-8 w-24 rounded" />
              <div className="skeleton h-3 w-24 rounded" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="card-flat p-5 space-y-4">
              <div className="skeleton h-4 w-32 rounded" />
              <div className="skeleton h-64 w-full rounded-lg" />
            </div>
          ))}
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

  const distribution = data?.inventoryDistribution || [];
  const lowStock = data?.lowStockItems || [];

  return (
    <div className="animate-fade-in space-y-8">
      <PageHeader title="Inventory Analytics" subtitle="Active items by type, and low-stock alerts" icon={PieChartIcon} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <MetricCard title="Total Items" value={(data?.totalItems ?? 0).toLocaleString('en-IN')} subtitle="Active catalog items" icon={Package} />
        <MetricCard title="Low Stock Items" value={lowStock.length} subtitle="Below minimum stock" icon={AlertTriangle} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card-flat p-5 sm:p-6">
          <div className="flex items-start gap-3 mb-5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600" aria-hidden="true">
              <PieChartIcon className="w-4 h-4" />
            </span>
            <h3 className="pt-2 text-sm font-semibold text-slate-800">Items by Type</h3>
          </div>
          <div className="h-80">
            {distribution.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  icon={Package}
                  title="No active items yet"
                  description="Items by type appears once catalog items are added."
                  className="py-6"
                />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={distribution} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value">
                    {distribution.map((entry, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px' }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="card-flat p-5 sm:p-6">
          <div className="flex items-start gap-3 mb-5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600" aria-hidden="true">
              <AlertTriangle className="w-4 h-4" />
            </span>
            <h3 className="pt-2 text-sm font-semibold text-slate-800">Low Stock Items</h3>
          </div>
          {lowStock.length === 0 ? (
            <EmptyState
              icon={Package}
              title="All inventory levels are optimal"
              description="No items are below their minimum stock level right now."
            />
          ) : (
            <div className="overflow-x-auto scroll-x-hint">
              <table className="min-w-full">
                <thead><tr>
                  <th className="table-th">Code</th><th className="table-th">Name</th>
                  <th className="table-th text-right">Current</th><th className="table-th text-right">Min</th>
                </tr></thead>
                <tbody>
                  {lowStock.map((it) => (
                    <tr key={it.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="table-td font-semibold">{it.code}</td>
                      <td className="table-td">{it.name}</td>
                      <td className="table-td text-right text-danger-600 font-semibold tabular-nums">{Number(it.currentStock).toFixed(2)}</td>
                      <td className="table-td text-right text-slate-500 tabular-nums">{Number(it.minStock).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
