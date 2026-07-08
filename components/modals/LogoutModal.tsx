import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface LogoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

const LogoutModal: React.FC<LogoutModalProps> = ({ isOpen, onClose, onConfirm }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="p-6 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600">
            <AlertTriangle size={32} />
          </div>
          <h3 className="text-xl font-bold text-slate-800 mb-2">إنهاء الدوام؟</h3>
          <p className="text-slate-500 mb-6 text-sm">
            سيتم تسجيل وقت الخروج وإغلاق الجلسة الحالية. هل أنت متأكد؟
          </p>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 font-medium transition-colors"
            >
              إلغاء
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 font-medium shadow-lg shadow-red-200 transition-colors"
            >
              تأكيد الخروج
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LogoutModal;
