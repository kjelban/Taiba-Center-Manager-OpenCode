import React, { useEffect, useState } from 'react';
import { Employee } from '../types';
import { DataService } from '../services/dataService';
import { setServerSessionToken } from '../services/base';
import { Baby, LogIn, Mail, Lock } from 'lucide-react';

interface UserLoginProps {
  onLogin: (employee: Employee) => void;
}

const UserLogin: React.FC<UserLoginProps> = ({ onLogin }) => {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [hasEmployees, setHasEmployees] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    fetch('/api/admin/has-employees')
      .then(r => r.json())
      .then(data => {
        setHasEmployees(data.hasEmployees);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError('تعذر الاتصال بقاعدة البيانات. الرجاء المحاولة مرة أخرى.');
        setLoading(false);
      });
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!hasEmployees) {
        // Bootstrap: first-time setup
        if (!email) {
          setError('يرجى إدخال البريد الإلكتروني');
          setLoading(false);
          return;
        }
        if (!password) {
          setError('يرجى إدخال كلمة المرور الإدارية');
          setLoading(false);
          return;
        }

        const bootstrapResp = await fetch('/api/admin/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, googleUid: null }),
        });
        const bootstrapData = await bootstrapResp.json();
        if (!bootstrapResp.ok) {
          setError(bootstrapData.error || 'فشل إنشاء حساب المدير');
          setLoading(false);
          return;
        }

        // Now login with the newly created account
        const loginResp = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const loginData = await loginResp.json();
        if (!loginResp.ok) {
          setError(loginData.error || 'فشل تسجيل الدخول');
          setLoading(false);
          return;
        }

        setServerSessionToken(loginData.sessionToken);
        onLogin(loginData.employee);
        return;
      }

      // Normal login
      if (!email) {
        setError('يرجى إدخال البريد الإلكتروني');
        setLoading(false);
        return;
      }
      if (!password) {
        setError('يرجى إدخال كلمة المرور');
        setLoading(false);
        return;
      }

      const loginResp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const loginData = await loginResp.json();
      if (!loginResp.ok) {
        setError(loginData.error || 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
        setLoading(false);
        return;
      }

      setServerSessionToken(loginData.sessionToken);
      onLogin(loginData.employee);
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'حدث خطأ أثناء تسجيل الدخول');
      setLoading(false);
    }
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

            {!hasEmployees && !loading && (
                <div className="w-full bg-blue-50 text-blue-800 p-4 rounded-xl mb-6 text-center text-sm border border-blue-100">
                    إعداد أولي: أدخل البريد الإلكتروني وكلمة المرور الإدارية لإنشاء حساب المدير الأول.
                </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">البريد الإلكتروني</label>
                    <div className="relative">
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                            dir="ltr"
                            placeholder="user@taiba.com"
                        />
                        <Mail size={18} className="absolute left-4 top-3.5 text-slate-400" />
                    </div>
                </div>

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
