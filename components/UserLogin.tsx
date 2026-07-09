import React, { useEffect, useState } from 'react';
import { Employee } from '../types';
import { DataService } from '../services/dataService';
import { Baby, LogIn, User, Lock } from 'lucide-react';

interface UserLoginProps {
  onLogin: (employee: Employee) => void;
}

const UserLogin: React.FC<UserLoginProps> = ({ onLogin }) => {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedName, setSelectedName] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    DataService.getEmployees().then(data => {
        setEmployees(data);
        if (data.length > 0) setSelectedName(data[0].name);
        setLoading(false);
    }).catch(err => {
        console.error(err);
        setError('تعذر الاتصال بقاعدة البيانات. الرجاء المحاولة مرة أخرى.');
        setLoading(false);
    });
  }, []);

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    // Auto-create admin if no employees exist
    if (employees.length === 0) {
        const defaultPassword = import.meta.env.VITE_DEFAULT_ADMIN_PASSWORD || 'admin123';
        if (password !== defaultPassword) {
            setError(`كلمة المرور الافتراضية للمدير هي ${defaultPassword}`);
            setLoading(false);
            return;
        }
        const admin: Employee = {
            id: crypto.randomUUID(),
            name: 'المدير العام',
            email: 'admin@taiba.local',
            role: 'مدير',
            type: 'دوام كامل' as any,
            salary: 0,
            permissions: ['dashboard', 'pos', 'invoices', 'inventory', 'reports', 'expenses', 'employees', 'settings'],
            password: defaultPassword
        };
        try {
            await DataService.saveEmployee(admin);
            onLogin(admin);
        } catch (err: any) {
            setError('حدث خطأ أثناء إنشاء حساب المدير: ' + err.message);
            setLoading(false);
        }
        return;
    }

    const employee = employees.find(e => e.name === selectedName);
    if (!employee) {
        setError('يرجى اختيار الموظف');
        setLoading(false);
        return;
    }

    if (employee.password && employee.password !== password) {
        setError('كلمة المرور غير صحيحة');
        setLoading(false);
        return;
    }

    onLogin(employee);
  };

  return (
    <div className="fixed inset-0 bg-slate-900 flex items-center justify-center p-4 z-50">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden relative">
        <div className="bg-primary p-8 text-center">
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
                <Baby size={40} className="text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-1">طيبة سنتر</h1>
            <p className="text-primary-100">تسجيل الدخول للنظام</p>
        </div>
        
        <div className="p-8">
            {error && <div className="w-full bg-red-50 text-red-600 p-4 rounded-xl mb-6 text-center text-sm border border-red-100 leading-relaxed">{error}</div>}
            
            {employees.length === 0 && !loading && (
                <div className="w-full bg-blue-50 text-blue-800 p-4 rounded-xl mb-6 text-center text-sm border border-blue-100">
                    جاري إنشاء حساب المدير الافتراضي تلقائياً عند الدخول... (كلمة المرور الافتراضية: {(import.meta as any).env.VITE_DEFAULT_ADMIN_PASSWORD || 'admin123'})
                </div>
            )}
            
            <form onSubmit={handleLocalLogin} className="space-y-4">
                {employees.length > 0 && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">اسم المستخدم</label>
                        <div className="relative">
                            <select 
                                required
                                value={selectedName}
                                onChange={e => setSelectedName(e.target.value)}
                                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all appearance-none"
                                dir="rtl"
                            >
                                {employees.map(emp => (
                                    <option key={emp.id} value={emp.name}>{emp.name}</option>
                                ))}
                            </select>
                            <User size={18} className="absolute left-4 top-3.5 text-slate-400" />
                        </div>
                    </div>
                )}
                
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">كلمة المرور</label>
                    <div className="relative">
                        <input 
                            type="password"
                            required
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                            dir="ltr"
                            placeholder="كلمة المرور"
                        />
                        <Lock size={18} className="absolute left-4 top-3.5 text-slate-400" />
                    </div>
                </div>

                <button 
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-secondary text-white py-3.5 rounded-xl font-bold text-lg transition-all active:scale-[0.98] disabled:opacity-70 mt-6"
                >
                    {loading ? (
                        <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                        <>
                            الدخول للنظام
                            <LogIn size={20} />
                        </>
                    )}
                </button>
            </form>
        </div>
      </div>
    </div>
  );
};

export default UserLogin;
