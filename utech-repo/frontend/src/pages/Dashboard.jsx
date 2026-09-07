import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, ClipboardCheck, Factory, AlertTriangle,
  UsersRound, Package, ArrowUpRight, IndianRupee, BarChart3,
  PieChart, FileText, FilePlus2, Building2
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar,
  PieChart as RechartsPieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import api from '../lib/api';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import { inr } from '../lib/format';
import { useAuth } from '../store/auth';
import { hasPermission } from '../lib/permissions';

// KPI chip tones — brand/success/warning/danger/slate tokens only (the raw
// emerald/teal/cyan/indigo scales are aliased in tailwind.config.js and must
// not be used directly).
const STAT_META = [
  { key: 'salesLast30Days', label: 'Sales (30d)', hintKey: 'invoicesLast30Days', hintFmt: (v) => `${v} invoices`, icon: IndianRupee, color: 'bg-success-50 text-success-700' },
  { key: 'jobcardsActive', label: 'Active Jobcards', icon: ClipboardCheck, color: 'bg-brand-50 text-brand-700' },
  { key: 'pendingJobwork', label: 'Pending Jobwork', hint: 'Issued / partially received', icon: Factory, color: 'bg-warning-50 text-warning-700' },
  { key: 'overdueInvoices', label: 'Overdue Invoices', icon: AlertTriangle, color: 'bg-danger-50 text-danger-700' },
  { key: 'totalParties', label: 'Total Parties', icon: UsersRound, color: 'bg-brand-50 text-brand-700' },
  { key: 'totalItems', label: 'Total Items', icon: Package, color: 'bg-slate-100 text-slate-600' },
];

// primary shortcuts shown above the KPI grid — each gated on the same
// permission the target page's create route requires (permission-aware UI,
// same policy as the sidebar). Hidden entirely when nothing is permitted.
const QUICK_ACTIONS = [
  { to: '/invoices/new', label: 'New Invoice', icon: FileText, perm: 'invoice.create' },
  { to: '/quotations/new', label: 'New Quotation', icon: FilePlus2, perm: 'quotation.create' },
  { to: '/parties/new', label: 'Add Party', icon: Building2, perm: 'party.create' },
];

