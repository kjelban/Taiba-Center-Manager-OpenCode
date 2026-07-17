import React, { useState } from 'react';
import { BellRing, Calendar as CalendarIcon, X } from 'lucide-react';
import { Sale } from '../../types';

interface DebtAlertModalProps {
  isOpen: boolean;
  overdueSales: Sale[];
  onSettleDebt: (saleId: string) => Promise<void>;
  onRescheduleDebt: (saleId: string, newDate: string) => Promise<void>;
  onSnooze: (durationMins: number) => void;
}

const DebtAlertModal: React.FC<DebtAlertModalProps> = ({
  isOpen,
  overdueSales,
  onSettleDebt,
  onRescheduleDebt,
  onSnooze,
}) => {
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [snoozeDuration, setSnoozeDuration] = useState<number>(30);

  if (!isOpen) return null;

  const handleSnooze = () => {
    onSnooze(snoozeDuration);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in slide-in-from-bottom-5" role="alertdialog" aria-modal="true">
        <div className="p-5 bg-red-50 border-b border-red-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-full text-red-600">
              <BellRing className="animate-pulse" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-red-900">تنبيه ديون مستحقة!</h3>
              <p className="text-xs text-red-600">حان موعد سداد الديون التالية</p>
            </div>
          </div>
          <button onClick={handleSnooze} className="text-red-400 hover:text-red-700">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
          {overdueSales.map((sale) => (
            <div key={sale.id} className="border border-slate-200 rounded-xl p-3 shadow-sm hover:border-red-200 transition-colors">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h4 className="font-bold text-slate-800">{sale.customerName}</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    فاتورة #{sale.id} | الاستحقاق: <span className="text-red-600 font-bold">{sale.dueDate?.split('T')[0]}</span>
                  </p>
                </div>
                <div className="text-lg font-bold text-slate-800">{sale.totalAmount} د.ل</div>
              </div>
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-50">
                {rescheduleId === sale.id ? (
                  <div className="flex-1 flex items-center gap-2 animate-in fade-in">
                    <div className="relative flex-1 h-8 group">
                      <div className="absolute inset-0 w-full h-full border border-slate-300 rounded px-2 flex items-center bg-white group-hover:border-blue-500 transition-colors">
                        <CalendarIcon size={16} className="absolute right-2 text-slate-400 group-hover:text-blue-500" />
                        <span className="text-xs text-slate-400 pr-8">اختر تاريخ جديد</span>
                      </div>
                      <input
                        type="date"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        onChange={(e) => onRescheduleDebt(sale.id, e.target.value)}
                        min={new Date().toISOString().split('T')[0]}
                        onClick={(e) => {
                          try {
                            e.currentTarget.showPicker();
                          } catch (err) {}
                        }}
                      />
                    </div>
                    <button onClick={() => setRescheduleId(null)} className="text-slate-400 hover:text-slate-600">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => onSettleDebt(sale.id)}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    >
                      تسديد الآن
                    </button>
                    <button
                      onClick={() => setRescheduleId(sale.id)}
                      className="flex items-center justify-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      title="تمديد موعد الدين"
                    >
                      <CalendarIcon size={14} />
                      تمديد
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 bg-slate-50 border-t border-slate-200">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600 whitespace-nowrap">تذكيري بعد:</span>
            <select
              className="flex-1 bg-white border border-slate-300 rounded-lg py-2 px-3 text-sm outline-none focus:border-primary"
              value={snoozeDuration}
              onChange={(e) => setSnoozeDuration(Number(e.target.value))}
            >
              <option value={15}>15 دقيقة</option>
              <option value={30}>30 دقيقة</option>
              <option value={60}>1 ساعة</option>
              <option value={120}>2 ساعة</option>
              <option value={1440}>يوم كامل (غداً)</option>
            </select>
            <button
              onClick={handleSnooze}
              className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 transition-colors"
            >
              تأكيد الغفوة
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DebtAlertModal;
