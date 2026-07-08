
import React, { useState, useEffect } from 'react';
import { Customer } from '../types';
import { DataService } from '../services/dataService';
import { Plus, Search, Trash2, Edit2, Phone, User, ShoppingBag, AlertTriangle } from 'lucide-react';

const Customers: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  
  const [formData, setFormData] = useState<Partial<Customer>>({
    name: '',
    phone: '',
    notes: ''
  });

  useEffect(() => {
    const unsub = DataService.subscribeToCustomers(setCustomers);
    return () => unsub();
  }, []);

  const handleOpenModal = (customer?: Customer) => {
    if (customer) {
      setEditingCustomer(customer);
      setFormData({
        name: customer.name,
        phone: customer.phone,
        notes: customer.notes
      });
    } else {
      setEditingCustomer(null);
      setFormData({ name: '', phone: '', notes: '' });
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = editingCustomer ? editingCustomer.id : Date.now().toString();
    const customerToSave: Customer = {
        id: id,
        name: formData.name!,
        phone: formData.phone || '',
        notes: formData.notes || '',
        totalPurchases: editingCustomer ? editingCustomer.totalPurchases : 0,
        totalDebt: editingCustomer ? editingCustomer.totalDebt : 0,
        lastPurchaseDate: editingCustomer ? editingCustomer.lastPurchaseDate : undefined
    };

    await DataService.saveCustomer(customerToSave);
    setIsModalOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('هل أنت متأكد من حذف هذا العميل؟')) {
      await DataService.deleteCustomer(id);
    }
  };

  const filteredCustomers = customers.filter(c => 
    c.name.includes(searchTerm) || c.phone.includes(searchTerm)
  );

  return (
    <div className="p-6 h-[calc(100vh-64px)] overflow-hidden flex flex-col">
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <div>
            <h2 className="text-2xl font-bold text-slate-800">إدارة العملاء</h2>
            <p className="text-slate-500 text-sm">سجل بيانات الزبائن ومتابعة مشترياتهم</p>
        </div>
        <button 
          onClick={() => handleOpenModal()}
          className="bg-primary hover:bg-secondary text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
        >
          <Plus size={18} />
          <span>إضافة عميل جديد</span>
        </button>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center gap-3 mb-6">
        <Search className="text-slate-400" size={20} />
        <input 
          type="text" 
          placeholder="بحث بالاسم أو رقم الهاتف..." 
          className="flex-1 outline-none text-slate-700 bg-transparent"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-auto bg-white rounded-xl shadow-sm border border-slate-100">
        <table className="w-full text-right">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr>
              <th className="p-4 text-slate-500 font-medium text-sm">الاسم</th>
              <th className="p-4 text-slate-500 font-medium text-sm">رقم الهاتف</th>
              <th className="p-4 text-slate-500 font-medium text-sm">إجمالي المشتريات</th>
              <th className="p-4 text-slate-500 font-medium text-sm">إجمالي الديون</th>
              <th className="p-4 text-slate-500 font-medium text-sm">آخر زيارة</th>
              <th className="p-4 text-slate-500 font-medium text-sm">ملاحظات</th>
              <th className="p-4 text-slate-500 font-medium text-sm">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredCustomers.map(customer => (
              <tr key={customer.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="p-4 font-medium text-slate-800 flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                        <User size={16} />
                    </div>
                    {customer.name}
                </td>
                <td className="p-4 text-slate-600 dir-ltr text-right">
                    {customer.phone || '-'}
                </td>
                <td className="p-4 font-bold text-primary">
                    {customer.totalPurchases.toLocaleString()} د.ل
                </td>
                <td className="p-4 font-bold">
                    {customer.totalDebt > 0 ? (
                        <span className="text-red-600 flex items-center gap-1">
                             {customer.totalDebt.toLocaleString()} د.ل
                             <AlertTriangle size={14} />
                        </span>
                    ) : (
                        <span className="text-slate-400">-</span>
                    )}
                </td>
                <td className="p-4 text-slate-500 text-sm">
                    {customer.lastPurchaseDate ? new Date(customer.lastPurchaseDate).toLocaleDateString('ar-LY') : '-'}
                </td>
                <td className="p-4 text-slate-500 text-sm truncate max-w-xs">{customer.notes}</td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <button 
                        onClick={() => handleOpenModal(customer)}
                        className="text-slate-400 hover:text-blue-500 transition-colors p-1"
                    >
                        <Edit2 size={18} />
                    </button>
                    <button 
                        onClick={() => handleDelete(customer.id)}
                        className="text-slate-400 hover:text-red-500 transition-colors p-1"
                    >
                        <Trash2 size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredCustomers.length === 0 && (
                <tr>
                    <td colSpan={7} className="p-12 text-center text-slate-400">لا يوجد عملاء مطابقين للبحث</td>
                </tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <form onSubmit={handleSave} className="p-6">
              <h3 className="text-xl font-bold mb-6 text-slate-800">
                {editingCustomer ? 'تعديل بيانات العميل' : 'إضافة عميل جديد'}
              </h3>
              
              <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">اسم العميل</label>
                    <div className="relative">
                        <input required type="text" className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none pl-10" 
                            value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                        <User size={18} className="absolute left-3 top-3 text-slate-400" />
                    </div>
                </div>
                
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">رقم الهاتف</label>
                    <div className="relative">
                        <input type="text" className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none pl-10" 
                            value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                        <Phone size={18} className="absolute left-3 top-3 text-slate-400" />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">ملاحظات</label>
                    <textarea className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none h-24 resize-none" 
                        value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} />
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
                    حفظ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Customers;
