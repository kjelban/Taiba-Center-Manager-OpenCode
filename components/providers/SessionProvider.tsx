
import React, { useState, useEffect, createContext, useContext } from 'react';
import { Attendance } from '../../types';

interface SessionContextType {
  currentSession: Attendance | null;
  setCurrentSession: (session: Attendance | null) => void;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export const useSession = (): SessionContextType => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
};

interface SessionProviderProps {
  children: React.ReactNode;
}

export const SessionProvider: React.FC<SessionProviderProps> = ({ children }) => {
  const [currentSession, setCurrentSession] = useState<Attendance | null>(() => {
    const stored = localStorage.getItem('taiba_current_session');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {}
    }
    return null;
  });

  useEffect(() => {
    if (currentSession) {
      localStorage.setItem('taiba_current_session', JSON.stringify(currentSession));
    } else {
      localStorage.removeItem('taiba_current_session');
    }
  }, [currentSession]);

  return (
    <SessionContext.Provider value={{ currentSession, setCurrentSession }}>
      {children}
    </SessionContext.Provider>
  );
};
