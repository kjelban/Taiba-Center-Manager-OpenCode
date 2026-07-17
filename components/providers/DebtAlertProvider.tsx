
import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { Sale } from '../../types';
import { DataService } from '../../services/dataService';

interface DebtAlertContextType {
  isDebtAlertOpen: boolean;
  setIsDebtAlertOpen: (open: boolean) => void;
  overdueSales: Sale[];
  handleSnooze: (dur: number) => void;
  handleSettleDebtFromAlert: (saleId: string) => Promise<void>;
  handleRescheduleDebt: (saleId: string, newDate: string) => Promise<void>;
  rescheduleId: string | null;
  setRescheduleId: (id: string | null) => void;
}

const DebtAlertContext = createContext<DebtAlertContextType | undefined>(undefined);

export const useDebtAlert = (): DebtAlertContextType => {
  const context = useContext(DebtAlertContext);
  if (!context) {
    throw new Error('useDebtAlert must be used within a DebtAlertProvider');
  }
  return context;
};

interface DebtAlertProviderProps {
  children: React.ReactNode;
  currentUser: any;
}

export const DebtAlertProvider: React.FC<DebtAlertProviderProps> = ({ children, currentUser }) => {
  const [isDebtAlertOpen, setIsDebtAlertOpen] = useState(false);
  const [overdueSales, setOverdueSales] = useState<Sale[]>([]);
  
  // Snooze Logic - Persisted in LocalStorage to survive refreshes
  const [snoozeUntil, setSnoozeUntil] = useState<number>(() => {
    const saved = localStorage.getItem('taiba_snooze_until');
    return saved ? Number(saved) : 0;
  }); 
  const [snoozeDuration, setSnoozeDuration] = useState<number>(30);

  // Reschedule State
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);

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

  const handleSettleDebtFromAlert = useCallback(async (saleId: string): Promise<void> => {
    await DataService.settleDebt(saleId);
    const remaining = overdueSales.filter(s => s.id !== saleId);
    setOverdueSales(remaining);
    if (remaining.length === 0) {
        setIsDebtAlertOpen(false);
    }
  }, [overdueSales]);

  const handleRescheduleDebt = useCallback(async (saleId: string, newDate: string): Promise<void> => {
    if (!newDate) return;
    await DataService.rescheduleDebt(saleId, newDate);
    const remaining = overdueSales.filter(s => s.id !== saleId);
    setOverdueSales(remaining);
    setRescheduleId(null);
    if (remaining.length === 0) {
        setIsDebtAlertOpen(false);
    }
  }, [overdueSales]);

  const handleSnooze = useCallback((dur: number) => {
    setSnoozeDuration(dur);
    setSnoozeUntil(Date.now() + (dur * 60 * 1000));
    setIsDebtAlertOpen(false);
  }, []);

  return (
    <DebtAlertContext.Provider value={{
      isDebtAlertOpen,
      setIsDebtAlertOpen,
      overdueSales,
      handleSnooze,
      handleSettleDebtFromAlert,
      handleRescheduleDebt,
      rescheduleId,
      setRescheduleId,
    }}>
      {children}
    </DebtAlertContext.Provider>
  );
};
