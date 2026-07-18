
import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { Attendance } from '../../types';
import { getServerSessionToken } from '../../services/base';

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
    // Initialize from localStorage (set by AuthProvider during mount)
    const stored = localStorage.getItem('taiba_current_session');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {}
    }
    return null;
  });

  // Sync session changes to localStorage
  useEffect(() => {
    if (currentSession) {
      localStorage.setItem('taiba_current_session', JSON.stringify(currentSession));
    }
  }, [currentSession]);

  // Auto clock-out on page close/refresh
  useEffect(() => {
    if (!currentSession?.id) return;
    const handleBeforeUnload = () => {
      const token = getServerSessionToken();
      if (!token) return;
      fetch('/api/clockout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id: currentSession.id }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [currentSession?.id]);

  return (
    <SessionContext.Provider value={{ currentSession, setCurrentSession }}>
      {children}
    </SessionContext.Provider>
  );
};
