import { useEffect } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import Login from './pages/auth/Login.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import OperatorDashboard from './pages/operator/OperatorDashboard.jsx';
import UsersPage from './pages/users/UsersPage.jsx';
import RolesPage from './pages/roles/RolesPage.jsx';
import PartiesPage from './pages/parties/PartiesPage.jsx';
import PartyForm from './pages/parties/PartyForm.jsx';
import ItemsPage from './pages/items/ItemsPage.jsx';
import ItemForm from './pages/items/ItemForm.jsx';
import InvoicesPage from './pages/invoices/InvoicesPage.jsx';
import InvoiceForm from './pages/invoices/InvoiceForm.jsx';
import InvoiceView from './pages/invoices/InvoiceView.jsx';
import JobcardsPage from './pages/jobcards/JobcardsPage.jsx';
import JobcardForm from './pages/jobcards/JobcardForm.jsx';
import JobcardView from './pages/jobcards/JobcardView.jsx';
import JobworkPage from './pages/jobwork/JobworkPage.jsx';
import JobworkForm from './pages/jobwork/JobworkForm.jsx';
import DispatchPage from './pages/dispatch/DispatchPage.jsx';
import DispatchForm from './pages/dispatch/DispatchForm.jsx';
import ProcessPage from './pages/process/ProcessPage.jsx';
import ExpensesPage from './pages/expense/ExpensesPage.jsx';
import PurchaseOrdersPage from './pages/purchase/PurchaseOrdersPage.jsx';
import PurchaseOrderForm from './pages/purchase/PurchaseOrderForm.jsx';
import PurchaseOrderView from './pages/purchase/PurchaseOrderView.jsx';
import GRNsPage from './pages/purchase/GRNsPage.jsx';
import GRNForm from './pages/purchase/GRNForm.jsx';
import GRNView from './pages/purchase/GRNView.jsx';
import QualityPage from './pages/quality/QualityPage.jsx';
import ProjectsPage from './pages/project/ProjectsPage.jsx';
import ProjectView from './pages/project/ProjectView.jsx';
import ReportsPage from './pages/reports/ReportsPage.jsx';
import SalesAnalytics from './pages/analytics/SalesAnalytics.jsx';
import ProductionAnalytics from './pages/analytics/ProductionAnalytics.jsx';
import InventoryAnalytics from './pages/analytics/InventoryAnalytics.jsx';
import SalesReturnsPage from './pages/salesReturns/SalesReturnsPage.jsx';
import SalesReturnForm from './pages/salesReturns/SalesReturnForm.jsx';
import PurchaseReturnsPage from './pages/purchaseReturns/PurchaseReturnsPage.jsx';
import PurchaseReturnForm from './pages/purchaseReturns/PurchaseReturnForm.jsx';
import BackOrdersPage from './pages/backOrders/BackOrdersPage.jsx';
import BackOrderForm from './pages/backOrders/BackOrderForm.jsx';
import ProductionPage from './pages/production/ProductionPage.jsx';
import ProductionForm from './pages/production/ProductionForm.jsx';
import ShiftsPage from './pages/production/ShiftsPage.jsx';
import BomPage from './pages/bom/BomPage.jsx';
import BomForm from './pages/bom/BomForm.jsx';
import MachinesPage from './pages/machines/MachinesPage.jsx';
import MachineForm from './pages/machines/MachineForm.jsx';
import QuotationsPage from './pages/quotations/QuotationsPage.jsx';
import QuotationForm from './pages/quotations/QuotationForm.jsx';
import QuotationView from './pages/quotations/QuotationView.jsx';
import CustomerMaterialPage from './pages/customerMaterial/CustomerMaterialPage.jsx';
import CustomerMaterialForm from './pages/customerMaterial/CustomerMaterialForm.jsx';
import CustomerMaterialView from './pages/customerMaterial/CustomerMaterialView.jsx';
import VendorWorkOrdersPage from './pages/vendorWorkOrders/VendorWorkOrdersPage.jsx';
import VendorWorkOrderForm from './pages/vendorWorkOrders/VendorWorkOrderForm.jsx';
import VendorWorkOrderView from './pages/vendorWorkOrders/VendorWorkOrderView.jsx';
import StockManagementPage from './pages/stock/StockManagementPage.jsx';
import DepartmentsPage from './pages/departments/DepartmentsPage.jsx';
import AssignmentsPage from './pages/assignments/AssignmentsPage.jsx';
import DepartmentSubCategoryPage from './pages/departments/DepartmentSubCategoryPage.jsx';
import { useAuth } from './store/auth';

// operators, project engineers, and department-scoped roles (Department
// Head and anyone under them — any role with scopeToDepartment set) only
// ever get their dashboard + their own project's detail page; every other
// URL bounces back to "/" (server-side ownership checks back this up on
// every API call, this is just so the nav/UX doesn't dangle broken links)
function isRestrictedUser(user) {
  return user?.role === 'OPERATOR' || user?.role === 'Project Engineer' || !!user?.scopeToDepartment;
}
const RESTRICTED_ALLOWED_PATHS = [/^\/$/, /^\/jobcards\/\d+$/, /^\/assignments$/];

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
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-slate-50 via-brand-50/40 to-slate-100 p-6">
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
