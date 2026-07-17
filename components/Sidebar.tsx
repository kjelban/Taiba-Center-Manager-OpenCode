
import React from 'react';
import { 
  LayoutDashboard, 
  ShoppingBag, 
  Package, 
  TrendingUp, 
  Users, 
  Wallet, 
  Settings,
  Baby,
  ReceiptText,
  UserCircle
} from 'lucide-react';
import { Employee } from '../types';

interface SidebarProps {
  currentPage: string;
  setPage: (page: string) => void;
  isOpen: boolean;
  setIsOpen: (val: boolean) => void;
  currentUser: Employee | null;
}

const Sidebar: React.FC<SidebarProps> = ({ currentPage, setPage, isOpen, setIsOpen, currentUser }) => {
  const allMenuItems = [
    { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
    { id: 'pos', label: 'نقطة البيع (POS)', icon: ShoppingBag },
    { id: 'invoices', label: 'سجل الفواتير', icon: ReceiptText },
    { id: 'inventory', label: 'المخزون والمنتجات', icon: Package },
    { id: 'customers', label: 'إدارة العملاء', icon: UserCircle },
    { id: 'reports', label: 'التقارير المالية', icon: TrendingUp },
    { id: 'expenses', label: 'المصاريف', icon: Wallet },
    { id: 'employees', label: 'إدارة المستخدمين', icon: Users },
  ];

  // Filter items based on permissions
  const menuItems = allMenuItems.filter(item => {
    if (!currentUser) return false;
    // Admins have all access, but let's rely on permissions array
    if (currentUser.permissions.includes(item.id)) return true;
    return false;
  });

  const canAccessSettings = currentUser?.permissions.includes('settings');

  return (
    <>
        {/* Mobile Overlay */}
        {isOpen && (
            <div 
                className="fixed inset-0 bg-black/50 z-40 md:hidden"
                onClick={() => setIsOpen(false)}
                aria-label="إغلاق القائمة"
            />
        )}

        <aside className={`
            fixed top-0 h-full bg-slate-900 text-white w-64 z-50 transition-all duration-300 ease-in-out flex flex-col
            ${isOpen ? 'right-0' : '-right-64'}
            md:right-0 md:static shadow-xl
        `}>
            <div className="p-6 flex items-center justify-center border-b border-slate-800 shrink-0">
                <div className="bg-primary p-2 rounded-lg ml-3">
                    <Baby size={32} className="text-white" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-wider">طيبة سنتر</h1>
                    <p className="text-xs text-slate-400">ملابس أطفال</p>
                </div>
            </div>

            <nav className="mt-6 px-4 space-y-2 flex-1 overflow-y-auto" aria-label="القائمة الرئيسية">
                {menuItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = currentPage === item.id;
                    return (
                        <button
                            key={item.id}
                            onClick={() => {
                                setPage(item.id);
                                if (window.innerWidth < 768) setIsOpen(false);
                            }}
                            className={`
                                w-full flex items-center space-x-3 space-x-reverse px-4 py-3 rounded-lg transition-all duration-200
                                ${isActive 
                                    ? 'bg-primary text-white shadow-lg shadow-primary/30' 
                                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                                }
                            `}
                            aria-label={item.label}
                        >
                            <Icon size={20} />
                            <span className="font-medium">{item.label}</span>
                        </button>
                    );
                })}
            </nav>

            {canAccessSettings && (
                <div className="p-4 border-t border-slate-800 shrink-0">
                    <button 
                        onClick={() => {
                            setPage('settings');
                            if (window.innerWidth < 768) setIsOpen(false);
                        }}
                        className={`flex items-center space-x-3 space-x-reverse px-4 py-3 w-full rounded-lg transition-colors
                            ${currentPage === 'settings' ? 'text-white bg-slate-800' : 'text-slate-400 hover:text-white hover:bg-slate-800'}
                        `}
                        aria-label="الإعدادات"
                    >
                        <Settings size={20} />
                        <span>الإعدادات</span>
                    </button>
                </div>
            )}
        </aside>
    </>
  );
};

export default Sidebar;
