import { useEffect, useState } from 'react';
import {
  TrendingUp, DollarSign, ShoppingCart, Calendar,
  BarChart3, LineChart as LineChartIcon, AlertTriangle
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import { inr } from '../../lib/format';

function MetricCard({ title, value, subtitle, icon: Icon, trend }) {
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
      {trend != null && (
        <div className={`text-sm mt-3 font-medium ${trend >= 0 ? 'text-success-600' : 'text-danger-600'}`}>
          {trend >= 0 ? '↗' : '↘'} <span className="tabular-nums">{Math.abs(trend).toFixed(1)}%</span> from last month
        </div>
      )}
    </div>
  );
}

// chart container header styled after the shared FormSection; no-data charts
// render the shared EmptyState instead of an empty recharts grid
function ChartShell({ icon: Icon, title, children, empty, emptyIcon }) {
  return (
    <div className="card-flat p-5 sm:p-6">
      <div className="flex items-start gap-3 mb-5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600" aria-hidden="true">
          <Icon className="w-4 h-4" />
        </span>
        <h3 className="pt-2 text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="h-80">
        {empty ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState icon={emptyIcon} title={empty} className="py-6" />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-5 space-y-3">
            <div className="skeleton h-3 w-20 rounded" />
            <div className="skeleton h-8 w-28 rounded" />
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

export default function SalesAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/dashboard/sales-analytics');
      setData(r.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load sales analytics');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  if (loading) return <LoadingGrid />;

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

  const monthly = data?.monthly || [];
  const topProducts = data?.topProducts || [];
  const totals = data?.totals || { totalSales: 0, totalInvoices: 0, avgOrderValue: 0, growthPct: 0 };
  const growthPct = totals.growthPct ?? 0;

  return (
    <div className="animate-fade-in space-y-8">
      <PageHeader
        title="Sales Analytics"
        subtitle="Sales performance over the last 6 months"
        icon={BarChart3}
      />

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          title="Total Sales"
          value={inr(totals.totalSales)}
          subtitle="Last 6 months"
          icon={DollarSign}
        />
        <MetricCard
          title="Total Invoices"
          value={Number(totals.totalInvoices ?? 0).toLocaleString('en-IN')}
          subtitle="Issued / paid orders"
          icon={ShoppingCart}
        />
        <MetricCard
          title="Average Order Value"
          value={inr(totals.avgOrderValue)}
          subtitle="Per invoice"
          icon={TrendingUp}
        />
        <MetricCard
          title="Monthly Growth"
          value={`${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(1)}%`}
          subtitle="Current month vs previous"
          icon={Calendar}
          trend={growthPct}
        />
      </div>

      {/* Sales Trend Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartShell icon={LineChartIcon} title="Sales Trend" empty={monthly.length === 0 ? 'No sales recorded yet' : null} emptyIcon={LineChartIcon}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
              <YAxis stroke="#64748b" fontSize={12} tickFormatter={(value) => inr(value)} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                }}
                formatter={(value, name) => [
                  name === 'sales' ? inr(value) : value,
                  name === 'sales' ? 'Sales' : 'Invoices'
                ]}
              />
              <Area
                type="monotone"
                dataKey="sales"
                stroke="#7c3aed"
                fill="#8b5cf6"
                fillOpacity={0.3}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartShell>

        <ChartShell icon={BarChart3} title="Monthly Performance" empty={monthly.length === 0 ? 'No sales recorded yet' : null} emptyIcon={BarChart3}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
              <YAxis stroke="#64748b" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                }}
                formatter={(value) => [value, 'Invoices']}
              />
              <Bar dataKey="invoices" fill="#fb923c" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartShell>
      </div>

      {/* Top Products */}
      <div className="card-flat p-5 sm:p-6">
        <div className="flex items-start gap-3 mb-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600" aria-hidden="true">
            <TrendingUp className="w-4 h-4" />
          </span>
          <h3 className="pt-2 text-sm font-semibold text-slate-800">Top Performing Products</h3>
        </div>
        <div className="overflow-x-auto scroll-x-hint">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className="table-th rounded-tl-xl">Product</th>
                <th className="table-th text-right">Sales Value</th>
                <th className="table-th text-right rounded-tr-xl">Quantity Sold</th>
              </tr>
            </thead>
            <tbody>
              {topProducts.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-0">
                    <EmptyState
                      icon={TrendingUp}
                      title="No sales in the last 6 months"
                      description="Top products will appear here once invoices are issued."
                    />
                  </td>
                </tr>
              ) : topProducts.map((product, index) => (
                <tr key={index} className="hover:bg-slate-50/50 transition-colors">
                  <td className="table-td font-semibold text-slate-800">{product.name}</td>
                  <td className="table-td text-right font-semibold text-success-600 tabular-nums">{inr(product.sales)}</td>
                  <td className="table-td text-right tabular-nums">{product.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
