import React from 'react';
import { Check, Printer, RotateCcw } from 'lucide-react';
import { Sale } from '../../types';

interface InvoiceModalProps {
    sale: Sale | null;
    onClose: () => void;
    onPrint: (sale: Sale) => void;
}

const InvoiceModal: React.FC<InvoiceModalProps> = ({ sale, onClose, onPrint }) => {
    if (!sale) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden relative shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
                <div className="p-6 text-center border-b border-slate-100 flex-1">
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600 shadow-inner">
                        <Check size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-slate-800 mb-2">تمت العملية بنجاح!</h3>
                    <p className="text-slate-500 mb-2 text-sm">تم تسجيل الفاتورة في النظام</p>
                    <div className="bg-slate-50 p-4 rounded-xl inline-block w-full border border-slate-100 shadow-sm mt-2">
                        <span className="block text-xs text-slate-400 mb-1">الإجمالي</span>
                        <span className="text-2xl font-black text-primary font-mono">{sale.totalAmount} د.ل</span>
                    </div>
                </div>
                <div className="p-4 bg-slate-50 flex gap-3 border-t border-slate-200">
                    <button 
                        autoFocus
                        onClick={() => onPrint(sale)} 
                        className="flex-1 bg-primary hover:bg-primary/90 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-primary/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                        <Printer size={20} />
                        طباعة الإيصال
                    </button>
                    <button 
                        onClick={onClose} 
                        className="flex-1 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-bold py-3 px-4 rounded-xl shadow-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                        <RotateCcw size={20} />
                        فاتورة جديدة
                    </button>
                </div>
            </div>
        </div>
    );
};

export default InvoiceModal;
