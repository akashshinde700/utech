import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, ClipboardCheck, Factory, AlertTriangle,
  UsersRound, Package, IndianRupee, BarChart3,
  PieChart, FileText, FilePlus2, Building2, CalendarDays, ArrowRight
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar,
  PieChart as RechartsPieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import api from '../lib/api';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import { inr, quantity } from '../lib/format';
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
  { to: '/quotations/new?type=CUSTOMER', label: 'New Quotation', icon: FilePlus2, perm: 'customerQuotation.create' },
  { to: '/parties/new?type=CUSTOMER', label: 'Add Customer', icon: Building2, perm: 'customerParty.create' },
  { to: '/parties/new?type=VENDOR', label: 'Add Vendor', icon: Building2, perm: 'vendorParty.create' },
];

// StatCard — same KPI language as the analytics pages' MetricCard: label over
// a big tabular-nums value on the left, soft-colored icon chip on the right,
// subtle hover lift. Currency values render via inr(); counts via en-IN.
function StatCard({ meta, value, hint }) {
  const Icon = meta.icon;
  const isCurrency = meta.key === 'salesLast30Days';
  return (
    <div className="card-flat p-4 sm:p-5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">{meta.label}</span>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${meta.color}`} aria-hidden="true"><Icon className="w-4 h-4" /></span>
      </div>
      <div className="mt-4 text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight tabular-nums break-words">
        {isCurrency ? inr(value) : Number(value ?? 0).toLocaleString('en-IN')}
      </div>
      <div className="mt-1 text-xs text-slate-500 min-h-[1rem]">{hint || '\u00a0'}</div>
    </div>
  );
}

// ChartCard — container styled after the shared FormSection header: icon in a
// soft brand circle, small semibold title, muted description line.
function ChartCard({ title, description, children, icon: Icon }) {
  return (
    <div className="card-flat p-5 sm:p-6">
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
const PIE_COLORS = ['#7c3aed', '#a78bfa', '#d9a441', '#637a94', '#a9bec7'];

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
          fillOpacity={0.16}
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
        <Bar dataKey="planned" fill="#d9a441" radius={[4, 4, 0, 0]} />
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
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setError(false);
    api.get('/dashboard/summary').then((r) => setData(r.data)).catch(() => setError(true));
  }, [attempt]);

  const quickActions = QUICK_ACTIONS.filter((a) => hasPermission(user, a.perm));

  if (error) {
    return <div><PageHeader title="Smart Dashboard" subtitle="Manufacturing overview" /><div role="alert" className="card-flat p-6 text-sm text-slate-700">Could not load the dashboard. <button type="button" className="ml-2 font-bold text-brand-700 underline" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div></div>;
  }
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

  const today = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
  const lowStockItems = data.lowStockItems || [];

  return (
    <div className="animate-fade-in space-y-7">
      <PageHeader title="Smart Dashboard" subtitle="Your manufacturing workspace, at a glance"
        action={<div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><CalendarDays className="h-4 w-4" aria-hidden="true" />{today}</div>} />

      <section className="relative overflow-hidden rounded-2xl bg-[#153443] px-6 py-6 sm:px-8 sm:py-7 text-white">
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.13em] text-[#8bd8c9]"><span className="h-2 w-2 rounded-full bg-[#5fd3b6]" /> Operations overview</div>
            <h2 className="mt-3 text-xl sm:text-2xl font-bold tracking-tight">Welcome back, {user?.name?.split(' ')[0] || 'there'}.</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">Keep an eye on sales, production and inventory — all in one place.</p>
          </div>
          {hasPermission(user, 'stock.read') && <Link to="/stock" className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-white/10 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-white/20">View stock overview <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-24 h-64 w-64 rounded-full border-[36px] border-white/[0.035]" />
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-base font-bold text-slate-900">At a glance</h2><p className="mt-1 text-xs text-slate-500">A snapshot of your business today</p></div></div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {STAT_META.map((meta) => <StatCard key={meta.key} meta={meta} value={data[meta.key]} hint={meta.hintKey ? meta.hintFmt(data[meta.hintKey]) : meta.hint} />)}
        </div>
      </section>

      {quickActions.length > 0 && <section className="flex flex-wrap items-center gap-2">
        <span className="mr-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Quick actions</span>
        {quickActions.map((a, index) => <Link key={a.to} to={a.to} className={index === 0 ? 'btn-primary' : 'btn-secondary'}><a.icon className="w-4 h-4" aria-hidden="true" /> {a.label}</Link>)}
      </section>}

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
      <div className="card-flat p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-danger-50 text-danger-600 flex items-center justify-center" aria-hidden="true">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-slate-800 text-lg">Inventory Alerts</div>
            <div className="text-sm text-slate-500">Items below minimum stock levels</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-danger-600 tabular-nums">{lowStockItems.length}</div>
            <div className="text-xs text-slate-500">items need attention</div>
          </div>
        </div>

        {lowStockItems.length === 0 ? (
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
                {lowStockItems.map((it) => (
                  <tr key={it.id} className="hover:bg-danger-50/30 transition-colors">
                    <td className="table-td font-semibold text-slate-800">{it.code}</td>
                    <td className="table-td">{it.name}</td>
                    <td className="table-td text-right font-semibold text-danger-600 tabular-nums">{quantity(it.currentStock)}</td>
                    <td className="table-td text-right text-slate-500 tabular-nums">{quantity(it.minStock)}</td>
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
