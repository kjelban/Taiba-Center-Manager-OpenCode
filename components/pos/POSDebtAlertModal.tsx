import React from 'react';
import { AlertTriangle, Clock, X } from 'lucide-react';
import { Customer, Sale } from '../../types';

interface POSDebtAlertModalProps {
    isOpen: boolean;
    onClose: () => void;
    customer: Customer | null;
    unpaidInvoices: Sale[];
}

const POSDebtAlertModal: React.FC<POSDebtAlertModalProps> = ({
    isOpen,
    onClose,
    customer,
    unpaidInvoices
}) => {
    if (!isOpen || !customer || unpaidInvoices.length === 0) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden relative shadow-2xl border border-rose-100 flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="p-4 border-b border-rose-100 flex justify-between items-center bg-rose-50/50">
                    <div className="flex items-center gap-2 text-rose-800">
                        <AlertTriangle className="text-rose-600 animate-pulse" size={24} />
                        <h3 className="font-bold text-lg">تنبيه: مستحقات معلقة على العميل</h3>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-red-500 p-1.5 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer">
                        <X size={24} />
                    </button>
                </div>
                {/* Content */}
                <div className="p-6 overflow-y-auto space-y-4 text-right" dir="rtl">
                    <div className="bg-rose-50 border border-rose-100 rounded-xl p-4 text-rose-900 text-sm">
                        العميل <span className="font-extrabold text-rose-700">{customer.name}</span> لديه <span className="font-bold text-rose-700">{unpaidInvoices.length}</span> فواتير آجلة لم يتم تصفيتها بعد بمجموع دين يبلغ <span className="font-extrabold text-rose-700 text-base">{unpaidInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0)} د.ل</span>.
                    </div>
                    <div className="space-y-3">
                        <h4 className="font-bold text-sm text-slate-700">قائمة الفواتير المستحقة:</h4>
                        <div className="border border-slate-100 rounded-xl overflow-hidden divide-y divide-slate-100 bg-slate-50">
                            {unpaidInvoices.map((inv) => (
                                <div key={inv.id} className="p-3 bg-white hover:bg-slate-50/50 flex flex-col sm:flex-row justify-between sm:items-center gap-2 transition-colors">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-mono font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">رقم {inv.id}</span>
                                            <span className="text-xs text-slate-400">{new Date(inv.date).toLocaleDateString('ar-LY')}</span>
                                        </div>
                                        <div className="text-xs text-slate-500 flex items-center gap-1.5">
                                            <Clock size={12} className="text-orange-500" />
                                            <span>استحقاق: {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('ar-LY') : 'غير محدد'}</span>
                                            {inv.dueDate && new Date(inv.dueDate) < new Date() && (
                                                <span className="text-rose-600 font-bold bg-rose-50 px-1.5 py-0.5 rounded-full text-[10px] animate-pulse">متأخرة!</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between sm:justify-end gap-3">
                                        <span className="text-sm font-extrabold text-rose-600 font-mono">{inv.totalAmount} د.ل</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                {/* Footer */}
                <div className="p-4 border-t border-slate-100 bg-slate-50 flex gap-2 justify-end">
                    <button 
                        type="button"
                        onClick={onClose} 
                        className="bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm py-2 px-6 rounded-xl shadow transition-colors cursor-pointer"
                    >
                        حسناً، فهمت
                    </button>
                </div>
            </div>
        </div>
    );
};

export default POSDebtAlertModal;
