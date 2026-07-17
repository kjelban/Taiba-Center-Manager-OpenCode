
import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { Employee } from '../../types';
import { EmployeeService, AttendanceService } from '../../services/employeeService';

interface AuthContextType {
  currentUser: Employee | null;
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
    const loadUser = async () => {
      const userId = localStorage.getItem('taiba_user_id');

      if (userId) {
        const employee = await EmployeeService.getEmployee(userId);
        if (employee) {
          setCurrentUser(employee);

          const explicitSignOut = localStorage.getItem('explicitlySignedOut');
          localStorage.removeItem('explicitlySignedOut');

          let shouldCreateNewSession = true;

          if (!explicitSignOut) {
            const activeSession = await AttendanceService.getActiveSession(employee.id);
            if (activeSession) {
              const checkIn = new Date(activeSession.checkInTime).getTime();
              const now = Date.now();
              const twelveHours = 12 * 60 * 60 * 1000;
              if (now - checkIn < twelveHours) {
                localStorage.setItem('taiba_current_session', JSON.stringify(activeSession));
                shouldCreateNewSession = false;
              }
            }
          }

          if (shouldCreateNewSession) {
            try {
              const newSession = await AttendanceService.clockIn(employee);
              localStorage.setItem('taiba_current_session', JSON.stringify(newSession));
            } catch {}
          }
        } else {
          localStorage.removeItem('taiba_user_id');
          localStorage.removeItem('taiba_current_session');
        }
      }
      await AttendanceService.autoCloseOpenSessions();
      setIsInitialLoading(false);
    };
    loadUser();
  }, []);

  const handleLogin = useCallback(async (employee: Employee) => {
    try {
        const session = await AttendanceService.clockIn(employee);
        setCurrentUser(employee);
        localStorage.setItem('taiba_user_id', employee.id);
        if (session) {
            localStorage.setItem('taiba_current_session', JSON.stringify(session));
        }
    } catch (error) {
        console.error("Login failed:", error);
        alert("فشل تسجيل الدخول. يرجى المحاولة مرة أخرى.");
    }
  }, []);

  const confirmLogout = useCallback(async () => {
    const sessionData = localStorage.getItem('taiba_current_session');
    let sessionId: string | null = null;
    if (sessionData) {
      try {
        const session = JSON.parse(sessionData);
        sessionId = session.id;
      } catch {}
    }
    
    if (sessionId) {
        try {
            await AttendanceService.clockOut(sessionId);
        } catch (e) {
            console.error("Clock-out error:", e);
        }
    }
    
    try {
        localStorage.setItem("explicitlySignedOut", "true");
        localStorage.removeItem('taiba_user_id');
        localStorage.removeItem('taiba_current_session');
    } catch (e) {
        console.error("Signout error:", e);
    }
    
    setCurrentUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, handleLogin, confirmLogout, setCurrentUser }}>
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
