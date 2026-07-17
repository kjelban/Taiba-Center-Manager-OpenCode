
import React, { useState, useEffect, Suspense, lazy, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import UserLogin from './components/UserLogin';
import Header from './components/layout/Header';
import LogoutModal from './components/modals/LogoutModal';
import DebtAlertModal from './components/modals/DebtAlertModal';
import ErrorBoundary from './components/ErrorBoundary';
import { Sale } from './types';
import { DataService } from './services/dataService';
import { AuthProvider, useAuth } from './components/providers/AuthProvider';
import { SessionProvider, useSession } from './components/providers/SessionProvider';
import { DebtAlertProvider, useDebtAlert } from './components/providers/DebtAlertProvider';

// Directly import Dashboard (no lazy - it's the initial page after login)
import Dashboard from './pages/Dashboard';
// Lazy loading for other pages
const Inventory = lazy(() => import('./pages/Inventory'));
const POS = lazy(() => import('./pages/POS'));
const Reports = lazy(() => import('./pages/Reports'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Employees = lazy(() => import('./pages/Employees'));
const Settings = lazy(() => import('./pages/Settings'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Customers = lazy(() => import('./pages/Customers'));

const AuthenticatedApp: React.FC = () => {
  const { currentUser, handleLogin, confirmLogout, setCurrentUser } = useAuth();
  const { currentSession, setCurrentSession } = useSession();
  const { isDebtAlertOpen, setIsDebtAlertOpen, overdueSales, handleSnooze, handleSettleDebtFromAlert, handleRescheduleDebt } = useDebtAlert();
  
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Logout Modal State
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

  // Invoice Editing State
  const [invoiceToEdit, setInvoiceToEdit] = useState<Sale | null>(null);

  // Sync session from localStorage when user loads
  useEffect(() => {
    if (currentUser && !currentSession) {
      const sessionData = localStorage.getItem('taiba_current_session');
      if (sessionData) {
        try {
          setCurrentSession(JSON.parse(sessionData));
        } catch {}
      }
    }
    if (!currentUser) {
      setCurrentSession(null);
    }
  }, [currentUser, setCurrentSession]);

  // Migration Effect
  useEffect(() => {
    if (currentUser) {
      DataService.migrateFromLocalStorage().then(migrated => {
        if (migrated) {
          console.log("Data migrated successfully to Firebase.");
        }
      });
    }
  }, [currentUser]);

  // Handle Fullscreen changes
  useEffect(() => {
      const handleFsChange = () => {
          setIsFullscreen(!!document.fullscreenElement);
      };
      document.addEventListener('fullscreenchange', handleFsChange);
      return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const handleLoginWithPage = useCallback(async (employee: any) => {
    await handleLogin(employee);
    // Session is created asynchronously by onAuthStateChanged after Firebase Auth state changes.
    // Set page immediately; the SessionProvider will pick up the session when onAuthStateChanged fires.
    if (employee.permissions.includes('dashboard')) {
      setCurrentPage('dashboard');
    } else if (employee.permissions.length > 0) {
      setCurrentPage(employee.permissions[0]);
    }
  }, [handleLogin]);

  const handleLogoutComplete = useCallback(async () => {
    setIsLogoutModalOpen(false);
    await confirmLogout();
    setCurrentSession(null);
    setCurrentPage('dashboard');
    setIsSidebarOpen(false);
  }, [confirmLogout, setCurrentSession]);

  const handleEditInvoice = useCallback((sale: Sale) => {
    setInvoiceToEdit(sale);
    setCurrentPage('pos');
  }, []);

  const handleClearEdit = useCallback(() => {
    setInvoiceToEdit(null);
    setCurrentPage('invoices'); 
  }, []);

  const toggleFullscreen = useCallback(() => {
      if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen();
      } else {
          if (document.exitFullscreen) {
              document.exitFullscreen();
          }
      }
  }, []);

  const handleReload = useCallback(() => {
      setCurrentUser(null);
      setCurrentSession(null);
      setCurrentPage('dashboard');
      setIsSidebarOpen(false);
      setInvoiceToEdit(null);
      setIsDebtAlertOpen(false);
  }, [setCurrentUser, setCurrentSession, setIsDebtAlertOpen]);

  const handleOpenLogoutModal = useCallback(() => setIsLogoutModalOpen(true), []);

  const renderPage = () => {
    if (currentUser && !currentUser.permissions.includes(currentPage) && currentPage !== 'settings') {
        return <div className="p-10 text-center text-slate-500">ليس لديك صلاحية للوصول لهذه الصفحة</div>;
    }

    switch(currentPage) {
      case 'dashboard': return <Dashboard />;
      case 'inventory': return <Inventory />;
      case 'pos': return <POS currentUser={currentUser} invoiceToEdit={invoiceToEdit} onClearEdit={handleClearEdit} />;
      case 'reports': return <Reports />;
      case 'expenses': return <Expenses />;
      case 'employees': return <Employees />;
      case 'customers': return <Customers />;
      case 'invoices': return <Invoices currentUser={currentUser} onEditInvoice={handleEditInvoice} />;
      default: return <Settings />; 
    }
  };

  if (!currentUser) {
    return <UserLogin onLogin={handleLoginWithPage} />;
  }

  return (
    <div className="h-screen bg-slate-50 flex overflow-hidden" dir="rtl">
      <Sidebar 
        currentPage={currentPage} 
        setPage={setCurrentPage} 
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        currentUser={currentUser}
      />
      
      <main className="flex-1 flex flex-col min-w-0 transition-all duration-300">
        <Header 
          currentUser={currentUser}
          currentSession={currentSession}
          isSidebarOpen={isSidebarOpen}
          setIsSidebarOpen={setIsSidebarOpen}
          isFullscreen={isFullscreen}
          toggleFullscreen={toggleFullscreen}
          onReload={handleReload}
          onLogoutClick={handleOpenLogoutModal}
        />
        
        <div className="flex-1 overflow-auto">
          <ErrorBoundary>
            <Suspense fallback={<div className="flex items-center justify-center h-full p-10 text-slate-500">جاري التحميل...</div>}>
              {renderPage()}
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>

      <LogoutModal 
        isOpen={isLogoutModalOpen}
        onClose={() => setIsLogoutModalOpen(false)}
        onConfirm={handleLogoutComplete}
      />

      <DebtAlertModal 
        isOpen={isDebtAlertOpen}
        overdueSales={overdueSales}
        onSettleDebt={handleSettleDebtFromAlert}
        onRescheduleDebt={handleRescheduleDebt}
        onSnooze={handleSnooze}
      />
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <SessionProvider>
        <DebtAlertProviderWrapper />
      </SessionProvider>
    </AuthProvider>
  );
};

const DebtAlertProviderWrapper: React.FC = () => {
  const { currentUser } = useAuth();
  return (
    <DebtAlertProvider currentUser={currentUser}>
      <AuthenticatedApp />
    </DebtAlertProvider>
  );
};

export default App;
