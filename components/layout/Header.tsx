import React, { useState, useEffect } from 'react';
import { Menu, Clock, LogOut, Maximize, Minimize, RotateCcw } from 'lucide-react';
import { Employee, Attendance } from '../../types';

interface HeaderProps {
  currentUser: Employee;
  currentSession: Attendance | null;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  onReload: () => void;
  onLogoutClick: () => void;
}

const formatDuration = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} س ${m} د`;
};

const Header: React.FC<HeaderProps> = ({
  currentUser,
  currentSession,
  isSidebarOpen,
  setIsSidebarOpen,
  isFullscreen,
  toggleFullscreen,
  onReload,
  onLogoutClick,
}) => {
  const [workDuration, setWorkDuration] = useState(0);

  useEffect(() => {
    let interval: number;
    if (currentUser && currentSession) {
        const calculateDuration = () => {
            const start = new Date(currentSession.checkInTime).getTime();
            const now = new Date().getTime();
            setWorkDuration(Math.floor((now - start) / 60000));
        };
        
        calculateDuration();
        interval = window.setInterval(calculateDuration, 60000);
    }
    return () => clearInterval(interval);
  }, [currentUser, currentSession]);

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sticky top-0 z-30 shadow-sm gap-2">
      <button
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className="md:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-lg shrink-0"
      >
        <Menu size={24} />
      </button>

      <div className="flex items-center gap-2 md:gap-4 flex-1 justify-end">
        <div className="flex items-center gap-2 md:gap-3 bg-slate-50 px-2 md:px-3 py-1.5 rounded-lg border border-slate-100">
          <div className="h-8 w-8 bg-primary/10 rounded-full flex items-center justify-center text-primary font-bold text-sm shrink-0">
            {currentUser.name.charAt(0)}
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-sm font-bold text-slate-700 leading-tight">{currentUser.name}</p>
            <p className="text-[10px] text-slate-400">{currentUser.role}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg text-sm font-medium border border-blue-100" title="وقت الدوام الحالي">
          <Clock size={16} />
          <span>{formatDuration(workDuration)}</span>
        </div>

        <div className="h-8 w-px bg-slate-200 mx-1"></div>

        <button
          onClick={onReload}
          className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
          title="إعادة تحميل النظام"
        >
          <RotateCcw size={20} />
        </button>
        
        <button
          onClick={toggleFullscreen}
          className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
          title={isFullscreen ? "إنهاء ملء الشاشة" : "ملء الشاشة"}
        >
          {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
        </button>

        <button
          type="button"
          onClick={onLogoutClick}
          className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer active:scale-95"
          title="إنهاء الدوام (تسجيل الخروج)"
        >
          <LogOut size={20} />
        </button>
      </div>
    </header>
  );
};

export default Header;
