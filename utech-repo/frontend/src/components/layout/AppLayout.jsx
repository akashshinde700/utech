import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { hasPermission } from '../../lib/permissions';
import NotificationBell from './NotificationBell';
import OfflineBanner from './OfflineBanner.jsx';
import InstallPrompt from './InstallPrompt.jsx';
import ChangePasswordModal from './ChangePasswordModal';
import QuickActions from './QuickActions';
import useClickOutside from '../../lib/useClickOutside';
import { roleLabel } from '../../lib/roleLabel';
import {
  LayoutDashboard, Users, Package, FileText, ClipboardList,
  Factory, Truck, Shield, ChevronDown, LogOut, UserCircle, Box,
  ShoppingCart, PackageCheck, Briefcase, Wallet, FileSpreadsheet, Cog,
  RotateCcw, ArrowLeftToLine, FileDown, BarChart3, ChevronRight, Home,
  Boxes, SlidersHorizontal, Building2, ListChecks, CheckSquare, Layers, Menu, X, KeyRound,
  Calculator, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';

const SIDEBAR_COLLAPSED_KEY = 'utech.sidebar.collapsed';
const SIDEBAR_SECTIONS_KEY = 'utech.sidebar.sections';

function readStored(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function storeValue(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full / private mode — the sidebar simply won't persist
  }
}

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
      { to: '/quotations?type=CUSTOMER', label: 'Customer Quotations', icon: FileDown, perm: 'customerQuotation.read' },
      { to: '/quotations?type=VENDOR', label: 'Vendor Quotations', icon: FileDown, perm: 'vendorQuotation.read' },
      { to: '/parties?type=CUSTOMER', label: 'Customers', icon: Users, perm: 'customerParty.read' },
      { to: '/parties?type=VENDOR', label: 'Vendors', icon: Users, perm: 'vendorParty.read' },
      { to: '/jobcards', label: 'Jobcards', icon: ClipboardList, perm: 'jobcard.read' },
      { to: '/assignments', label: 'Assignments', icon: ListChecks, perm: 'assignment.read' },
      { to: '/machines', label: 'Machines', icon: Cog, perm: 'machine.read' },
      // read-only weight/price tool, open to every signed-in user (auth-only API)
      { to: '/metal-calculator', label: 'Metal Calculator', icon: Calculator },
    ],
  },
  // Department Head task assignment / progress tracking over the manufacturing
  // workflow (Department -> Process -> Sub-Process -> Task -> Employee ->
  // Progress). Task Progress = the manager dashboard; My Tasks = the
  // employee/assignee self-service view; Process Master configures the
  // (department-scoped) process/sub-process list tasks are created against.
  {
    id: 'task-management',
    label: 'Task Management',
    icon: ListChecks,
    items: [
      { to: '/my-tasks', label: 'My Tasks', icon: ListChecks, perm: 'task.progress' },
      { to: '/tasks', label: 'Task Progress', icon: Layers, perm: 'task.create' },
      { to: '/processes', label: 'Process Master', icon: Cog, perm: 'process.read' },
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
      // gated on item.read because that is what /api/boms actually checks; the
      // seeded bom.* keys exist but no route reads them (see AUD-104)
      { to: '/boms', label: 'BOMs', icon: Package, perm: 'item.read' },
      { to: '/production/batches', label: 'Production Batches', icon: Factory, perm: 'jobcard.read' },
      { to: '/production/shifts', label: 'Shifts', icon: Cog, perm: 'jobcard.read' },
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
      // an operator's Task Progress checklist across every project — kept up
      // here, not inside a collapsed section, because it is their main screen
      { to: '/my-tasks', label: 'My Tasks', icon: CheckSquare, perm: 'task.progress' },
      { to: '/assignments', label: 'My Drawing Assignments', icon: ListChecks },
    ],
  },
  // scopeToDepartment roles (Department Head / Supervisor / Team Leader) land
  // here too (see isRestricted below) — these items are perm-gated exactly
  // like NAV_SECTIONS, so a plain Operator (task.progress only) sees just "My
  // Tasks" while a Department Head (task.progress + task.create +
  // process.read) sees the full Task Management set.
  {
    id: 'task-management',
    label: 'Task Management',
    icon: ListChecks,
    items: [
      { to: '/tasks', label: 'Task Progress', icon: Layers, perm: 'task.create' },
      { to: '/processes', label: 'Process Master', icon: Cog, perm: 'process.read' },
    ],
  },
];