// StatCard — same KPI language as the analytics pages' MetricCard: label over
// a big tabular-nums value on the left, soft-colored icon chip on the right,
// subtle hover lift. Currency values render via inr(); counts via en-IN.
function StatCard({ meta, value, hint }) {
  const Icon = meta.icon;
  const isCurrency = meta.key === 'salesLast30Days';
  return (
    <div className="card p-5 sm:p-6 hover:shadow-lg transition-all duration-300 animate-slide-up">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">{meta.label}</div>
          <div className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
            {isCurrency ? inr(value) : Number(value ?? 0).toLocaleString('en-IN')}
          </div>
          {hint && <div className="mt-2 text-xs text-slate-400 flex items-center gap-1"><ArrowUpRight className="w-3 h-3" aria-hidden="true" />{hint}</div>}
        </div>
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${meta.color} shadow-sm`} aria-hidden="true">
          <Icon className="w-5 h-5" />
        </span>
      </div>
    </div>
  );
}

// ChartCard — container styled after the shared FormSection header: icon in a
// soft brand circle, small semibold title, muted description line.
function ChartCard({ title, description, children, icon: Icon }) {
  return (
    <div className="card-flat p-5 sm:p-6 hover:shadow-lg transition-all duration-300">
      <div className="flex items-start gap-3 mb-4">
        {Icon && (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600" aria-hidden="true">
            <Icon className="w-4 h-4" />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
        </div>
      </div>
      <div className="h-64">
        {children}
      </div>
    </div>
  );
}

// slate-400 replaces the old sky-blue fifth slice — chart series stick to the
// violet/amber/pink/green/slate family the rest of the app uses.
const PIE_COLORS = ['#8b5cf6', '#fb923c', '#ec4899', '#22c55e', '#94a3b8'];

// No-data placeholder inside a chart card's fixed-height body — the shared
// EmptyState, vertically centered and with slimmer padding than the page-level
// variant.
function ChartEmpty({ icon, title, description }) {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState icon={icon} title={title} description={description} className="py-6" />
    </div>
  );
}

function SalesChart({ data }) {
  if (!data?.length || data.every((d) => d.sales === 0)) {
    return <ChartEmpty icon={TrendingUp} title="No sales in the last 6 months" description="Monthly revenue appears once invoices are issued." />;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
        <YAxis stroke="#64748b" fontSize={12} tickFormatter={(v) => inr(v)} />
        <Tooltip
          contentStyle={{
            backgroundColor: 'white',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
          }}
          formatter={(value) => [inr(value), 'Sales']}
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
  );
}

function ProductionChart({ data }) {
  if (!data?.length || data.every((d) => d.planned === 0 && d.completed === 0)) {
    return <ChartEmpty icon={BarChart3} title="No production batches in the last 4 weeks" description="Planned vs. completed appears once batches are logged." />;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="week" stroke="#64748b" fontSize={12} />
        <YAxis stroke="#64748b" fontSize={12} />
        <Tooltip
          contentStyle={{
            backgroundColor: 'white',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
          }}
        />
        <Bar dataKey="completed" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
        <Bar dataKey="planned" fill="#fb923c" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function InventoryChart({ data }) {
  if (!data?.length) {
    return <ChartEmpty icon={Package} title="No active items yet" description="Inventory distribution appears once items are added." />;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RechartsPieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={5}
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: 'white',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
          }}
        />
        <Legend />
      </RechartsPieChart>
    </ResponsiveContainer>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card p-4 flex items-start gap-4">
          <div className="skeleton w-10 h-10 rounded-xl shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3 w-20 rounded" />
            <div className="skeleton h-6 w-16 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const user = useAuth((s) => s.user);
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/dashboard/summary').then((r) => setData(r.data)).catch(() => {});
  }, []);

  const quickActions = QUICK_ACTIONS.filter((a) => hasPermission(user, a.perm));

  if (!data) {
    return (
      <div>
        <PageHeader title="Smart Dashboard" subtitle="Real-time manufacturing insights" />
        <SkeletonGrid />
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 mt-8">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card-flat p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="skeleton h-9 w-9 rounded-lg" />
                <div className="skeleton h-4 w-32 rounded" />
              </div>
              <div className="skeleton h-56 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-8">
      <PageHeader title="Smart Dashboard" subtitle="Real-time manufacturing insights & analytics" />

      {/* Quick actions — existing routes, hidden when the role can't create */}
      {quickActions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quickActions.map((a) => (
            <Link key={a.to} to={a.to} className="btn-primary">
              <a.icon className="w-4 h-4" aria-hidden="true" /> {a.label}
            </Link>
          ))}
        </div>
      )}

      {/* Key Metrics — collapses to a single column on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {STAT_META.map((meta) => (
          <StatCard
            key={meta.key}
            meta={meta}
            value={data[meta.key]}
            hint={meta.hintKey ? meta.hintFmt(data[meta.hintKey]) : meta.hint}
          />
        ))}
      </div>

      {/* Analytics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        <ChartCard title="Sales Performance" description="Monthly revenue, last 6 months" icon={TrendingUp}>
          <SalesChart data={data.salesTrend} />
        </ChartCard>

        <ChartCard title="Production Efficiency" description="Planned vs. completed, last 4 weeks" icon={BarChart3}>
          <ProductionChart data={data.productionTrend} />
        </ChartCard>

        <ChartCard title="Inventory Distribution" description="Active items by type" icon={PieChart}>
          <InventoryChart data={data.inventoryDistribution} />
        </ChartCard>
      </div>

      {/* Low Stock Alert */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-danger-50 text-danger-600 flex items-center justify-center" aria-hidden="true">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-slate-800 text-lg">Inventory Alerts</div>
            <div className="text-sm text-slate-500">Items below minimum stock levels</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-danger-600 tabular-nums">{data.lowStockItems.length}</div>
            <div className="text-xs text-slate-500">items need attention</div>
          </div>
        </div>

        {data.lowStockItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Package className="w-12 h-12 mb-3 opacity-30" aria-hidden="true" />
            <p className="text-sm font-medium">All inventory levels are optimal</p>
            <p className="text-xs mt-1">No items below minimum stock</p>
          </div>
        ) : (
          <div className="overflow-x-auto scroll-x-hint">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="table-th rounded-tl-xl">Item Code</th>
                  <th className="table-th">Item Name</th>
                  <th className="table-th text-right">Current Stock</th>
                  <th className="table-th text-right rounded-tr-xl">Min Stock</th>
                </tr>
              </thead>
              <tbody>
                {data.lowStockItems.map((it) => (
                  <tr key={it.id} className="hover:bg-danger-50/30 transition-colors">
                    <td className="table-td font-semibold text-slate-800">{it.code}</td>
                    <td className="table-td">{it.name}</td>
                    <td className="table-td text-right font-semibold text-danger-600 tabular-nums">{Number(it.currentStock).toFixed(2)}</td>
                    <td className="table-td text-right text-slate-500 tabular-nums">{Number(it.minStock).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
