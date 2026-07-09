import React, { useState, useEffect } from 'react';
import { Expense } from '../types';
import { DataService } from '../services/dataService';
import { Plus, Trash2, Wallet, Calendar, DollarSign } from 'lucide-react';

const Expenses: React.FC = () => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<Expense>>({
    category: 'مصروفات عامة',
    amount: 0,
    description: '',
    date: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    const unsub = DataService.subscribeToExpenses(data => {
        data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setExpenses(data);
    });
    return () => unsub();
  }, []);

  const handleDelete = async (id: string) => {
    if (window.confirm('هل أنت متأكد من حذف هذا المصروف؟')) {
      await DataService.deleteExpense(id);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const newExpense: Expense = {
      id: crypto.randomUUID(),
      category: formData.category || 'مصروفات عامة',
      amount: Number(formData.amount),
      description: formData.description!,
      date: new Date(formData.date!).toISOString()
    };
    
    await DataService.addExpense(newExpense);
    setIsModalOpen(false);
    setFormData({
      category: 'مصروفات عامة',
      amount: 0,
      description: '',
      date: new Date().toISOString().split('T')[0]
    });
  };

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="p-6 h-[calc(100vh-64px)] overflow-hidden flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">سجل المصاريف</h2>
          <p className="text-slate-500 text-sm">تتبع نفقات المتجر التشغيلية</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-primary hover:bg-secondary text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-primary/30"
        >
          <Plus size={18} />
          <span>تسجيل مصروف جديد</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center justify-between">
            <div>
                <p className="text-slate-500 text-sm font-medium mb-1">إجمالي المصاريف</p>
                <h3 className="text-2xl font-bold text-slate-800">{totalExpenses.toLocaleString()} د.ل</h3>
            </div>
            <div className="bg-orange-100 p-3 rounded-full text-orange-600">
                <Wallet size={24} />
            </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-white rounded-xl shadow-sm border border-slate-100">
        <table className="w-full text-right">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr>
              <th className="p-4 text-slate-500 font-medium text-sm">التاريخ</th>
              <th className="p-4 text-slate-500 font-medium text-sm">نوع المصروف</th>
              <th className="p-4 text-slate-500 font-medium text-sm">التفاصيل</th>
              <th className="p-4 text-slate-500 font-medium text-sm">المبلغ</th>
              <th className="p-4 text-slate-500 font-medium text-sm">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {expenses.map(expense => (
              <tr key={expense.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="p-4 text-slate-600 flex items-center gap-2">
                    <Calendar size={14} className="text-slate-400" />
                    {new Date(expense.date).toLocaleDateString('ar-LY')}
                </td>
                <td className="p-4 font-medium text-slate-800">
                    <span className="bg-slate-100 px-2 py-1 rounded text-xs">{expense.category}</span>
                </td>
                <td className="p-4 text-slate-600">{expense.description}</td>
                <td className="p-4 font-bold text-red-600">-{expense.amount} د.ل</td>
                <td className="p-4">
                  <button 
                    onClick={() => handleDelete(expense.id)}
                    className="text-slate-400 hover:text-red-500 transition-colors p-1"
                  >
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            ))}
            {expenses.length === 0 && (
                <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-400">لا توجد مصاريف مسجلة</td>
                </tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <form onSubmit={handleSave} className="p-6">
              <h3 className="text-xl font-bold mb-6 text-slate-800">تسجيل مصروف جديد</h3>
              
              <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">نوع المصروف</label>
                    <select 
                        className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none"
                        value={formData.category}
                        onChange={e => setFormData({...formData, category: e.target.value})}
                    >
                        <option value="إيجار">إيجار</option>
                        <option value="كهرباء">كهرباء</option>
                        <option value="صيانة">صيانة</option>
                        <option value="رواتب">رواتب (خارج النظام)</option>
                        <option value="نقل">نقل ومواصلات</option>
                        <option value="تسويق">تسويق</option>
                        <option value="معدات">معدات</option>
                        <option value="مصروفات عامة">مصروفات عامة</option>
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">المبلغ (د.ل)</label>
                    <div className="relative">
                        <input 
                            required 
                            type="number" 
                            className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none pl-10"
                            value={formData.amount}
                            onChange={e => setFormData({...formData, amount: Number(e.target.value)})}
                        />
                        <DollarSign className="absolute left-3 top-3 text-slate-400" size={16} />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">التاريخ</label>
                    <input 
                        required 
                        type="date" 
                        className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none"
                        value={formData.date}
                        onChange={e => setFormData({...formData, date: e.target.value})}
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">التفاصيل (اختياري)</label>
                    <textarea 
                        className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none h-24 resize-none"
                        placeholder="أضف وصفاً للمصروف..."
                        value={formData.description}
                        onChange={e => setFormData({...formData, description: e.target.value})}
                    />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-6 mt-2 border-t border-slate-100">
                <button 
                    type="button" 
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-50 font-medium"
                >
                    إلغاء
                </button>
                <button 
                    type="submit" 
                    className="px-6 py-2 rounded-lg bg-primary hover:bg-secondary text-white font-medium shadow-lg shadow-primary/30"
                >
                    حفظ المصروف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Expenses;