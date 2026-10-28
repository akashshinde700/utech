import { lazy, useEffect } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import Login from './pages/auth/Login.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import { useAuth } from './store/auth';

// A route's code now arrives over the network when the route is opened, which
// introduces two failure modes a single bundle did not have: the phone is
// offline, or a deploy has replaced the file an already-open tab is still
// asking for. Either way the import rejects, and React hands that to the error
// boundary as "Something went wrong" — useless to someone standing on the shop
// floor. Retry once (a deploy race usually succeeds on the second try), then
// say what happened.
function PageUnavailable() {
  return (
    <div className="card p-8 max-w-md mx-auto my-10 text-center">
      <div className="text-lg font-semibold text-slate-900">This page could not be loaded</div>
      <p className="mt-2 text-sm text-slate-500">
        The app could not download this screen. You are most likely offline, or the app was
        updated while this tab was open. Reconnect and reload to continue.
      </p>
      <button type="button" className="btn-primary mt-6 w-full" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}

function lazyPage(load) {
  return lazy(() => load().catch(() => load()).catch(() => ({ default: PageUnavailable })));
}

// Route code is fetched when a route is opened, not on first load. Before
// this, App.jsx imported all 63 of them statically, so index.html
// carried a modulepreload for every one of them (36 JS files, 1.8 MB) --
// including the 526 kB charting library -- before the login form could
// render. On the phones this is used on that is the whole of a slow
// connection spent on screens the user may never open. AppLayout holds the
// <Suspense> boundary, so the shell stays put while a page arrives.
const Dashboard = lazyPage(() => import('./pages/Dashboard.jsx'));
const OperatorDashboard = lazyPage(() => import('./pages/operator/OperatorDashboard.jsx'));
const UsersPage = lazyPage(() => import('./pages/users/UsersPage.jsx'));
const RolesPage = lazyPage(() => import('./pages/roles/RolesPage.jsx'));
const PartiesPage = lazyPage(() => import('./pages/parties/PartiesPage.jsx'));
const PartyForm = lazyPage(() => import('./pages/parties/PartyForm.jsx'));
const ItemsPage = lazyPage(() => import('./pages/items/ItemsPage.jsx'));
const ItemForm = lazyPage(() => import('./pages/items/ItemForm.jsx'));
const InvoicesPage = lazyPage(() => import('./pages/invoices/InvoicesPage.jsx'));
const InvoiceForm = lazyPage(() => import('./pages/invoices/InvoiceForm.jsx'));
const InvoiceView = lazyPage(() => import('./pages/invoices/InvoiceView.jsx'));
const JobcardsPage = lazyPage(() => import('./pages/jobcards/JobcardsPage.jsx'));
const JobcardForm = lazyPage(() => import('./pages/jobcards/JobcardForm.jsx'));
const JobcardView = lazyPage(() => import('./pages/jobcards/JobcardView.jsx'));
const TasksPage = lazyPage(() => import('./pages/tasks/TasksPage.jsx'));
const MyTasksPage = lazyPage(() => import('./pages/tasks/MyTasksPage.jsx'));
const JobworkPage = lazyPage(() => import('./pages/jobwork/JobworkPage.jsx'));
const JobworkForm = lazyPage(() => import('./pages/jobwork/JobworkForm.jsx'));
const DispatchPage = lazyPage(() => import('./pages/dispatch/DispatchPage.jsx'));
const DispatchForm = lazyPage(() => import('./pages/dispatch/DispatchForm.jsx'));
const ProcessPage = lazyPage(() => import('./pages/process/ProcessPage.jsx'));
const ExpensesPage = lazyPage(() => import('./pages/expense/ExpensesPage.jsx'));
const PurchaseOrdersPage = lazyPage(() => import('./pages/purchase/PurchaseOrdersPage.jsx'));
const PurchaseOrderForm = lazyPage(() => import('./pages/purchase/PurchaseOrderForm.jsx'));
const PurchaseOrderView = lazyPage(() => import('./pages/purchase/PurchaseOrderView.jsx'));
const GRNsPage = lazyPage(() => import('./pages/purchase/GRNsPage.jsx'));
const GRNForm = lazyPage(() => import('./pages/purchase/GRNForm.jsx'));
const GRNView = lazyPage(() => import('./pages/purchase/GRNView.jsx'));
const QualityPage = lazyPage(() => import('./pages/quality/QualityPage.jsx'));
const ProjectsPage = lazyPage(() => import('./pages/project/ProjectsPage.jsx'));
const ProjectView = lazyPage(() => import('./pages/project/ProjectView.jsx'));
const ReportsPage = lazyPage(() => import('./pages/reports/ReportsPage.jsx'));
const SalesAnalytics = lazyPage(() => import('./pages/analytics/SalesAnalytics.jsx'));
const ProductionAnalytics = lazyPage(() => import('./pages/analytics/ProductionAnalytics.jsx'));
const InventoryAnalytics = lazyPage(() => import('./pages/analytics/InventoryAnalytics.jsx'));
const SalesReturnsPage = lazyPage(() => import('./pages/salesReturns/SalesReturnsPage.jsx'));
const SalesReturnForm = lazyPage(() => import('./pages/salesReturns/SalesReturnForm.jsx'));
const PurchaseReturnsPage = lazyPage(() => import('./pages/purchaseReturns/PurchaseReturnsPage.jsx'));
const PurchaseReturnForm = lazyPage(() => import('./pages/purchaseReturns/PurchaseReturnForm.jsx'));
const BackOrdersPage = lazyPage(() => import('./pages/backOrders/BackOrdersPage.jsx'));
const BackOrderForm = lazyPage(() => import('./pages/backOrders/BackOrderForm.jsx'));
const ProductionPage = lazyPage(() => import('./pages/production/ProductionPage.jsx'));
const ProductionForm = lazyPage(() => import('./pages/production/ProductionForm.jsx'));
const ShiftsPage = lazyPage(() => import('./pages/production/ShiftsPage.jsx'));
const BomPage = lazyPage(() => import('./pages/bom/BomPage.jsx'));
const BomForm = lazyPage(() => import('./pages/bom/BomForm.jsx'));
const MachinesPage = lazyPage(() => import('./pages/machines/MachinesPage.jsx'));
const MachineForm = lazyPage(() => import('./pages/machines/MachineForm.jsx'));
const QuotationsPage = lazyPage(() => import('./pages/quotations/QuotationsPage.jsx'));
const QuotationForm = lazyPage(() => import('./pages/quotations/QuotationForm.jsx'));
const QuotationView = lazyPage(() => import('./pages/quotations/QuotationView.jsx'));
const CustomerMaterialPage = lazyPage(() => import('./pages/customerMaterial/CustomerMaterialPage.jsx'));
const CustomerMaterialForm = lazyPage(() => import('./pages/customerMaterial/CustomerMaterialForm.jsx'));
const CustomerMaterialView = lazyPage(() => import('./pages/customerMaterial/CustomerMaterialView.jsx'));
const VendorWorkOrdersPage = lazyPage(() => import('./pages/vendorWorkOrders/VendorWorkOrdersPage.jsx'));
const VendorWorkOrderForm = lazyPage(() => import('./pages/vendorWorkOrders/VendorWorkOrderForm.jsx'));
const VendorWorkOrderView = lazyPage(() => import('./pages/vendorWorkOrders/VendorWorkOrderView.jsx'));
const StockManagementPage = lazyPage(() => import('./pages/stock/StockManagementPage.jsx'));
const DepartmentsPage = lazyPage(() => import('./pages/departments/DepartmentsPage.jsx'));
const AssignmentsPage = lazyPage(() => import('./pages/assignments/AssignmentsPage.jsx'));
const DepartmentSubCategoryPage = lazyPage(() => import('./pages/departments/DepartmentSubCategoryPage.jsx'));
const MetalCalculatorPage = lazyPage(() => import('./pages/calculator/MetalCalculatorPage.jsx'));
const QualityCertificate = lazyPage(() => import('./pages/quality/QualityCertificate.jsx'));


// operators, project engineers, and department-scoped roles (Department
// Head and anyone under them — any role with scopeToDepartment set) only
// ever get their dashboard + their own project's detail page; every other
// URL bounces back to "/" (server-side ownership checks back this up on
// every API call, this is just so the nav/UX doesn't dangle broken links)
function isRestrictedUser(user) {
  return user?.role === 'OPERATOR' || user?.role === 'Project Engineer' || !!user?.scopeToDepartment;
}
// Must stay in step with RESTRICTED_NAV_SECTIONS in AppLayout: every link
// the restricted sidebar renders has to be openable, otherwise the menu item
// looks dead - the user clicks it and silently lands back on the dashboard.
// Each nav entry is additionally permission-gated and the API re-checks the
// same permission, so widening this list grants no data access on its own.
const RESTRICTED_ALLOWED_PATHS = [
  /^\/$/,               // dashboard / My Projects
  /^\/jobcards\/\d+$/,  // own project detail
  /^\/assignments$/,    // My Drawing Assignments
  /^\/my-tasks$/,       // My Tasks (task.progress)
  /^\/tasks$/,          // Task Progress (task.create)
  /^\/processes$/,      // Process Master (process.read)
];

function Protected({ children }) {
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);
  const refreshMe = useAuth((s) => s.refreshMe);
  const location = useLocation();

  // the cached profile in localStorage can go stale — a session opened
  // before a role/permission change (or before a new profile field was
  // even added, e.g. hierarchyLevel) would otherwise never pick it up
  // until the user manually signs out and back in. Refresh it once per
  // app load instead.
  useEffect(() => {
    if (token) refreshMe().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token) return <Navigate to="/login" replace />;
  if (isRestrictedUser(user) && !RESTRICTED_ALLOWED_PATHS.some((re) => re.test(location.pathname))) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function HomeRoute() {
  const user = useAuth((s) => s.user);
  return isRestrictedUser(user) ? <OperatorDashboard /> : <Dashboard />;
}

// unknown URLs used to silently bounce to the dashboard, hiding broken
// links/bookmarks — show an explicit, friendly 404 card instead
function NotFound() {
  return (
    <div className="min-h-dvh grid place-items-center bg-gradient-to-br from-slate-50 via-brand-50/40 to-slate-100 p-6">
      <div className="card max-w-sm w-full p-10 text-center animate-slide-up">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600" aria-hidden="true">
          <Compass className="h-7 w-7" />
        </div>
        <div className="text-6xl font-bold tracking-tight text-slate-200 select-none">404</div>
        <div className="mt-3 text-lg font-semibold text-slate-900">Page not found</div>
        <p className="mt-1 text-sm text-slate-500">
          The page you are looking for doesn't exist or has been moved. Check the URL, or head back to the dashboard.
        </p>
        <Link to="/" className="btn-primary mt-6 inline-flex w-full items-center justify-center">Back to Dashboard</Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route index element={<HomeRoute />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="departments" element={<DepartmentsPage />} />
        <Route path="department-subcategories" element={<DepartmentSubCategoryPage />} />
        <Route path="assignments" element={<AssignmentsPage />} />

        <Route path="parties" element={<PartiesPage />} />
        <Route path="parties/new" element={<PartyForm />} />
        <Route path="parties/:id" element={<PartyForm />} />

        <Route path="items" element={<ItemsPage />} />
        <Route path="items/new" element={<ItemForm />} />
        <Route path="items/:id" element={<ItemForm />} />

        <Route path="machines" element={<MachinesPage />} />
        <Route path="machines/new" element={<MachineForm />} />
        <Route path="machines/:id" element={<MachineForm />} />

        <Route path="metal-calculator" element={<MetalCalculatorPage />} />

        <Route path="quotations" element={<QuotationsPage />} />
        <Route path="quotations/new" element={<QuotationForm />} />
        <Route path="quotations/:id" element={<QuotationView />} />
        <Route path="quotations/:id/edit" element={<QuotationForm />} />

        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="invoices/new" element={<InvoiceForm />} />
        <Route path="invoices/:id" element={<InvoiceView />} />
        <Route path="invoices/:id/edit" element={<InvoiceForm />} />

        <Route path="jobcards" element={<JobcardsPage />} />
        <Route path="jobcards/new" element={<JobcardForm />} />
        <Route path="jobcards/:id" element={<JobcardView />} />
        <Route path="jobcards/:id/edit" element={<JobcardForm />} />

        <Route path="tasks" element={<TasksPage />} />
        <Route path="my-tasks" element={<MyTasksPage />} />

        <Route path="jobwork" element={<JobworkPage />} />
        <Route path="jobwork/new" element={<JobworkForm />} />

        <Route path="dispatch" element={<DispatchPage />} />
        <Route path="dispatch/new" element={<DispatchForm />} />

        <Route path="processes" element={<ProcessPage />} />
        <Route path="expenses" element={<ExpensesPage />} />

        <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="purchase-orders/new" element={<PurchaseOrderForm />} />
        <Route path="purchase-orders/:id" element={<PurchaseOrderView />} />

        <Route path="grns" element={<GRNsPage />} />
        <Route path="grns/new" element={<GRNForm />} />
        <Route path="grns/:id" element={<GRNView />} />

        <Route path="quality" element={<QualityPage />} />
        <Route path="quality/:id/certificate" element={<QualityCertificate />} />

        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectView />} />

        <Route path="sales-returns" element={<SalesReturnsPage />} />
        <Route path="sales-returns/new" element={<SalesReturnForm />} />
        <Route path="sales-returns/:id" element={<SalesReturnForm />} />

        <Route path="purchase-returns" element={<PurchaseReturnsPage />} />
        <Route path="purchase-returns/new" element={<PurchaseReturnForm />} />
        <Route path="purchase-returns/:id" element={<PurchaseReturnForm />} />

        <Route path="back-orders" element={<BackOrdersPage />} />
        <Route path="back-orders/new" element={<BackOrderForm />} />
        <Route path="back-orders/:id" element={<BackOrderForm />} />

        <Route path="production" element={<Navigate to="/production/batches" replace />} />
        <Route path="production/batches" element={<ProductionPage />} />
        <Route path="production/batches/new" element={<ProductionForm />} />
        <Route path="production/batches/:id" element={<ProductionForm />} />
        <Route path="production/shifts" element={<ShiftsPage />} />
        <Route path="shifts" element={<Navigate to="/production/shifts" replace />} />

        <Route path="boms" element={<BomPage />} />
        <Route path="boms/new" element={<BomForm />} />
        <Route path="boms/:id" element={<BomForm />} />

        <Route path="customer-material" element={<CustomerMaterialPage />} />
        <Route path="customer-material/new" element={<CustomerMaterialForm />} />
        <Route path="customer-material/:id" element={<CustomerMaterialView />} />

        <Route path="vendor-work-orders" element={<VendorWorkOrdersPage />} />
        <Route path="vendor-work-orders/new" element={<VendorWorkOrderForm />} />
        <Route path="vendor-work-orders/:id" element={<VendorWorkOrderView />} />
        <Route path="vendor-work-orders/:id/edit" element={<VendorWorkOrderForm />} />

        <Route path="stock" element={<StockManagementPage />} />

        <Route path="reports" element={<ReportsPage />} />

        <Route path="analytics/sales" element={<SalesAnalytics />} />
        <Route path="analytics/production" element={<ProductionAnalytics />} />
        <Route path="analytics/inventory" element={<InventoryAnalytics />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