export default function AppLayout() {
  const user = useAuth((s) => s.user);
  const { search: currentSearch } = useLocation();
  // a nav entry with a query (e.g. /parties?type=VENDOR) is active only when
  // the query matches too, so Customers and Vendors don't both light up
  const linkActive = (item, isActive) => {
    if (!isActive) return false;
    const q = item.to.indexOf('?');
    if (q === -1) return true;
    const want = new URLSearchParams(item.to.slice(q));
    const have = new URLSearchParams(currentSearch);
    return [...want.entries()].every(([k, v]) => have.get(k) === v);
  };
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [userOpen, setUserOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
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
  const matchesLocation = (item) => {
    const path = item.to.split('?')[0];
    return (location.pathname === path || (path !== '/' && location.pathname.startsWith(path + '/'))) && linkActive(item, true);
  };
  const pageTitle = navSections.flatMap((s) => s.items)
    .filter(matchesLocation).sort((a, b) => b.to.length - a.to.length)[0]?.label || 'Workspace';
  const quickItems = navSections.flatMap((section) => section.items.map((item) => ({
    label: item.label,
    to: item.to,
    description: `${section.label} · Go to page`,
    keywords: section.label,
  })));
  if (!isRestricted) {
    const createActions = [
      { label: 'New Jobcard', to: '/jobcards/new', description: 'Create a manufacturing jobcard', permission: 'jobcard.create', keywords: 'project manufacturing create' },
      { label: 'New Invoice', to: '/invoices/new', description: 'Create a customer invoice', permission: 'invoice.create', keywords: 'sales billing create' },
      { label: 'New Customer Quotation', to: '/quotations/new?type=CUSTOMER', description: 'Prepare a customer quotation', permission: 'customerQuotation.create', keywords: 'sales estimate quotation create' },
      { label: 'New Vendor Quotation', to: '/quotations/new?type=VENDOR', description: 'Record a vendor quotation', permission: 'vendorQuotation.create', keywords: 'purchase procurement estimate create' },
      { label: 'New Purchase Order', to: '/purchase-orders/new', description: 'Create a purchase order', permission: 'purchase.create', keywords: 'procurement vendor create' },
      { label: 'New Customer', to: '/parties/new?type=CUSTOMER', description: 'Add a customer record', permission: 'customerParty.create', keywords: 'party customer create' },
      { label: 'New Vendor', to: '/parties/new?type=VENDOR', description: 'Add a vendor record', permission: 'vendorParty.create', keywords: 'party vendor supplier create' },
      { label: 'New Item', to: '/items/new', description: 'Add an inventory item', permission: 'item.create', keywords: 'stock material create' },
      { label: 'New GRN', to: '/grns/new', description: 'Receive purchased stock into inventory', permission: 'grn.create', keywords: 'goods receipt stock purchase create' },
      { label: 'New Dispatch', to: '/dispatch/new', description: 'Create a customer dispatch', permission: 'dispatch.create', keywords: 'delivery shipment sales create' },
      { label: 'New Jobwork', to: '/jobwork/new', description: 'Send material to a vendor for jobwork', permission: 'jobwork.create', keywords: 'outsourcing vendor material create' },
    ];
    quickItems.push(...createActions.filter((action) => can(action.permission)));
  }
  useEffect(() => {
    const onAppKeyDown = (event) => {
      const isCommandK = (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'k';
      if (isCommandK) {
        event.preventDefault();
        setQuickActionsOpen((current) => !current);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const typing = target instanceof HTMLElement && (
        target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
      );
      if (!typing && (event.key === '/' || event.key === '?')) {
        event.preventDefault();
        setQuickActionsOpen(true);
      }
    };
    document.addEventListener('keydown', onAppKeyDown, true);
    return () => document.removeEventListener('keydown', onAppKeyDown, true);
  }, []);
  // Desktop sidebar collapse (icon rail) — persisted so the choice survives
  // navigation and reloads. Mobile always gets the full labelled drawer.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readStored(SIDEBAR_COLLAPSED_KEY) === true);
  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      storeValue(SIDEBAR_COLLAPSED_KEY, !current);
      return !current;
    });
  };

  const [expandedSections, setExpandedSections] = useState(() => ({
    dashboard: true,
    'my-projects': true,
    masters: false,
    'task-management': false,
    sales: false,
    'company-inventory': false,
    'customer-inventory': false,
    'stock-management': false,
    analytics: false,
    admin: false,
    ...(readStored(SIDEBAR_SECTIONS_KEY) || {}),
  }));

  const toggleSection = (sectionId) => {
    setExpandedSections((prev) => {
      const next = { ...prev, [sectionId]: !prev[sectionId] };
      storeValue(SIDEBAR_SECTIONS_KEY, next);
      return next;
    });
  };

  // Deep links open the relevant section, while route changes close the mobile drawer.
  useEffect(() => {
    setMobileNavOpen(false);
    const activeSection = navSections.find((section) => section.items.some(matchesLocation));
    if (activeSection) {
      setExpandedSections((prev) => {
        if (prev[activeSection.id]) return prev;
        const next = { ...prev, [activeSection.id]: true };
        storeValue(SIDEBAR_SECTIONS_KEY, next);
        return next;
      });
    }
  }, [location.pathname, location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') setMobileNavOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    // modal drawer: the page behind it must not scroll (or chain-scroll on
    // touch) while the drawer is open; restored exactly on close/unmount.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  return (
    <div className="min-h-dvh w-full max-w-full flex bg-[#f6f5fa]">
      {mobileNavOpen && (
        <div className="no-print fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setMobileNavOpen(false)} />
      )}

      {/* sidebar — fixed slide-in drawer below lg, static column at lg+.
          Desktop collapse swaps the 248px labelled column for a 64px icon
          rail (labels become tooltips); the mobile drawer always shows
          labels, so `sidebarCollapsed` only applies at lg+. The rail is
          sticky at exactly one viewport height and the page — not the
          shell — scrolls, so no dead space is reserved below content. */}
      <aside
        data-collapsed={sidebarCollapsed ? 'true' : 'false'}
        className={`no-print fixed inset-y-0 left-0 z-50 w-[248px] max-w-[85vw] bg-[#1d1437] text-white flex flex-col border-r border-white/5 transform transition-[transform,width] duration-200 lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 lg:z-auto ${sidebarCollapsed ? 'lg:w-16' : 'lg:w-[248px]'} ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className={`border-b border-white/10 px-4 py-4 ${sidebarCollapsed ? 'lg:px-2' : ''}`}>
          <div className={`flex items-center justify-between gap-2 ${sidebarCollapsed ? 'lg:flex-col lg:justify-center' : ''}`}>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 shrink-0 rounded-[10px] bg-brand-600 flex items-center justify-center">
                <Box className="w-5 h-5 text-white" aria-hidden="true" />
              </div>
              <div className={`min-w-0 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                <div className="text-[15px] font-bold tracking-tight text-white truncate">
                  U-Tech <span className="text-brand-300">ERP</span>
                </div>
                <div className="text-[8px] text-slate-400 font-semibold tracking-[0.08em] uppercase">
                  Manufacturing workspace
                </div>
              </div>
            </div>
            <button type="button" className="lg:hidden shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-white/80 hover:bg-white/10" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}>
              <X className="w-5 h-5" />
            </button>
            <button
              type="button"
              className="hidden lg:flex shrink-0 w-8 h-8 rounded-lg items-center justify-center text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60"
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!sidebarCollapsed}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={toggleSidebar}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" aria-hidden="true" /> : <PanelLeftClose className="w-4 h-4" aria-hidden="true" />}
            </button>
          </div>
        </div>

        {/* icon rail — desktop only, shown when collapsed. Every entry is a
            direct link (no submenu step) with a native tooltip + aria-label,
            so collapsing never hides a destination behind a second click. */}
        {sidebarCollapsed && (
          <nav aria-label="Main navigation (collapsed)" className="hidden lg:flex flex-1 flex-col items-center gap-0.5 overflow-y-auto py-3">
            {navSections.map((section) => (
              <div key={section.id} className="flex flex-col items-center gap-0.5">
                <span className="sr-only">{section.label}</span>
                {section.items.map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      title={item.label}
                      aria-label={item.label}
                      className={({ isActive }) =>
                        'grid h-9 w-9 place-items-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60 ' +
                        (linkActive(item, isActive)
                          ? 'bg-brand-600 text-white shadow-sm shadow-brand-950/30'
                          : 'text-slate-300 hover:bg-white/10 hover:text-white')
                      }
                    >
                      <ItemIcon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    </NavLink>
                  );
                })}
                <span className="my-1.5 h-px w-6 bg-white/10" aria-hidden="true" />
              </div>
            ))}
          </nav>
        )}

        <nav aria-label="Main navigation" className={`flex-1 py-3 overflow-y-auto scrollbar-thin scrollbar-thumb-brand-500/70 scrollbar-track-transparent ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
          {navSections.map((section) => {
            const SectionIcon = section.icon;
            const isExpanded = expandedSections[section.id];

            return (
              <div key={section.id} className="mb-1 px-2.5">
                <button
                  type="button"
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={!!isExpanded}
                  aria-controls={`nav-${section.id}`}
                  className="group w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[11px] font-bold uppercase tracking-[0.09em] text-slate-300 transition-colors duration-200 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50"
                >
                  <span className="flex items-center gap-2.5">
                    <SectionIcon className="h-4 w-4 text-slate-400 group-hover:text-white transition-colors" aria-hidden="true" />
                    <span className="text-white/80 group-hover:text-white">{section.label}</span>
                  </span>
                  <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} aria-hidden="true" />
                </button>

                {isExpanded && (
                  <div id={`nav-${section.id}`} className="mt-1 space-y-0.5 animate-slide-down">
                    {section.items.map((item) => {
                      const ItemIcon = item.icon;
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.to === '/'}
                          className={({ isActive }) =>
                            'relative flex min-h-11 items-center gap-2.5 rounded-lg py-1.5 pl-3 pr-2.5 ml-4 text-[13px] font-medium transition-all duration-200 lg:min-h-0 ' +
                            (linkActive(item, isActive)
                              ? 'bg-brand-600 text-white shadow-sm shadow-brand-950/30'
                              : 'text-slate-300 hover:bg-white/5 hover:text-white')
                          }
                        >
                          {({ isActive }) => (
                            <>
                              {/* active left accent bar */}
                              <span
                                className={`absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full transition-opacity ${linkActive(item, isActive) ? 'bg-brand-300 opacity-100' : 'opacity-0'}`}
                                aria-hidden="true"
                              />
                              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/5 text-slate-300 transition-colors duration-200">
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

        <div className={`px-4 py-3 text-[9px] text-slate-400 border-t border-white/10 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
          <span className="font-medium tracking-wide">U-TECH AUTOMATION INDUSTRIES</span>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* topbar */}
        <header className="no-print relative z-30 min-h-14 bg-white border-b border-slate-200 px-3 sm:px-5 flex items-center justify-between pt-[env(safe-area-inset-top)]">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <button type="button" className="lg:hidden shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-slate-700 hover:bg-slate-100" aria-label="Open navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}>
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm font-bold text-slate-800 truncate">{pageTitle}</div>
            <div className="h-5 w-px bg-slate-200 hidden sm:block"></div>
            <div className="text-xs text-slate-500 font-medium hidden sm:block truncate">Manufacturing workspace</div>
          </div>
          <div className="flex items-center gap-1 sm:gap-3 shrink-0">
            <QuickActions items={quickItems} open={quickActionsOpen} onOpenChange={setQuickActionsOpen} />
            <InstallPrompt />
            <NotificationBell />
            <div className="relative" ref={userMenuRef}>
              <button
                className="flex items-center gap-3 px-2 py-1.5 rounded-xl hover:bg-slate-50 transition-colors"
                aria-label="Account menu" aria-expanded={userOpen}
                onClick={() => setUserOpen((v) => !v)}
              >
                <div className="w-9 h-9 rounded-full bg-brand-100 text-brand-800 flex items-center justify-center text-sm font-bold">
                  {(user?.name || 'U').charAt(0).toUpperCase()}
                </div>
                <div className="text-left hidden sm:block">
                  <div className="text-sm font-semibold text-slate-800 leading-tight">{user?.name}</div>
                  <div className="text-[11px] text-brand-600 leading-tight font-medium">{roleLabel(user?.role, user?.departmentName)}
                    {user?.role !== 'OPERATOR' && user?.departmentName && <span className="text-slate-500 font-normal"> · {user.departmentName}</span>}
                  </div>
                </div>
                <ChevronDown className={`w-4 h-4 text-brand-600 transition-transform ${userOpen ? 'rotate-180' : ''}`} />
              </button>
              {userOpen && (
                <div className="absolute right-0 mt-3 w-56 rounded-xl border border-slate-200 bg-white shadow-lg p-2 animate-fade-in z-50">
                  <div className="px-3 py-2.5 border-b border-slate-100 mb-1">
                    <div className="text-sm font-semibold text-slate-800 truncate">{user?.name}</div>
                    <div className="text-xs text-brand-600 truncate">{user?.email || ''}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {roleLabel(user?.role, user?.departmentName)}
                      {user?.departmentName && <div>Department: <span className="font-medium text-slate-700">{user.departmentName}</span></div>}
                    </div>
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

        <OfflineBanner />

        {changePasswordOpen && <ChangePasswordModal onClose={() => setChangePasswordOpen(false)} />}

        <main className="flex-1 min-w-0 p-3 sm:p-5 xl:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-[1600px]"><Outlet /></div>
        </main>
      </div>
    </div>
  );
}
