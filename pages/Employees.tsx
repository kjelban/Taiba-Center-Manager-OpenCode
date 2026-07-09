
import React, { useState, useEffect } from 'react';
import { Employee, EmployeeType, Attendance } from '../types';
import { DataService } from '../services/dataService';
import EmployeeModal from '../components/modals/EmployeeModal';
import { Plus, Trash2, Users, User, Briefcase, Banknote, Clock, Calendar, Shield, Edit2, Lock } from 'lucide-react';

const Employees: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'users' | 'attendance'>('users');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<Attendance[]>([]);
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState<Partial<Employee>>({
    name: '',
    role: '',
    type: EmployeeType.FULL_TIME,
    salary: 0,
    permissions: ['pos'], // Default permission
    password: ''
  });

  const availablePermissions = [
    { id: 'dashboard', label: 'لوحة التحكم' },
    { id: 'pos', label: 'نقطة البيع' },
    { id: 'invoices', label: 'الفواتير' },
    { id: 'inventory', label: 'المخزون' },
    { id: 'reports', label: 'التقارير' },
    { id: 'expenses', label: 'المصاريف' },
    { id: 'employees', label: 'المستخدمين' },
    { id: 'settings', label: 'الإعدادات' },
  ];

  useEffect(() => {
    const unsubEmployees = DataService.subscribeToEmployees(setEmployees);
    const unsubAttendance = DataService.subscribeToAttendance(data => {
        data.sort((a, b) => new Date(b.checkInTime).getTime() - new Date(a.checkInTime).getTime());
        setAttendanceRecords(data);
    });

    return () => {
        unsubEmployees();
        unsubAttendance();
    };
  }, []);

  const handleDelete = async (id: string) => {
    if (window.confirm('هل أنت متأكد من حذف هذا المستخدم؟')) {
      await DataService.deleteEmployee(id);
    }
  };

  const handleOpenModal = (employee?: Employee) => {
    if (employee) {
        setEditingId(employee.id);
        setFormData({
            name: employee.name,
            role: employee.role,
            type: employee.type,
            salary: employee.salary,
            permissions: employee.permissions,
            password: '',
            email: employee.email || ''
        });
    } else {
        setEditingId(null);
        setFormData({
            name: '',
            role: '',
            type: EmployeeType.FULL_TIME,
            salary: 0,
            permissions: ['pos'],
            password: '',
            email: ''
        });
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
        let authId = editingId;
        
        if (editingId && formData.password && formData.password.trim().length > 0 && formData.password.length < 6) {
            alert('كلمة المرور يجب أن تكون 6 أحرف على الأقل.');
            return;
        }
        
        if (!editingId) {
            const password = (formData as any).password;
            if (!password || password.length < 6) {
                alert('يرجى إدخال كلمة مرور مكونة من 6 أحرف على الأقل.');
                return;
            }
            if (!formData.email) {
                alert('البريد الإلكتروني مطلوب.');
                return;
            }
            
            authId = crypto.randomUUID();
        }

        const employeeToSave: Employee = {
          id: authId!,
          name: formData.name!,
          email: formData.email!,
          role: formData.role!,
          type: formData.type!,
          salary: Number(formData.salary),
          permissions: formData.permissions || ['pos']
        };
        
        if (formData.password && formData.password.trim() !== '') {
            employeeToSave.password = formData.password;
        } else if (editingId && employees.find(e => e.id === editingId)?.password) {
            employeeToSave.password = employees.find(e => e.id === editingId)?.password;
        }
        
        await DataService.saveEmployee(employeeToSave);
        setIsModalOpen(false);
    } catch (err: any) {
        console.error(err);
        alert(err.message || 'حدث خطأ أثناء حفظ بيانات الموظف');
    }
  };

  const togglePermission = (permId: string) => {
    const currentPerms = formData.permissions || [];
    if (currentPerms.includes(permId)) {
        setFormData({ ...formData, permissions: currentPerms.filter(p => p !== permId) });
    } else {
        setFormData({ ...formData, permissions: [...currentPerms, permId] });
    }
  };

  const totalSalaries = employees.reduce((sum, e) => sum + e.salary, 0);

  // Format Duration helper
  const formatDuration = (mins?: number) => {
    if (!mins) return 'جاري العمل...';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}س ${m}د`;
  };

  return (
    <div className="p-6 h-[calc(100vh-64px)] overflow-hidden flex flex-col">
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">إدارة المستخدمين والدوام</h2>
          <p className="text-slate-500 text-sm">إدارة حسابات الموظفين ومتابعة ساعات العمل</p>
        </div>
        
        <div className="flex bg-white p-1 rounded-lg border border-slate-200">
            <button 
                onClick={() => setActiveTab('users')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'users' ? 'bg-slate-100 text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
                المستخدمين
            </button>
            <button 
                onClick={() => setActiveTab('attendance')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'attendance' ? 'bg-slate-100 text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
                سجل الدوام
            </button>
        </div>

        {activeTab === 'users' && (
            <button 
            onClick={() => handleOpenModal()}
            className="bg-primary hover:bg-secondary text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-primary/30"
            >
            <Plus size={18} />
            <span>إضافة مستخدم</span>
            </button>
        )}
      </div>

      {activeTab === 'users' ? (
        <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center justify-between">
                    <div>
                        <p className="text-slate-500 text-sm font-medium mb-1">عدد المستخدمين</p>
                        <h3 className="text-2xl font-bold text-slate-800">{employees.length}</h3>
                    </div>
                    <div className="bg-blue-100 p-3 rounded-full text-blue-600">
                        <Users size={24} />
                    </div>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center justify-between">
                    <div>
                        <p className="text-slate-500 text-sm font-medium mb-1">إجمالي الرواتب المتوقعة</p>
                        <h3 className="text-2xl font-bold text-slate-800">{totalSalaries.toLocaleString()} د.ل</h3>
                    </div>
                    <div className="bg-green-100 p-3 rounded-full text-green-600">
                        <Banknote size={24} />
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-auto bg-white rounded-xl shadow-sm border border-slate-100">
                <table className="w-full text-right">
                <thead className="bg-slate-50 sticky top-0 z-10">
                    <tr>
                    <th className="p-4 text-slate-500 font-medium text-sm">اسم المستخدم</th>
                    <th className="p-4 text-slate-500 font-medium text-sm">الوظيفة</th>
                    <th className="p-4 text-slate-500 font-medium text-sm">نوع الدوام</th>
                    <th className="p-4 text-slate-500 font-medium text-sm">الصلاحيات</th>
                    <th className="p-4 text-slate-500 font-medium text-sm">الراتب الشهري</th>
                    <th className="p-4 text-slate-500 font-medium text-sm">إجراءات</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {employees.map(employee => (
                    <tr key={employee.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-4 font-medium text-slate-800 flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500">
                                <User size={16} />
                            </div>
                            {employee.name}
                        </td>
                        <td className="p-4 text-slate-600">
                            <div className="flex items-center gap-2">
                                <Briefcase size={14} className="text-slate-400" />
                                {employee.role}
                            </div>
                        </td>
                        <td className="p-4 text-slate-600">
                            <span className={`px-2 py-1 rounded text-xs ${employee.type === EmployeeType.FULL_TIME ? 'bg-indigo-100 text-indigo-700' : 'bg-orange-100 text-orange-700'}`}>
                                {employee.type}
                            </span>
                        </td>
                        <td className="p-4 text-slate-500 text-xs max-w-xs truncate">
                            {employee.permissions.map(p => {
                                const label = availablePermissions.find(ap => ap.id === p)?.label || p;
                                return label;
                            }).join('، ')}
                        </td>
                        <td className="p-4 font-bold text-slate-800">{employee.salary} د.ل</td>
                        <td className="p-4">
                        <div className="flex items-center gap-2">
                            <button 
                                onClick={() => handleOpenModal(employee)}
                                className="text-slate-400 hover:text-blue-500 transition-colors p-1"
                                title="تعديل البيانات والصلاحيات"
                            >
                                <Edit2 size={18} />
                            </button>
                            <button 
                                onClick={() => handleDelete(employee.id)}
                                className="text-slate-400 hover:text-red-500 transition-colors p-1"
                                title="حذف المستخدم"
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>
                        </td>
                    </tr>
                    ))}
                    {employees.length === 0 && (
                        <tr>
                            <td colSpan={6} className="p-8 text-center text-slate-400">لا يوجد مستخدمين مسجلين</td>
                        </tr>
                    )}
                </tbody>
                </table>
            </div>
        </>
      ) : (
        <div className="flex-1 overflow-auto bg-white rounded-xl shadow-sm border border-slate-100">
            <table className="w-full text-right">
                <thead className="bg-slate-50 sticky top-0 z-10">
                    <tr>
                        <th className="p-4 text-slate-500 font-medium text-sm">الموظف</th>
                        <th className="p-4 text-slate-500 font-medium text-sm">التاريخ</th>
                        <th className="p-4 text-slate-500 font-medium text-sm">وقت الدخول</th>
                        <th className="p-4 text-slate-500 font-medium text-sm">وقت الخروج</th>
                        <th className="p-4 text-slate-500 font-medium text-sm">مدة العمل</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {attendanceRecords.map(record => (
                        <tr key={record.id} className="hover:bg-slate-50/50">
                            <td className="p-4 font-bold text-slate-700">{record.employeeName}</td>
                            <td className="p-4 text-slate-600 flex items-center gap-2">
                                <Calendar size={14} className="text-slate-400" />
                                {record.date}
                            </td>
                            <td className="p-4 text-green-600 dir-ltr text-right">
                                {new Date(record.checkInTime).toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'})}
                            </td>
                            <td className="p-4 text-red-600 dir-ltr text-right">
                                {record.checkOutTime 
                                    ? new Date(record.checkOutTime).toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'}) 
                                    : <span className="text-slate-400 italic">...</span>
                                }
                            </td>
                            <td className="p-4">
                                <div className={`flex items-center gap-2 font-bold ${!record.durationMinutes ? 'text-blue-600' : 'text-slate-800'}`}>
                                    <Clock size={16} />
                                    {formatDuration(record.durationMinutes)}
                                </div>
                            </td>
                        </tr>
                    ))}
                    {attendanceRecords.length === 0 && (
                        <tr>
                            <td colSpan={5} className="p-12 text-center text-slate-400">لا توجد سجلات دوام حتى الآن</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
      )}

        <EmployeeModal 
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            onSave={handleSave}
            editingId={editingId}
            formData={formData}
            setFormData={setFormData}
            availablePermissions={availablePermissions}
            togglePermission={togglePermission}
        />
    </div>
  );
};

export default Employees;
