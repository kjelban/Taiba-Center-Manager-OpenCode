
import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { Employee } from '../../types';
import { EmployeeService, AttendanceService } from '../../services/employeeService';
import { setServerSessionToken } from '../../services/base';

const STORAGE_KEY_USER = 'taiba_current_user';
const STORAGE_KEY_SESSION = 'taiba_current_session';

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

  // Restore user from localStorage on mount
  useEffect(() => {
    const restoreUser = async () => {
      try {
        const storedUser = localStorage.getItem(STORAGE_KEY_USER);
        if (!storedUser) {
          setIsInitialLoading(false);
          return;
        }
        const employee: Employee = JSON.parse(storedUser);

        // Validate employee still exists in Firestore
        const fresh = await EmployeeService.getEmployee(employee.id);
        if (!fresh) {
          localStorage.removeItem(STORAGE_KEY_USER);
          localStorage.removeItem(STORAGE_KEY_SESSION);
          setIsInitialLoading(false);
          return;
        }

        setCurrentUser(fresh);
        localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(fresh));
      } catch {
        localStorage.removeItem(STORAGE_KEY_USER);
        localStorage.removeItem(STORAGE_KEY_SESSION);
      } finally {
        setIsInitialLoading(false);
      }
    };
    restoreUser();
  }, []);

  const handleLogin = useCallback(async (employee: Employee) => {
    setCurrentUser(employee);
    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(employee));

    try {
      const session = await AttendanceService.clockIn(employee);
      localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
    } catch (e) {
      console.error("Attendance clock-in error:", e);
    }
  }, []);

  const confirmLogout = useCallback(async () => {
    const sessionData = localStorage.getItem(STORAGE_KEY_SESSION);
    if (sessionData) {
      try {
        const session = JSON.parse(sessionData);
        if (session.id) {
          await AttendanceService.clockOut(session.id);
        }
      } catch (e) {
        console.error("Clock-out error:", e);
      }
    }
    localStorage.removeItem(STORAGE_KEY_SESSION);
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
