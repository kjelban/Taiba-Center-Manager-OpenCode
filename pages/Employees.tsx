
import React, { useState, useEffect, useMemo } from 'react';
import { Employee, EmployeeType, Attendance, Sale } from '../types';
import { DataService } from '../services/dataService';
import { AuthService } from '../services/authService';
import { formatDuration, formatTime } from '../utils/formatUtils';
import EmployeeModal from '../components/modals/EmployeeModal';
import { Plus, Trash2, Users, User, Briefcase, Banknote, Clock, Calendar, Shield, Edit2, Lock, FileSpreadsheet, ChevronDown, ChevronUp, Filter } from 'lucide-react';
import ExcelJS from 'exceljs';

const TABS = ['users', 'worklog'] as const;
type Tab = typeof TABS[number];

const Employees: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('users');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<Attendance[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [worklogFilter, setWorklogFilter] = useState<'all' | 'today' | '7days' | '30days'>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState<Partial<Employee> & { password?: string }>({
    name: '',
    role: '',
    type: EmployeeType.FULL_TIME,
    salary: 0,
    permissions: ['pos'],
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
    const unsubSales = DataService.subscribeToSales(data => {
        data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setSales(data);
    });

    return () => {
        unsubEmployees();
        unsubAttendance();
        unsubSales();
    };
  }, []);

  const handleDelete = async (id: string) => {
    if (window.confirm('هل أنت متأكد من حذف هذا المستخدم؟')) {
      try {
        const idToken = await AuthService.getIdToken();
        const resp = await fetch('/api/admin/delete-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ uid: id }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          alert(data.error || 'فشل حذف المستخدم');
          return;
        }
        const note = data.authDeletionNote || '';
        alert(data.message + (note ? '\n\n' + note : ''));
      } catch (err) {
        console.warn('Failed to delete user:', err);
      }
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
        if (!editingId) {
            const password = formData.password;
            if (!password || password.length < 6) {
                alert('يرجى إدخال كلمة مرور مكونة من 6 أحرف على الأقل.');
                return;
            }
            if (!formData.email) {
                alert('البريد الإلكتروني مطلوب.');
                return;
            }

            const idToken = await AuthService.getIdToken();
            const resp = await fetch('/api/admin/create-user', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {}),
                },
                body: JSON.stringify({ email: formData.email, password }),
            });
            const data = await resp.json();
            if (!resp.ok) {
                alert(data.error || 'فشل إنشاء حساب المستخدم');
                return;
            }

            const employeeToSave: Employee = {
              id: data.uid,
              name: formData.name!,
              email: formData.email!,
              role: formData.role!,
              type: formData.type!,
              salary: Number(formData.salary),
              permissions: formData.permissions || ['pos']
            };
            await DataService.saveEmployee(employeeToSave);
        } else {
            const employeeToSave: Employee = {
              id: editingId,
              name: formData.name!,
              email: formData.email!,
              role: formData.role!,
              type: formData.type!,
              salary: Number(formData.salary),
              permissions: formData.permissions || ['pos']
            };
            await DataService.saveEmployee(employeeToSave);
        }
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
  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const getDateRange = (): { from: Date; to: Date } | null => {
    if (customFrom && customTo) return { from: new Date(customFrom), to: new Date(customTo) };
    const now = new Date();
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    if (worklogFilter === 'today') {
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { from, to };
    }
    if (worklogFilter === '7days') {
      const from = new Date(now.getTime() - 7 * 86400000);
      return { from, to };
    }
    if (worklogFilter === '30days') {
      const from = new Date(now.getTime() - 30 * 86400000);
      return { from, to };
    }
    return null;
  };

  const worklogData = useMemo(() => {
    const range = getDateRange();
    let filtered = range
      ? attendanceRecords.filter(r => {
          const d = new Date(r.checkInTime);
          return d >= range.from && d <= range.to;
        })
      : attendanceRecords;

    // For each attendance record, find matching sales during shift
    return filtered.map(record => {
      const shiftSales = sales.filter(s => {
        if (s.createdBy !== record.employeeName) return false;
        const saleDate = new Date(s.date);
        const checkIn = new Date(record.checkInTime);
        const checkOut = record.checkOutTime ? new Date(record.checkOutTime) : new Date();
        return saleDate >= checkIn && saleDate <= checkOut;
      });
      const salesTotal = shiftSales.reduce((sum, s) => sum + s.totalAmount, 0);
      const salesCount = shiftSales.length;
      const durationMinutes = record.durationMinutes ?? (
        record.checkOutTime
          ? Math.round((new Date(record.checkOutTime).getTime() - new Date(record.checkInTime).getTime()) / 60000)
          : null
      );
      return { ...record, shiftSales, salesCount, salesTotal, durationMinutes };
    }).filter(r => worklogFilter !== 'all' || r.checkOutTime !== undefined);
  }, [attendanceRecords, sales, worklogFilter, customFrom, customTo]);

  const exportToExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'مركز طيبة';
    workbook.created = new Date();

    const thin = { style: 'thin' as const };
    const b = { top: thin, left: thin, bottom: thin, right: thin };
    const hdrF = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Arial' };
    const hdrBg = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF2C5F8A' } };
    const dataF = { size: 10, name: 'Arial' };
    const greenBg = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF28A745' } };
    const al = (a: string) => ({ horizontal: a as any, vertical: 'middle' as const });

    // ── Sheet 1: سجل العمل ──
    const ws1 = workbook.addWorksheet('سجل العمل');
    ws1.columns = [
      { width: 20 }, { width: 14 }, { width: 14 }, { width: 14 },
      { width: 14 }, { width: 14 }, { width: 18 },
    ];
    const h1 = ws1.addRow(['الموظف', 'التاريخ', 'وقت الدخول', 'وقت الخروج', 'مدة العمل', 'عدد المبيعات', 'إجمالي المبيعات']);
    h1.eachCell(cell => { cell.font = hdrF; cell.fill = hdrBg; cell.alignment = al('center'); cell.border = b; });
    ws1.getRow(1).height = 26;

    worklogData.forEach(r => {
      const vals = [
        r.employeeName, r.date,
        formatTime(r.checkInTime),
        r.checkOutTime ? formatTime(r.checkOutTime) : 'لم يسجل خروج',
        formatDuration(r.durationMinutes),
        r.salesCount, r.salesTotal,
      ];
      const row = ws1.addRow(vals);
      row.eachCell((cell: any, col: number) => {
        cell.font = dataF; cell.border = b; cell.alignment = al('center');
        if (col === 7) cell.numFmt = '#,##0.00';
      });
    });

    // Totals row
    const totCount = worklogData.reduce((s, r) => s + r.salesCount, 0);
    const totSales = worklogData.reduce((s, r) => s + r.salesTotal, 0);
    const totMins = worklogData.reduce((s, r) => s + (r.durationMinutes || 0), 0);
    const tr = ws1.addRow(['الإجمالي', '', '', '', formatDuration(totMins), totCount, totSales]);
    tr.eachCell((cell: any, col: number) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Arial' };
      cell.fill = greenBg; cell.border = b; cell.alignment = al('center');
      if (col === 7) cell.numFmt = '#,##0.00';
    });

    // ── Sheet 2: ملخص المبيعات ──
    const ws2 = workbook.addWorksheet('ملخص المبيعات');
    ws2.columns = [{ width: 20 }, { width: 18 }, { width: 14 }, { width: 18 }];
    const h2 = ws2.addRow(['الموظف', 'إجمالي ساعات العمل', 'عدد المبيعات', 'إجمالي المبيعات']);
    h2.eachCell(cell => { cell.font = hdrF; cell.fill = hdrBg; cell.alignment = al('center'); cell.border = b; });

    const empSales: Record<string, { name: string; salesCount: number; salesTotal: number; totalMinutes: number }> = {};
    worklogData.forEach(r => {
      if (!empSales[r.employeeName]) empSales[r.employeeName] = { name: r.employeeName, salesCount: 0, salesTotal: 0, totalMinutes: 0 };
      empSales[r.employeeName].salesCount += r.salesCount;
      empSales[r.employeeName].salesTotal += r.salesTotal;
      empSales[r.employeeName].totalMinutes += r.durationMinutes || 0;
    });
    const empRows = Object.values(empSales);
    empRows.forEach(e => {
      const row = ws2.addRow([e.name, `${Math.floor(e.totalMinutes / 60)}س ${e.totalMinutes % 60}د`, e.salesCount, e.salesTotal]);
      row.eachCell((cell: any, col: number) => {
        cell.font = dataF; cell.border = b; cell.alignment = al('center');
        if (col === 4) cell.numFmt = '#,##0.00';
      });
    });

    // Grand total
    const gCount = empRows.reduce((s, e) => s + e.salesCount, 0);
    const gSales = empRows.reduce((s, e) => s + e.salesTotal, 0);
    const gMins = empRows.reduce((s, e) => s + e.totalMinutes, 0);
    const gtr = ws2.addRow(['الإجمالي', `${Math.floor(gMins / 60)}س ${gMins % 60}د`, gCount, gSales]);
    gtr.eachCell((cell: any, col: number) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Arial' };
      cell.fill = greenBg; cell.border = b; cell.alignment = al('center');
      if (col === 4) cell.numFmt = '#,##0.00';
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `سجل_العمل_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 h-[calc(100vh-64px)] overflow-hidden flex flex-col">
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">إدارة المستخدمين والدوام</h2>
          <p className="text-slate-500 text-sm">إدارة حسابات الموظفين ومتابعة ساعات العمل</p>
        </div>
        
        <div className="flex bg-white p-1 rounded-lg border border-slate-200">
            {(['users', 'worklog'] as const).map(tab => {
                const labels: Record<Tab, string> = { users: 'المستخدمين', worklog: 'سجل العمل' };
                return (
                    <button key={tab} onClick={() => setActiveTab(tab)}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === tab ? 'bg-slate-100 text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        {labels[tab]}
                    </button>
                );
            })}
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
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Filters */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 mb-4">
                <div className="flex flex-wrap items-center gap-3">
                    <Filter size={18} className="text-slate-400" />
                    {(['all', 'today', '7days', '30days'] as const).map(f => {
                        const labels = { all: 'الكل', today: 'اليوم', '7days': 'آخر 7 أيام', '30days': 'آخر 30 يوم' };
                        return (
                            <button key={f} onClick={() => { setWorklogFilter(f); setCustomFrom(''); setCustomTo(''); }}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${worklogFilter === f ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                            >
                                {labels[f]}
                            </button>
                        );
                    })}
                    <div className="h-6 w-px bg-slate-200 mx-1"></div>
                    <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setWorklogFilter('all'); }}
                        className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm" />
                    <span className="text-slate-400 text-sm">إلى</span>
                    <input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setWorklogFilter('all'); }}
                        className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm" />
                    <div className="flex-1"></div>
                    <button onClick={exportToExcel}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors text-sm">
                        <FileSpreadsheet size={18} />
                        <span>تصدير Excel</span>
                    </button>
                </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                    <p className="text-slate-500 text-xs mb-1">إجمالي ساعات العمل</p>
                    <p className="text-xl font-bold text-slate-800">
                        {formatDuration(worklogData.reduce((s, r) => s + (r.durationMinutes || 0), 0))}
                    </p>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                    <p className="text-slate-500 text-xs mb-1">عدد الموظفين</p>
                    <p className="text-xl font-bold text-slate-800">
                        {new Set(worklogData.map(r => r.employeeName)).size}
                    </p>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                    <p className="text-slate-500 text-xs mb-1">عدد المبيعات</p>
                    <p className="text-xl font-bold text-slate-800">
                        {worklogData.reduce((s, r) => s + r.salesCount, 0)}
                    </p>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                    <p className="text-slate-500 text-xs mb-1">إجمالي المبيعات</p>
                    <p className="text-xl font-bold text-green-600">
                        {worklogData.reduce((s, r) => s + r.salesTotal, 0).toLocaleString()} د.ل
                    </p>
                </div>
            </div>

            {/* Work log table */}
            <div className="flex-1 overflow-auto bg-white rounded-xl shadow-sm border border-slate-100">
                <table className="w-full text-right">
                    <thead className="bg-slate-50 sticky top-0 z-10">
                        <tr>
                            <th className="p-4 text-slate-500 font-medium text-sm"></th>
                            <th className="p-4 text-slate-500 font-medium text-sm">الموظف</th>
                            <th className="p-4 text-slate-500 font-medium text-sm">التاريخ</th>
                            <th className="p-4 text-slate-500 font-medium text-sm">وقت الدخول</th>
                            <th className="p-4 text-slate-500 font-medium text-sm">وقت الخروج</th>
                            <th className="p-4 text-slate-500 font-medium text-sm">مدة العمل</th>
                            <th className="p-4 text-slate-500 font-medium text-sm">المبيعات</th>
                            <th className="p-4 text-slate-500 font-medium text-sm">إجمالي المبيعات</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {worklogData.map(record => (
                            <React.Fragment key={record.id}>
                                <tr className="hover:bg-slate-50/50 transition-colors cursor-pointer" onClick={() => toggleRow(record.id)}>
                                    <td className="p-4 text-slate-400">
                                        {record.shiftSales.length > 0 ? (
                                            expandedRows.has(record.id) ? <ChevronUp size={16} /> : <ChevronDown size={16} />
                                        ) : null}
                                    </td>
                                    <td className="p-4 font-bold text-slate-700">{record.employeeName}</td>
                                    <td className="p-4 text-slate-600">
                                        <span className="flex items-center gap-2">
                                            <Calendar size={14} className="text-slate-400" />
                                            {record.date}
                                        </span>
                                    </td>
                                    <td className="p-4 text-green-600 dir-ltr text-right">{formatTime(record.checkInTime)}</td>
                                    <td className="p-4 text-red-600 dir-ltr text-right">
                                        {record.checkOutTime ? formatTime(record.checkOutTime) : <span className="text-slate-400 italic">...</span>}
                                    </td>
                                    <td className="p-4">
                                        <span className={`flex items-center gap-2 font-bold ${!record.durationMinutes ? 'text-blue-600' : 'text-slate-800'}`}>
                                            <Clock size={16} />
                                            {formatDuration(record.durationMinutes)}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        <span className="font-bold text-slate-800">{record.salesCount}</span>
                                    </td>
                                    <td className="p-4">
                                        <span className="font-bold text-green-600">{record.salesTotal.toLocaleString()} د.ل</span>
                                    </td>
                                </tr>
                                {expandedRows.has(record.id) && record.shiftSales.length > 0 && (
                                    <tr key={`${record.id}-details`}>
                                        <td colSpan={8} className="p-0">
                                            <div className="bg-slate-50 p-4 border-t border-slate-100">
                                                <table className="w-full text-right text-sm">
                                                    <thead>
                                                        <tr className="text-slate-500 text-xs">
                                                            <th className="p-2 font-medium">المنتجات</th>
                                                            <th className="p-2 font-medium">المبلغ</th>
                                                            <th className="p-2 font-medium">طريقة الدفع</th>
                                                            <th className="p-2 font-medium">العميل</th>
                                                            <th className="p-2 font-medium">الوقت</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-200">
                                                        {record.shiftSales.map(s => (
                                                            <tr key={s.id} className="text-slate-700">
                                                                <td className="p-2">{s.items.map(i => `${i.name}x${i.quantity}`).join('، ')}</td>
                                                                <td className="p-2 font-bold">{s.totalAmount.toLocaleString()} د.ل</td>
                                                                <td className="p-2">{s.paymentMethod}</td>
                                                                <td className="p-2">{s.customerName || '-'}</td>
                                                                <td className="p-2 text-slate-400">{formatTime(s.date)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                        {worklogData.length === 0 && (
                            <tr>
                                <td colSpan={8} className="p-12 text-center text-slate-400">لا توجد سجلات دوام في هذه الفترة</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
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
