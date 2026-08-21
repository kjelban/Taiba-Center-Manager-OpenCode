import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { Employee, Attendance } from '../../types';
import { AttendanceService, EmployeeService } from '../../services/employeeService';
import { logoutSession } from '../../services/base';

const STORAGE_KEY_USER = 'taiba_current_user';
const STORAGE_KEY_SESSION = 'taiba_current_session';
const STORAGE_KEY_LAST_SESSION = 'taiba_last_session';

interface AuthContextType {
  currentUser: Employee | null;
  isInitialLoading: boolean;
  handleLogin: (employee: Employee) => Promise<void>;
  confirmLogout: () => Promise<void>;
  setCurrentUser: (user: Employee | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

async function closeSession(sessionId: string): Promise<void> {
  try {
    await AttendanceService.clockOut(sessionId);
  } catch (e) {
    console.warn('Attendance clock-out warning:', e);
  }
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  useEffect(() => {
    const restoreUser = async () => {
      try {
        const storedUser = localStorage.getItem(STORAGE_KEY_USER);
        if (!storedUser) {
          localStorage.removeItem(STORAGE_KEY_SESSION);
          localStorage.removeItem(STORAGE_KEY_LAST_SESSION);
          setIsInitialLoading(false);
          return;
        }
        const employee: Employee = JSON.parse(storedUser);

        const fresh = await EmployeeService.getEmployee(employee.id);
        if (!fresh) {
          localStorage.removeItem(STORAGE_KEY_USER);
          localStorage.removeItem(STORAGE_KEY_SESSION);
          localStorage.removeItem(STORAGE_KEY_LAST_SESSION);
          setIsInitialLoading(false);
          return;
        }

        setCurrentUser(fresh);
        localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(fresh));

        // Restore active attendance session without synthetic time-based expiration
        let activeSession: Attendance | null = null;
        const storedSession = localStorage.getItem(STORAGE_KEY_SESSION);
        if (storedSession) {
          try {
            const parsed = JSON.parse(storedSession);
            if (parsed?.id && parsed?.checkInTime && !parsed?.checkOutTime) {
              activeSession = parsed;
            }
          } catch {}
        }

        // If local storage did not have an open shift, query authoritative server
        if (!activeSession) {
          activeSession = await AttendanceService.getActiveSession(fresh.id);
        }

        if (activeSession) {
          localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(activeSession));
          localStorage.setItem(STORAGE_KEY_LAST_SESSION, JSON.stringify({
            employeeId: fresh.id,
            sessionId: activeSession.id,
            lastActivity: new Date().toISOString(),
          }));
        }
      } catch (err) {
        console.warn('User session restoration warning:', err);
      } finally {
        setIsInitialLoading(false);
      }
    };
    restoreUser();
  }, []);

  const handleLogin = useCallback(async (employee: Employee) => {
    // 1. Check if employee already has an active open shift in Firestore
    let session: Attendance | null = await AttendanceService.getActiveSession(employee.id);

    // 2. If no existing active shift in Firestore, clock-in a new shift
    if (!session) {
      session = await AttendanceService.clockIn(employee);
    }

    // 3. Persist session state
    const sessionWithActivity = { ...session, lastActivity: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(sessionWithActivity));
    localStorage.setItem(STORAGE_KEY_LAST_SESSION, JSON.stringify({
      employeeId: employee.id,
      sessionId: session.id,
      lastActivity: new Date().toISOString(),
    }));

    setCurrentUser(employee);
    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(employee));
  }, []);

  const confirmLogout = useCallback(async () => {
    const sessionData = localStorage.getItem(STORAGE_KEY_SESSION);
    const lastInfoRaw = localStorage.getItem(STORAGE_KEY_LAST_SESSION);

    let sessionId: string | null = null;
    if (sessionData) {
      try {
        const session = JSON.parse(sessionData);
        if (session?.id && !session?.checkOutTime) {
          sessionId = session.id;
        }
      } catch {}
    }
    if (!sessionId && lastInfoRaw) {
      try {
        const info = JSON.parse(lastInfoRaw);
        if (info.sessionId) sessionId = info.sessionId;
      } catch {}
    }

    // Authoritative fallback: retrieve open session from server if local cache was cleared
    if (!sessionId && currentUser?.id) {
      const active = await AttendanceService.getActiveSession(currentUser.id);
      if (active?.id) sessionId = active.id;
    }

    if (sessionId) {
      await closeSession(sessionId);
    }

    localStorage.removeItem(STORAGE_KEY_SESSION);
    localStorage.removeItem(STORAGE_KEY_LAST_SESSION);
    localStorage.removeItem(STORAGE_KEY_USER);
    await logoutSession();
    setCurrentUser(null);
  }, [currentUser]);

  return (
    <AuthContext.Provider value={{ currentUser, isInitialLoading, handleLogin, confirmLogout, setCurrentUser }}>
      {isInitialLoading ? (
        <div className="fixed inset-0 bg-slate-900 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-white text-lg font-bold">طيبة سنتر</p>
            <p className="text-slate-400 text-sm">جاري التحميل...</p>
          </div>
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
};
