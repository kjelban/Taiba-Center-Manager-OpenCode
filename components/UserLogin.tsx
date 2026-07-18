import React, { useEffect, useState } from 'react';
import { Employee } from '../types';
import { DataService } from '../services/dataService';
import { AuthService } from '../services/authService';
import { Baby, LogIn, Lock } from 'lucide-react';

interface UserLoginProps {
  onLogin: (employee: Employee) => void;
}

const UserLogin: React.FC<UserLoginProps> = ({ onLogin }) => {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [hasEmployees, setHasEmployees] = useState(false);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [bootstrapPassword, setBootstrapPassword] = useState('');
  const [bootstrapEmail, setBootstrapEmail] = useState('');
  const [googleUser, setGoogleUser] = useState<{ uid: string; email: string } | null>(null);

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

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      const user = await AuthService.signInWithGoogle();
      const email = user.email || '';
      const uid = user.uid;

      if (!hasEmployees) {
        setGoogleUser({ uid, email });
        setBootstrapEmail(email);
        setNeedsBootstrap(true);
        setLoading(false);
        return;
      }

      const employees = await DataService.getEmployees();
      const employee = employees.find(e => e.email === email);
      if (!employee) {
        await AuthService.signOut();
        setError('الحساب غير موجود في النظام. يرجى التواصل مع المسؤول.');
        setLoading(false);
        return;
      }

      onLogin(employee);
    } catch (err: any) {
      console.error('Login error:', err);
      if (err.code === 'auth/popup-closed-by-user') {
        setError('تم إلغاء تسجيل الدخول');
      } else if (err.code === 'auth/cancelled-popup-request') {
        setError('تم إلغاء العملية');
      } else {
        setError(err.message || 'حدث خطأ أثناء تسجيل الدخول بحساب Google');
      }
      setLoading(false);
    }
  };

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!bootstrapEmail) {
        setError('يرجى إدخال البريد الإلكتروني');
        setLoading(false);
        return;
      }
      if (!bootstrapPassword) {
        setError('يرجى إدخال كلمة المرور الإدارية');
        setLoading(false);
        return;
      }

      const bootstrapResp = await fetch('/api/admin/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: bootstrapEmail, password: bootstrapPassword, googleUid: googleUser?.uid }),
      });
      const bootstrapData = await bootstrapResp.json();
      if (!bootstrapResp.ok) {
        setError(bootstrapData.error || 'فشل إنشاء حساب المدير');
        setLoading(false);
        return;
      }

      onLogin(bootstrapData.employee);
    } catch (err: any) {
      console.error('Bootstrap error:', err);
      setError(err.message || 'حدث خطأ أثناء الإعداد الأولي');
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

            {!needsBootstrap && !loading && (
                <>
                    {!hasEmployees && (
                        <div className="w-full bg-blue-50 text-blue-800 p-4 rounded-xl mb-6 text-center text-sm border border-blue-100">
                            إعداد أولي: سجّل الدخول بحساب Google أولاً، ثم أدخل كلمة المرور الإدارية لإنشاء حساب المدير الأول.
                        </div>
                    )}

                    <button
                        onClick={handleGoogleSignIn}
                        disabled={loading}
                        className="w-full flex items-center justify-center gap-3 bg-white border-2 border-slate-200 hover:border-slate-300 text-slate-700 py-3.5 rounded-xl font-bold text-lg transition-all active:scale-[0.98] disabled:opacity-70"
                    >
                        {loading ? (
                            <div className="w-6 h-6 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                            <>
                                <svg className="w-6 h-6" viewBox="0 0 24 24">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                                </svg>
                                الدخول بحساب Google
                                <LogIn size={20} />
                            </>
                        )}
                    </button>
                </>
            )}

            {needsBootstrap && (
                <form onSubmit={handleBootstrap} className="space-y-4">
                    <div className="w-full bg-green-50 text-green-800 p-4 rounded-xl mb-2 text-center text-sm border border-green-100">
                        تم تسجيل الدخول بحساب Google: <strong>{bootstrapEmail}</strong>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">البريد الإلكتروني للمدير</label>
                        <input
                            type="email"
                            required
                            value={bootstrapEmail}
                            onChange={e => setBootstrapEmail(e.target.value)}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                            dir="ltr"
                            placeholder="admin@taiba.com"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">كلمة المرور الإدارية</label>
                        <div className="relative">
                            <input
                                type="password"
                                required
                                value={bootstrapPassword}
                                onChange={e => setBootstrapPassword(e.target.value)}
                                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                                dir="ltr"
                                placeholder="كلمة المرور الإدارية"
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
                                إنشاء حساب المدير
                                <LogIn size={20} />
                            </>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={async () => {
                            setNeedsBootstrap(false);
                            setGoogleUser(null);
                            setBootstrapEmail('');
                            setBootstrapPassword('');
                            await AuthService.signOut();
                        }}
                        className="w-full text-slate-500 hover:text-slate-700 py-2 text-sm transition-all"
                    >
                        العودة
                    </button>
                </form>
            )}
        </div>
      </div>
    </div>
  );
};

export default UserLogin;
