
import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { Employee } from '../../types';
import { EmployeeService, AttendanceService } from '../../services/employeeService';
import { setServerSessionToken } from '../../services/base';

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
  const [isInitialLoading, setIsInitialLoading] = useState(false);

  const handleLogin = useCallback(async (employee: Employee) => {
    setCurrentUser(employee);

    // Set up attendance
    try {
      const activeSession = await AttendanceService.getActiveSession(employee.id);
      if (activeSession) {
        const checkIn = new Date(activeSession.checkInTime).getTime();
        const now = Date.now();
        const twelveHours = 12 * 60 * 60 * 1000;
        if (now - checkIn < twelveHours) {
          localStorage.setItem('taiba_current_session', JSON.stringify(activeSession));
        } else {
          await AttendanceService.closeRecord(activeSession);
          const newSession = await AttendanceService.clockIn(employee);
          localStorage.setItem('taiba_current_session', JSON.stringify(newSession));
        }
      } else {
        const newSession = await AttendanceService.clockIn(employee);
        localStorage.setItem('taiba_current_session', JSON.stringify(newSession));
      }
    } catch (e) {
      console.error("Attendance setup error:", e);
    }
  }, []);

  const confirmLogout = useCallback(async () => {
    const sessionData = localStorage.getItem('taiba_current_session');
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
    localStorage.removeItem('taiba_current_session');
    setServerSessionToken(null);
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
