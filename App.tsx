
import React, { useState, useEffect, Suspense, lazy } from 'react';
import Sidebar from './components/Sidebar';
import UserLogin from './components/UserLogin';
import { Check } from 'lucide-react';
import Header from './components/layout/Header';
import LogoutModal from './components/modals/LogoutModal';
import DebtAlertModal from './components/modals/DebtAlertModal';
import { Employee, Attendance, Sale } from './types';
import { DataService } from './services/dataService';

// Lazy loading pages for code splitting
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Inventory = lazy(() => import('./pages/Inventory'));
const POS = lazy(() => import('./pages/POS'));
const Reports = lazy(() => import('./pages/Reports'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Employees = lazy(() => import('./pages/Employees'));
const Settings = lazy(() => import('./pages/Settings'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Customers = lazy(() => import('./pages/Customers'));

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  // User Session State
  const [currentUser, setCurrentUser] = useState<Employee | null>(() => {
    const saved = localStorage.getItem('taiba_current_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [currentSession, setCurrentSession] = useState<Attendance | null>(() => {
    const saved = localStorage.getItem('taiba_current_session');
    return saved ? JSON.parse(saved) : null;
  });
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Logout Modal State
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

  // Invoice Editing State
  const [invoiceToEdit, setInvoiceToEdit] = useState<Sale | null>(null);

  // Debt Alert State
  const [isDebtAlertOpen, setIsDebtAlertOpen] = useState(false);
  const [overdueSales, setOverdueSales] = useState<Sale[]>([]);
  
  // Snooze Logic - Persisted in LocalStorage to survive refreshes
  const [snoozeUntil, setSnoozeUntil] = useState<number>(() => {
    const saved = localStorage.getItem('taiba_snooze_until');
    return saved ? Number(saved) : 0;
  }); 
  const [snoozeDuration, setSnoozeDuration] = useState<number>(30); // Default minutes

  // Reschedule State (Temporary for input)
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);

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

  // Timer Effect
  // Handle Fullscreen changes
  useEffect(() => {
      const handleFsChange = () => {
          setIsFullscreen(!!document.fullscreenElement);
      };
      document.addEventListener('fullscreenchange', handleFsChange);
      return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Persist Snooze Time change
  useEffect(() => {
      localStorage.setItem('taiba_snooze_until', snoozeUntil.toString());
  }, [snoozeUntil]);

  // Debt Checking Logic (Recurring)
  useEffect(() => {
    if (!currentUser) return;

    const checkDebts = async () => {
        const now = Date.now();
        // 1. Check if snoozed
        if (now < snoozeUntil) return;

        // 2. Check if already open (avoid re-fetching/re-opening while user is interacting)
        if (isDebtAlertOpen) return;

        const overdue = await DataService.getOverdueSales();
        if (overdue.length > 0) {
            setOverdueSales(overdue);
            setIsDebtAlertOpen(true);
            
            // Play notification sound
            const audio = new Audio('https://www.soundjay.com/buttons/sounds/beep-01a.mp3');
            audio.play().catch(() => {});
        }
    };

    // Check immediately on load/login
    checkDebts();

    // Check every minute (to catch snooze expiration)
    const debtInterval = setInterval(checkDebts, 60 * 1000); 

    // Add visibility listener to re-check when user comes back (handles background throttling)
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            checkDebts();
        }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
        clearInterval(debtInterval);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentUser, isDebtAlertOpen, snoozeUntil]);


  const handleLogin = async (employee: Employee) => {
    try {
        const session = await DataService.clockIn(employee);
        setCurrentUser(employee);
        setCurrentSession(session);
        localStorage.setItem('taiba_current_user', JSON.stringify(employee));
        if (session) {
            localStorage.setItem('taiba_current_session', JSON.stringify(session));
        }
        
        // Set default page based on permissions
        if (employee.permissions.includes('dashboard')) {
            setCurrentPage('dashboard');
        } else if (employee.permissions.length > 0) {
            setCurrentPage(employee.permissions[0]);
        }
    } catch (error) {
        console.error("Login failed:", error);
        alert("فشل تسجيل الدخول. يرجى المحاولة مرة أخرى.");
    }
  };

  const confirmLogout = async () => {
    const sessionId = currentSession?.id;
    setIsLogoutModalOpen(false);
    
    if (sessionId) {
        try {
            await DataService.clockOut(sessionId);
        } catch (e) {
            console.error("Clock-out error:", e);
        }
    }
    
    try {
        localStorage.setItem("explicitlySignedOut", "true");
        localStorage.removeItem('taiba_current_user');
        localStorage.removeItem('taiba_current_session');
    } catch (e) {
        console.error("Signout error:", e);
    }
    
    setCurrentUser(null);
    setCurrentSession(null);
    setCurrentPage('dashboard');
    setIsSidebarOpen(false); 
  };

  const handleEditInvoice = (sale: Sale) => {
    setInvoiceToEdit(sale);
    setCurrentPage('pos');
  };

  const handleClearEdit = () => {
    setInvoiceToEdit(null);
    setCurrentPage('invoices'); 
  };

  const toggleFullscreen = () => {
      if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen();
      } else {
          if (document.exitFullscreen) {
              document.exitFullscreen();
          }
      }
  };

  const handleReload = () => {
      // Soft reset: clears user state to simulate a reload without triggering browser navigation errors (404)
      setCurrentUser(null);
      setCurrentSession(null);
      setCurrentPage('dashboard');
      setIsSidebarOpen(false);
      setInvoiceToEdit(null);
      setIsDebtAlertOpen(false);
  };

  const renderPage = () => {
    if (currentUser && !currentUser.permissions.includes(currentPage) && currentPage !== 'settings') {
        if (currentPage === 'settings' && currentUser.permissions.includes('settings')) {
            return (
                <Suspense fallback={<div className="flex items-center justify-center h-full p-10 text-slate-500">جاري التحميل...</div>}>
                    <Settings />
                </Suspense>
            );
        }
        return <div className="p-10 text-center text-slate-500">ليس لديك صلاحية للوصول لهذه الصفحة</div>;
    }

    const PageContent = () => {
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

    return (
        <Suspense fallback={<div className="flex items-center justify-center h-full p-10 text-slate-500">جاري التحميل...</div>}>
            <PageContent />
        </Suspense>
    );
  };

  if (!currentUser) {
    return <UserLogin onLogin={handleLogin} />;
  }



  const handleSettleDebtFromAlert = async (saleId: string) => {
    await DataService.settleDebt(saleId);
    // Refresh list locally to avoid full re-fetch flicker
    const remaining = overdueSales.filter(s => s.id !== saleId);
    setOverdueSales(remaining);
    if (remaining.length === 0) {
        setIsDebtAlertOpen(false);
    }
  };

  const handleRescheduleDebt = async (saleId: string, newDate: string) => {
    if (!newDate) return;
    await DataService.rescheduleDebt(saleId, newDate);
    
    // Remove from current alert list because it's no longer overdue (presumably rescheduled to future)
    const remaining = overdueSales.filter(s => s.id !== saleId);
    setOverdueSales(remaining);
    setRescheduleId(null);

    if (remaining.length === 0) {
        setIsDebtAlertOpen(false);
    }
  };

  const handleSnooze = () => {
    // Set snooze time
    setSnoozeUntil(Date.now() + (snoozeDuration * 60 * 1000));
    setIsDebtAlertOpen(false);
  };

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
          onLogoutClick={() => setIsLogoutModalOpen(true)}
        />
        
        <div className="flex-1 overflow-auto">
            {renderPage()}
        </div>
      </main>

      <LogoutModal 
        isOpen={isLogoutModalOpen}
        onClose={() => setIsLogoutModalOpen(false)}
        onConfirm={confirmLogout}
      />

      <DebtAlertModal 
        isOpen={isDebtAlertOpen}
        overdueSales={overdueSales}
        onSettleDebt={handleSettleDebtFromAlert}
        onRescheduleDebt={handleRescheduleDebt}
        onSnooze={(dur) => {
            setSnoozeDuration(dur);
            setSnoozeUntil(Date.now() + (dur * 60 * 1000));
            setIsDebtAlertOpen(false);
        }}
      />
    </div>
  );
};
export default App;
