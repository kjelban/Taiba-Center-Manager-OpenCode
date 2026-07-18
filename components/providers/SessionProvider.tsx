
import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
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

const CLOCKOUT_DELAY_MS = 30_000; // 30 seconds — if page hidden longer, clockout (browser closed)

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

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef(currentSession);
  sessionRef.current = currentSession;

  // Sync session changes to localStorage
  useEffect(() => {
    if (currentSession) {
      localStorage.setItem('taiba_current_session', JSON.stringify(currentSession));
    } else {
      localStorage.removeItem('taiba_current_session');
    }
  }, [currentSession]);

  // Auto clockout when page is hidden for too long (browser close detection)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Page just became hidden — start a timer to clockout
        if (sessionRef.current?.id) {
          const token = getServerSessionToken();
          if (!token) return;
          timerRef.current = setTimeout(() => {
            fetch('/api/clockout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ id: sessionRef.current?.id }),
              keepalive: true,
            }).catch(() => {});
            // Clear session from localStorage so next load starts fresh
            localStorage.removeItem('taiba_current_session');
          }, CLOCKOUT_DELAY_MS);
        }
      } else if (document.visibilityState === 'visible') {
        // Page became visible again — cancel the timer (it was a refresh or tab switch)
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        // Sync session from localStorage in case it was updated by another tab
        const stored = localStorage.getItem('taiba_current_session');
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (parsed?.id && parsed?.id !== sessionRef.current?.id) {
              setCurrentSession(parsed);
            }
          } catch {}
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <SessionContext.Provider value={{ currentSession, setCurrentSession }}>
      {children}
    </SessionContext.Provider>
  );
};
