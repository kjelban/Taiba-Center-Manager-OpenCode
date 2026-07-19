
import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { Employee } from '../../types';
import { AttendanceService, EmployeeService } from '../../services/employeeService';
import { setServerSessionToken } from '../../services/base';

const STORAGE_KEY_USER = 'taiba_current_user';
const STORAGE_KEY_SESSION = 'taiba_current_session';
const STORAGE_KEY_LAST_SESSION = 'taiba_last_session';
const SESSION_FRESHNESS_MS = 30_000;

interface LastSessionInfo {
  employeeId: string;
  sessionId: string;
  lastActivity: string;
}

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

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  useEffect(() => {
    const restoreUser = async () => {
      try {
        const storedUser = localStorage.getItem(STORAGE_KEY_USER);
        if (!storedUser) {
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

        const lastInfoRaw = localStorage.getItem(STORAGE_KEY_LAST_SESSION);
        if (lastInfoRaw) {
          const info: LastSessionInfo = JSON.parse(lastInfoRaw);
          const elapsed = Date.now() - new Date(info.lastActivity).getTime();
          if (elapsed > SESSION_FRESHNESS_MS) {
            localStorage.removeItem(STORAGE_KEY_SESSION);
            localStorage.removeItem(STORAGE_KEY_LAST_SESSION);
            if (info.sessionId) {
              AttendanceService.clockOut(info.sessionId).catch(() => {});
            }
          }
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY_USER);
        localStorage.removeItem(STORAGE_KEY_SESSION);
        localStorage.removeItem(STORAGE_KEY_LAST_SESSION);
      } finally {
        setIsInitialLoading(false);
      }
    };
    restoreUser();
  }, []);

  const handleLogin = useCallback(async (employee: Employee) => {
    const lastInfoRaw = localStorage.getItem(STORAGE_KEY_LAST_SESSION);
    if (lastInfoRaw) {
      try {
        const info: LastSessionInfo = JSON.parse(lastInfoRaw);
        const elapsed = Date.now() - new Date(info.lastActivity).getTime();
        const sameEmployee = info.employeeId === employee.id;

        if (sameEmployee && elapsed <= SESSION_FRESHNESS_MS) {
          setCurrentUser(employee);
          localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(employee));
          info.lastActivity = new Date().toISOString();
          localStorage.setItem(STORAGE_KEY_LAST_SESSION, JSON.stringify(info));
          return;
        }

        if (info.sessionId) {
          await AttendanceService.clockOut(info.sessionId).catch(() => {});
        }
        localStorage.removeItem(STORAGE_KEY_LAST_SESSION);
      } catch {}
    }

    const session = await AttendanceService.clockIn(employee);
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
    localStorage.removeItem(STORAGE_KEY_USER);
    setServerSessionToken(null);
    setCurrentUser(null);
  }, []);

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
