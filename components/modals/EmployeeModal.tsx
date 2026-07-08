import React from 'react';
import { Lock, Shield } from 'lucide-react';
import { Employee, EmployeeType } from '../../types';

interface EmployeeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (e: React.FormEvent) => void;
    editingId: string | null;
    formData: Partial<Employee>;
    setFormData: (data: Partial<Employee>) => void;
    availablePermissions: { id: string, label: string }[];
    togglePermission: (id: string) => void;
}

const EmployeeModal: React.FC<EmployeeModalProps> = ({
    isOpen,
    onClose,
    onSave,
    editingId,
    formData,
    setFormData,
    availablePermissions,
    togglePermission
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
                <form onSubmit={onSave} className="p-6">
                    <h3 className="text-xl font-bold mb-6 text-slate-800">
                        {editingId ? 'تعديل بيانات المستخدم' : 'إضافة مستخدم جديد'}
                    </h3>
                    
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">اسم المستخدم</label>
                            <input 
                                required 
                                type="text" 
                                className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none"
                                value={formData.name || ''}
                                onChange={e => setFormData({...formData, name: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">البريد الإلكتروني</label>
                            <input 
                                required
                                type="email"
                                className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none"
                                placeholder="مثال: user@taiba.com"
                                value={formData.email || ''}
                                onChange={e => setFormData({...formData, email: e.target.value})}
                                dir="ltr"
                            />
                        </div>
                        
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">{editingId ? 'تغيير كلمة المرور' : 'كلمة المرور'}</label>
                            <div className="relative">
                                <input 
                                    required={!editingId}
                                    type="text"
                                    className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none pl-10"
                                    placeholder={editingId ? "اتركها فارغة لعدم التغيير" : "أدخل كلمة المرور (6 أحرف على الأقل)"}
                                    value={formData.password || ''}
                                    onChange={e => setFormData({...formData, password: e.target.value})}
                                    dir="ltr"
                                />
                                <Lock size={16} className="absolute left-3 top-3 text-slate-400" />
                            </div>
                            <p className="text-xs text-slate-500 mt-1">يتم استخدامها لتسجيل دخول الموظف، ويجب ألا تقل عن 6 أحرف.</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">المسمى الوظيفي</label>
                            <input 
                                required 
                                type="text" 
                                className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none"
                                placeholder="مثال: كاشير، بائع، مدير"
                                value={formData.role || ''}
                                onChange={e => setFormData({...formData, role: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">نوع الدوام</label>
                            <select 
                                className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none"
                                value={formData.type || EmployeeType.FULL_TIME}
                                onChange={e => setFormData({...formData, type: e.target.value as EmployeeType})}
                            >
                                <option value={EmployeeType.FULL_TIME}>{EmployeeType.FULL_TIME}</option>
                                <option value={EmployeeType.PART_TIME}>{EmployeeType.PART_TIME}</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">الراتب الشهري (د.ل)</label>
                            <input 
                                required 
                                type="number" 
                                className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none"
                                value={formData.salary || ''}
                                onChange={e => setFormData({...formData, salary: Number(e.target.value)})}
                            />
                        </div>
                        
                        <div className="border-t border-slate-100 pt-4 mt-2">
                            <label className="block text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
                                <Shield size={16} className="text-primary" />
                                صلاحيات الوصول
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                                {availablePermissions.map(perm => (
                                    <label key={perm.id} className={`flex items-center gap-2 cursor-pointer p-2 rounded border transition-colors ${formData.permissions?.includes(perm.id as any) ? 'bg-primary/5 border-primary/30' : 'bg-white border-transparent hover:bg-slate-50'}`}>
                                        <input 
                                            type="checkbox" 
                                            className="w-4 h-4 text-primary rounded border-slate-300 focus:ring-primary"
                                            checked={formData.permissions?.includes(perm.id as any) || false}
                                            onChange={() => togglePermission(perm.id)}
                                        />
                                        <span className="text-sm text-slate-600">{perm.label}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex justify-end gap-3 pt-6 mt-2 border-t border-slate-100">
                        <button 
                            type="button" 
                            onClick={onClose} 
                            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                        >
                            إلغاء
                        </button>
                        <button 
                            type="submit" 
                            className="bg-primary hover:bg-primary/90 text-white px-6 py-2 rounded-lg font-bold shadow-md transition-colors cursor-pointer"
                        >
                            حفظ
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EmployeeModal;
