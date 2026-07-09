
import React, { useState, useEffect } from 'react';
import { Sale, Employee, SaleType, PaymentMethod } from '../types';
import { DataService } from '../services/dataService';
import { printReceipt } from '../utils/printUtils';
import { Search, FileText, Trash2, Eye, Calendar, X, Edit2, UserCheck, History, Printer, RotateCcw, Clock, CheckCircle } from 'lucide-react';

interface InvoicesProps {
    currentUser: Employee | null;
    onEditInvoice: (sale: Sale) => void;
}

const Invoices: React.FC<InvoicesProps> = ({ currentUser, onEditInvoice }) => {
  const [sales, setSales] = useState<Sale[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [filterType, setFilterType] = useState<'ALL' | 'DEBT' | 'PAID_DEBT'>('ALL');

  const canModify = currentUser?.permissions.includes('settings') || currentUser?.role === 'مدير';

  useEffect(() => {
    const unsub = DataService.subscribeToSales(data => {
        data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setSales(data);
    });
    return () => unsub();
  }, []);

  const handleOpenDetails = (sale: Sale) => {
    setSelectedSale(sale);
  };

  const handleDeleteSale = async (id: string) => {
    if (!canModify) return;
    if (window.confirm('تحذير: الحذف النهائي سيلغي الفاتورة ويعيد المخزون. هل أنت متأكد؟')) {
      await DataService.deleteSale(id);
      if (selectedSale?.id === id) setSelectedSale(null);
    }
  };

  const handleReturnSale = async (sale: Sale) => {
    if (sale.type === SaleType.RETURN) return;
    
    if (window.confirm('هل تريد استرجاع هذه الفاتورة بالكامل؟ سيتم إعادة البضاعة للمخزون وتسجيل عملية مرتجع.')) {
        await DataService.processReturn(sale, currentUser?.name || 'مجهول');
        setSelectedSale(null);
        alert('تمت عملية الاسترجاع بنجاح');
    }
  };

  const handleSettleDebt = async (sale: Sale) => {
    if (window.confirm(`هل تريد تأكيد سداد مبلغ ${sale.totalAmount} د.ل للعميل ${sale.customerName}؟`)) {
        await DataService.settleDebt(sale.id);
        setSelectedSale(null);
        alert("تم تسديد الدين بنجاح");
    }
  };


  const filteredSales = sales.filter(s => {
    const matchesSearch = s.id.includes(searchTerm) || s.customerName?.includes(searchTerm);
    if (!matchesSearch) return false;

    if (filterType === 'DEBT') {
        return s.paymentMethod === PaymentMethod.DEBT && !s.isPaid;
    }
    if (filterType === 'PAID_DEBT') {
        return s.paymentMethod === PaymentMethod.DEBT && s.isPaid;
    }
    return true;
  });

  return (
    <div className="p-6 h-[calc(100vh-64px)] overflow-hidden flex flex-col">
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">سجل الفواتير</h2>
          <p className="text-slate-500 text-sm">مراجعة المبيعات، المرتجعات، والديون</p>
        </div>
        
        <div className="flex bg-white p-1 rounded-lg border border-slate-200">
            <button 
                onClick={() => setFilterType('ALL')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${filterType === 'ALL' ? 'bg-slate-100 text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
                الكل
            </button>
            <button 
                onClick={() => setFilterType('DEBT')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${filterType === 'DEBT' ? 'bg-orange-100 text-orange-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
                ديون غير مدفوعة
            </button>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center gap-3 mb-6">
        <Search className="text-slate-400" size={20} />
        <input 
          type="text" 
          placeholder="بحث برقم الفاتورة أو اسم العميل..." 
          className="flex-1 outline-none text-slate-700 bg-transparent"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-auto bg-white rounded-xl shadow-sm border border-slate-100">
        <table className="w-full text-right">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr>
              <th className="p-4 text-slate-500 font-medium text-sm">الرقم</th>
              <th className="p-4 text-slate-500 font-medium text-sm">النوع</th>
              <th className="p-4 text-slate-500 font-medium text-sm">التاريخ</th>
              <th className="p-4 text-slate-500 font-medium text-sm">العميل</th>
              <th className="p-4 text-slate-500 font-medium text-sm">حالة الدفع</th>
              <th className="p-4 text-slate-500 font-medium text-sm">المبلغ</th>
              <th className="p-4 text-slate-500 font-medium text-sm">الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredSales.map(sale => (
              <tr key={sale.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="p-4 font-mono text-slate-600">#{sale.id}</td>
                <td className="p-4">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${sale.type === SaleType.RETURN ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {sale.type === SaleType.RETURN ? 'مرتجع' : 'بيع'}
                    </span>
                </td>
                <td className="p-4 text-slate-600 flex items-center gap-2">
                    <div className="flex flex-col">
                        <span>{new Date(sale.date).toLocaleDateString('ar-LY')}</span>
                        <span className="text-[10px] text-slate-400">{new Date(sale.date).toLocaleTimeString('ar-LY')}</span>
                    </div>
                </td>
                <td className="p-4 text-sm text-slate-600">
                    {sale.customerName || '-'}
                </td>
                <td className="p-4 text-sm">
                    {sale.paymentMethod === PaymentMethod.DEBT ? (
                        sale.isPaid ? (
                            <span className="flex items-center gap-1 text-green-600 font-bold text-xs bg-green-50 px-2 py-1 rounded-full w-fit">
                                <CheckCircle size={12} /> دين مسدد
                            </span>
                        ) : (
                            <div className="flex flex-col">
                                <span className="flex items-center gap-1 text-orange-600 font-bold text-xs bg-orange-50 px-2 py-1 rounded-full w-fit mb-1">
                                    <Clock size={12} /> دين آجل
                                </span>
                                <span className="text-[10px] text-slate-400">
                                    استحقاق: {sale.dueDate?.split('T')[0]}
                                </span>
                            </div>
                        )
                    ) : (
                        <span className="text-slate-500">{sale.paymentMethod}</span>
                    )}
                </td>
                <td className={`p-4 font-bold ${sale.totalAmount < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                    {sale.totalAmount} د.ل
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    {sale.paymentMethod === PaymentMethod.DEBT && !sale.isPaid && (
                        <button 
                            onClick={() => handleSettleDebt(sale)}
                            className="bg-green-600 hover:bg-green-700 text-white p-2 rounded-lg text-xs"
                            title="تسديد الدين"
                        >
                            سداد
                        </button>
                    )}
                    <button onClick={() => handleOpenDetails(sale)} className="text-slate-500 hover:text-primary transition-colors p-2 bg-slate-50 rounded-lg">
                        <Eye size={18} />
                    </button>
                    <button onClick={() => printReceipt(sale)} className="text-slate-500 hover:text-slate-800 transition-colors p-2 bg-slate-50 rounded-lg">
                        <Printer size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedSale && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h3 className="text-xl font-bold text-slate-800">تفاصيل الفاتورة #{selectedSale.id}</h3>
                <button onClick={() => setSelectedSale(null)} className="text-slate-400 hover:text-red-500"><X size={24} /></button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
                {selectedSale.paymentMethod === PaymentMethod.DEBT && !selectedSale.isPaid && (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Clock className="text-orange-500" />
                            <div>
                                <h4 className="font-bold text-orange-800">هذه الفاتورة غير مدفوعة (دين)</h4>
                                <p className="text-sm text-orange-600">تاريخ الاستحقاق: {selectedSale.dueDate?.split('T')[0]}</p>
                            </div>
                        </div>
                        <button 
                            onClick={() => handleSettleDebt(selectedSale)}
                            className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg font-bold shadow-lg shadow-orange-200"
                        >
                            تسديد الآن
                        </button>
                    </div>
                )}

                <table className="w-full text-right mb-6">
                    <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                            <th className="py-2 px-3 text-xs text-slate-500">المنتج</th>
                            <th className="py-2 px-3 text-xs text-slate-500">الكمية</th>
                            <th className="py-2 px-3 text-xs text-slate-500">الإجمالي</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {selectedSale.items.map((item, idx) => (
                            <tr key={idx}>
                                <td className="py-3 px-3">
                                    <p className="font-bold text-slate-700 text-sm">{item.name}</p>
                                </td>
                                <td className="py-3 px-3 text-sm">{item.quantity}</td>
                                <td className="py-3 px-3 font-bold text-slate-800 text-sm">{item.sellingPrice * item.quantity} د.ل</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                {selectedSale.type === SaleType.SALE && (
                    <button 
                        onClick={() => handleReturnSale(selectedSale)}
                        className="px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition-colors flex items-center gap-2"
                    >
                        <RotateCcw size={18} /> استرجاع الفاتورة
                    </button>
                )}
                <button onClick={() => printReceipt(selectedSale)} className="px-4 py-2 bg-slate-800 text-white rounded-lg flex items-center gap-2">
                    <Printer size={18} /> طباعة
                </button>
                <button onClick={() => setSelectedSale(null)} className="px-4 py-2 bg-white border border-slate-300 rounded-lg">إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Invoices;
