
import React, { useState, useEffect, createContext, useContext } from 'react';
import { Attendance } from '../../types';

const STORAGE_KEY_SESSION = 'taiba_current_session';
const STORAGE_KEY_LAST_SESSION = 'taiba_last_session';
const ACTIVITY_INTERVAL_MS = 10_000;

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

const updateLastActivity = () => {
  const raw = localStorage.getItem(STORAGE_KEY_LAST_SESSION);
  if (raw) {
    try {
      const info = JSON.parse(raw);
      info.lastActivity = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY_LAST_SESSION, JSON.stringify(info));
    } catch {}
  }
};

interface SessionProviderProps {
  children: React.ReactNode;
}

export const SessionProvider: React.FC<SessionProviderProps> = ({ children }) => {
  const [currentSession, setCurrentSession] = useState<Attendance | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY_SESSION);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed?.id && parsed?.checkInTime && !parsed?.checkOutTime) {
          return parsed;
        }
      } catch {}
    }
    return null;
  });

  useEffect(() => {
    if (currentSession) {
      localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(currentSession));
      updateLastActivity();
    } else {
      localStorage.removeItem(STORAGE_KEY_SESSION);
    }
  }, [currentSession]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible' && localStorage.getItem(STORAGE_KEY_SESSION)) {
        updateLastActivity();
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        updateLastActivity();
      }
    };

    const interval = setInterval(tick, ACTIVITY_INTERVAL_MS);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return (
    <SessionContext.Provider value={{ currentSession, setCurrentSession }}>
      {children}
    </SessionContext.Provider>
  );
};
