import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { hasPermission } from '../../lib/permissions';
import NotificationBell from './NotificationBell';
import ChangePasswordModal from './ChangePasswordModal';
import useClickOutside from '../../lib/useClickOutside';
import {
  LayoutDashboard, Users, Package, FileText, ClipboardList,
  Factory, Truck, Shield, ChevronDown, LogOut, UserCircle, Box,
  ShoppingCart, PackageCheck, Briefcase, Wallet, FileSpreadsheet, Cog,
  RotateCcw, ArrowLeftToLine, FileDown, BarChart3, ChevronRight, Home,
  Boxes, SlidersHorizontal, Building2, ListChecks, Layers, Menu, X, KeyRound,
} from 'lucide-react';

// perm = the permission key the backend actually requires for that page's GET
// route (verified against src/routes/*.js + prisma/seed.js). Links without a
// perm have no server-side permission gate (just requireAuth) so they stay
// visible to every signed-in user. A section shows only if any child does.
const NAV_SECTIONS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: Home,
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard },
    ],
  },
  {
    id: 'masters',
    label: 'Masters',
    icon: Box,
    items: [
      { to: '/quotations', label: 'Quotations', icon: FileDown, perm: 'quotation.read' },
      { to: '/parties', label: 'Parties', icon: Users, perm: 'party.read' },
      { to: '/jobcards', label: 'Jobcards', icon: ClipboardList, perm: 'jobcard.read' },
      { to: '/assignments', label: 'Assignments', icon: ListChecks, perm: 'assignment.read' },
      { to: '/machines', label: 'Machines', icon: Cog, perm: 'machine.read' },
      { to: '/processes', label: 'Processes', icon: Cog, perm: 'process.read' },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    icon: FileText,
    items: [
      { to: '/invoices', label: 'Invoices', icon: FileText, perm: 'invoice.read' },
      { to: '/sales-returns', label: 'Returns', icon: RotateCcw, perm: 'invoice.read' },
      { to: '/dispatch', label: 'Dispatch', icon: Truck, perm: 'dispatch.read' },
    ],
  },
  // company's own stock only — raw material, consumables, purchased/finished
  // goods. Never shows customer-owned material (see Customer Inventory below).
  {
    id: 'company-inventory',
    label: 'Company Inventory',
    icon: Boxes,
    items: [
      { to: '/items', label: 'Items', icon: Package, perm: 'item.read' },
      { to: '/boms', label: 'BOMs', icon: Package, perm: 'bom.read' },
      { to: '/purchase-orders', label: 'Purchase Orders', icon: ShoppingCart, perm: 'purchase.read' },
      { to: '/grns', label: 'GRN (Stock In)', icon: PackageCheck, perm: 'grn.read' },
      { to: '/purchase-returns', label: 'Purchase Returns', icon: ArrowLeftToLine, perm: 'purchase.read' },
      { to: '/back-orders', label: 'Back Orders', icon: ClipboardList, perm: 'invoice.read' },
    ],
  },
  // customer-owned material only — tracked completely separately from
  // Company Inventory (own model, own ledger, never touches Item.currentStock)
  {
    id: 'customer-inventory',
    label: 'Customer Inventory',
    icon: Users,
    items: [
      { to: '/customer-material', label: 'Customer Material', icon: Users, perm: 'customerMaterial.read' },
      { to: '/jobwork', label: 'Vendor Dispatch (Jobwork)', icon: Factory, perm: 'jobwork.read' },
      { to: '/vendor-work-orders', label: 'Vendor Work Orders', icon: Boxes, perm: 'vendorWorkOrder.read' },
    ],
  },
  // monitoring/reporting layer across both inventories above — never a third
  // stock pool of its own
  {
    id: 'stock-management',
    label: 'Stock Management',
    icon: SlidersHorizontal,
    items: [
      { to: '/stock', label: 'Stock Overview & Ledger', icon: SlidersHorizontal, perm: 'stock.read' },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: BarChart3,
    items: [
      { to: '/reports', label: 'Reports', icon: FileSpreadsheet, perm: 'report.read' },
      { to: '/analytics/sales', label: 'Sales Analytics', icon: BarChart3 },
      { to: '/analytics/production', label: 'Production Analytics', icon: BarChart3 },
      { to: '/analytics/inventory', label: 'Inventory Analytics', icon: BarChart3 },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: Shield,
    items: [
      { to: '/users', label: 'Users', icon: UserCircle, perm: 'user.read' },
      { to: '/roles', label: 'Roles', icon: Shield, perm: 'role.read' },
      { to: '/departments', label: 'Departments', icon: Building2, perm: 'department.read' },
      { to: '/department-subcategories', label: 'Department Roles', icon: Layers, perm: 'departmentSubcategory.read' },
      { to: '/projects', label: 'Projects', icon: Briefcase, perm: 'project.read' },
      { to: '/expenses', label: 'Expenses', icon: Wallet, perm: 'expense.read' },
    ],
  },
];

// operators and project engineers only ever see their own assigned projects — no other nav makes sense for them
const RESTRICTED_NAV_SECTIONS = [
  {
    id: 'my-projects',
    label: 'My Projects',
    icon: ClipboardList,
    items: [
      { to: '/', label: 'My Projects', icon: ClipboardList },
      { to: '/assignments', label: 'My Assignments', icon: ListChecks },
    ],
  },
];

export default function AppLayout() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [userOpen, setUserOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  // topbar user dropdown: closes on outside click AND Escape (shared hook)
  const userMenuRef = useRef(null);
  useClickOutside(userMenuRef, () => setUserOpen(false), { active: userOpen });
  const isRestricted = user?.role === 'OPERATOR' || user?.role === 'Project Engineer' || !!user?.scopeToDepartment;
  const can = (key) => hasPermission(user, key);
  // hide links the role has no grant for; a section survives only while at
  // least one of its children is still visible
  const navSections = (isRestricted ? RESTRICTED_NAV_SECTIONS : NAV_SECTIONS)
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.perm || can(item.perm)),
    }))
    .filter((section) => section.items.length > 0);

  // topbar title follows the active module — longest matching nav link wins
  const pageTitle = navSections
    .flatMap((s) => s.items)
    .filter((item) => location.pathname === item.to || location.pathname.startsWith(item.to + '/'))
    .sort((a, b) => b.to.length - a.to.length)[0]?.label || 'Dashboard';
  const [expandedSections, setExpandedSections] = useState({
    dashboard: true,
    'my-projects': true,
    masters: false,
    sales: false,
    purchase: false,
    analytics: false,
    admin: false,
  });

  const toggleSection = (sectionId) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionId]: !prev[sectionId]
    }));
  };

  // close the mobile drawer automatically whenever the route changes
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden flex bg-gradient-to-br from-slate-50 to-brand-50">
      {mobileNavOpen && (
        <div className="no-print fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setMobileNavOpen(false)} />
      )}

      {/* sidebar — fixed slide-in drawer below lg, static column at lg+ */}
      <aside className={`no-print fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-gradient-to-b from-brand-900 via-brand-900 to-cyan-950 text-white flex flex-col shadow-2xl border-r border-brand-800/20 backdrop-blur-xl transform transition-transform duration-300 lg:static lg:translate-x-0 lg:z-auto ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-6 py-6 border-b border-white/10">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-14 h-14 shrink-0 rounded-[1.25rem] bg-gradient-to-br from-brand-500 to-cyan-500 flex items-center justify-center shadow-2xl shadow-brand-500/25 transition-all duration-300 hover:scale-105">
                <Box className="w-6 h-6 text-white" />
              </div>
              <div className="min-w-0">
                <div className="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-brand-200 bg-clip-text text-transparent truncate">
                  UTech ERP
                </div>
                <div className="text-[10px] text-brand-200 font-medium tracking-wide uppercase truncate">
                  Smart Manufacturing
                </div>
              </div>
            </div>
            <button type="button" className="lg:hidden shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-white/80 hover:bg-white/10" onClick={() => setMobileNavOpen(false)}>
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <nav className="flex-1 py-4 overflow-y-auto scrollbar-thin scrollbar-thumb-brand-500/70 scrollbar-track-transparent">
          {navSections.map((section) => {
            const SectionIcon = section.icon;
            const isExpanded = expandedSections[section.id];

            return (
              <div key={section.id} className="mb-1.5 px-3">
                <button
                  type="button"
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={isExpanded}
                  className="group w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-brand-200/80 transition-all duration-200 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50"
                >
                  <span className="flex items-center gap-2.5">
                    <SectionIcon className="h-4 w-4 text-brand-300 group-hover:text-white transition-colors" aria-hidden="true" />
                    <span className="text-white/80 group-hover:text-white">{section.label}</span>
                  </span>
                  <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} aria-hidden="true" />
                </button>

                {isExpanded && (
                  <div className="mt-1 space-y-0.5 animate-slide-down">
                    {section.items.map((item) => {
                      const ItemIcon = item.icon;
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.to === '/'}
                          className={({ isActive }) =>
                            'relative flex items-center gap-3 rounded-lg py-2 pl-4 pr-3 ml-4 text-sm font-medium transition-all duration-200 ' +
                            (isActive
                              ? 'bg-brand-600/30 text-white shadow-sm ring-1 ring-brand-400/30'
                              : 'text-brand-100 hover:bg-white/10 hover:text-white')
                          }
                        >
                          {({ isActive }) => (
                            <>
                              {/* active left accent bar */}
                              <span
                                className={`absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full transition-opacity ${isActive ? 'bg-brand-300 opacity-100' : 'opacity-0'}`}
                                aria-hidden="true"
                              />
                              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/5 text-brand-200 transition-colors duration-200">
                                <ItemIcon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                              </span>
                              <span className="truncate">{item.label}</span>
                            </>
                          )}
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="px-6 py-4 text-[10px] text-brand-200 border-t border-white/10">
          <span className="font-medium">v2.0.0</span>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* topbar */}
        <header className="no-print relative z-30 h-16 bg-white/90 backdrop-blur-xl border-b border-brand-100/50 px-3 sm:px-6 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <button type="button" className="lg:hidden shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-brand-700 hover:bg-brand-50" onClick={() => setMobileNavOpen(true)}>
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-base sm:text-lg font-bold text-brand-800 truncate">{pageTitle}</div>
            <div className="h-6 w-px bg-brand-200 hidden sm:block"></div>
            <div className="text-sm text-slate-600 font-medium hidden sm:block truncate">U-Tech Smart Manufacturing</div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <NotificationBell />
            <div className="relative" ref={userMenuRef}>
              <button
                className="flex items-center gap-3 px-3 py-2 rounded-2xl hover:bg-brand-50 transition-all duration-200 border border-brand-100/50 shadow-sm hover:shadow-md"
                onClick={() => setUserOpen((v) => !v)}
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-500 to-cyan-500 text-white flex items-center justify-center text-sm font-bold shadow-lg transition-transform duration-300 hover:scale-105">
                  {(user?.name || 'U').charAt(0).toUpperCase()}
                </div>
                <div className="text-left hidden sm:block">
                  <div className="text-sm font-semibold text-slate-800 leading-tight">{user?.name}</div>
                  <div className="text-[11px] text-brand-600 leading-tight font-medium">{user?.role || '—'}</div>
                </div>
                <ChevronDown className={`w-4 h-4 text-brand-600 transition-transform ${userOpen ? 'rotate-180' : ''}`} />
              </button>
              {userOpen && (
                <div className="absolute right-0 mt-3 w-56 rounded-xl border border-slate-200 bg-white shadow-lg p-2 animate-fade-in z-50">
                  <div className="px-3 py-2.5 border-b border-slate-100 mb-1">
                    <div className="text-sm font-semibold text-slate-800 truncate">{user?.name}</div>
                    <div className="text-xs text-brand-600 truncate">{user?.email || ''}</div>
                  </div>
                  <button
                    className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                    onClick={() => { setUserOpen(false); setChangePasswordOpen(true); }}
                  >
                    <KeyRound className="w-4 h-4 text-slate-400" /> Change Password
                  </button>
                  <button
                    className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-red-600 transition-colors hover:bg-red-50"
                    onClick={() => { logout(); navigate('/login'); }}
                  >
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {changePasswordOpen && <ChangePasswordModal onClose={() => setChangePasswordOpen(false)} />}

        <main className="flex-1 p-3 sm:p-6 overflow-auto overflow-x-hidden bg-gradient-to-br from-slate-50/50 to-emerald-50/30">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
