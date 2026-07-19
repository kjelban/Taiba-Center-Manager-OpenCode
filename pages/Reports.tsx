import React, { useEffect, useState, useMemo } from 'react';
import { DataService } from '../services/dataService';
import { Sale, Expense, Product, PaymentMethod, Attendance, Employee } from '../types';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { FileText, Download, Calendar, Clock, Users, ChevronDown, ChevronUp } from 'lucide-react';
import { COLORS, formatDuration, formatTime } from '../utils/formatUtils';
import ExcelJS from 'exceljs';

const Reports: React.FC = () => {
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<Attendance[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('all');
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const today = new Date().toISOString().split('T')[0];
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(yearStart);
  const [dateTo, setDateTo] = useState(today);

  useEffect(() => {
    const unsubSales = DataService.subscribeToSales(setSales);
    const unsubExpenses = DataService.subscribeToExpenses(setExpenses);
    const unsubEmployees = DataService.subscribeToEmployees(setEmployees);
    const unsubProducts = DataService.subscribeToProducts(setProducts);
    const unsubAttendance = DataService.subscribeToAttendance(data => {
      data.sort((a, b) => new Date(b.checkInTime).getTime() - new Date(a.checkInTime).getTime());
      setAttendanceRecords(data);
    });
    return () => { unsubSales(); unsubExpenses(); unsubEmployees(); unsubProducts(); unsubAttendance(); };
  }, []);

  // Overall totals (all time)
  const overall = useMemo(() => {
    const totalRevenue = sales.reduce((sum, s) => sum + s.totalAmount, 0);
    const totalProfit = sales.reduce((sum, s) => sum + s.profit, 0);
    const totalExpenseItems = expenses.reduce((sum, e) => sum + e.amount, 0);
    const totalSalaries = employees.reduce((sum, e) => sum + e.salary, 0);
    const totalExpenses = totalExpenseItems + totalSalaries;
    const netIncome = totalProfit - totalExpenses;
    return { totalRevenue, totalProfit, totalExpenses, netIncome };
  }, [sales, expenses, employees]);

  // Filtered data for selected period
  const filteredSales = useMemo(() => {
    const from = new Date(dateFrom);
    const to = new Date(dateTo + 'T23:59:59');
    return sales.filter(s => {
      const d = new Date(s.date);
      return d >= from && d <= to;
    });
  }, [sales, dateFrom, dateTo]);

  const filteredExpenses = useMemo(() => {
    const from = new Date(dateFrom);
    const to = new Date(dateTo + 'T23:59:59');
    return expenses.filter(e => {
      const d = new Date(e.date);
      return d >= from && d <= to;
    });
  }, [expenses, dateFrom, dateTo]);

  const period = useMemo(() => {
    const totalRevenue = filteredSales.reduce((sum, s) => sum + s.totalAmount, 0);
    const totalProfit = filteredSales.reduce((sum, s) => sum + s.profit, 0);
    const totalExpenseItems = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
    const periodDays = Math.max(1, Math.ceil((new Date(dateTo + 'T23:59:59').getTime() - new Date(dateFrom).getTime()) / 86400000));
    const totalExpenses = totalExpenseItems;
    const netIncome = totalProfit - totalExpenses;
    return { totalRevenue, totalProfit, totalExpenses, netIncome, days: periodDays };
  }, [filteredSales, filteredExpenses, dateFrom, dateTo]);

  // Product-level aggregation for the period
  const productSales = useMemo(() => {
    const map: Record<string, { name: string; qty: number; revenue: number; profit: number; purchaseCost: number; isManual: boolean }> = {};
    filteredSales.forEach(s => {
      s.items.forEach(item => {
        if (!map[item.id]) map[item.id] = { name: item.name, qty: 0, revenue: 0, profit: 0, purchaseCost: 0, isManual: !!item.isManualItem };
        map[item.id].qty += item.quantity;
        const rev = item.sellingPrice * item.quantity;
        const cost = (item.purchasePrice || 0) * item.quantity;
        map[item.id].revenue += rev;
        map[item.id].purchaseCost += cost;
        map[item.id].profit += rev - cost;
      });
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [filteredSales]);

  // Expenses by category for the period
  const periodExpensesByCat = useMemo(() => {
    const map: Record<string, number> = {};
    filteredExpenses.forEach(e => {
      map[e.category] = (map[e.category] || 0) + e.amount;
    });
    return Object.keys(map).map(key => ({ name: key, value: map[key] }));
  }, [filteredExpenses]);

  // Expenses by category (all time, for the pie chart)
  const allExpensesByCat = useMemo(() => {
    const map: Record<string, number> = {};
    expenses.forEach(e => {
      map[e.category] = (map[e.category] || 0) + e.amount;
    });
    const totalSalaries = employees.reduce((sum, e) => sum + e.salary, 0);
    if (totalSalaries > 0) map['رواتب'] = totalSalaries;
    return Object.keys(map).map(key => ({ name: key, value: map[key] }));
  }, [expenses, employees]);

  const filteredAttendance = useMemo(() => {
    const from = new Date(dateFrom);
    const to = new Date(dateTo + 'T23:59:59');
    return attendanceRecords.filter(a => {
      const d = new Date(a.checkInTime);
      const inRange = d >= from && d <= to;
      const empMatch = selectedEmployeeId === 'all' || a.employeeId === selectedEmployeeId;
      return inRange && empMatch;
    });
  }, [attendanceRecords, dateFrom, dateTo, selectedEmployeeId]);

  const attendanceByEmployeeAndDay = useMemo(() => {
    const byEmp: Record<string, Record<string, Attendance[]>> = {};
    filteredAttendance.forEach(a => {
      if (!byEmp[a.employeeId]) byEmp[a.employeeId] = {};
      const day = a.date || a.checkInTime.split('T')[0];
      if (!byEmp[a.employeeId][day]) byEmp[a.employeeId][day] = [];
      byEmp[a.employeeId][day].push(a);
    });
    Object.keys(byEmp).forEach(empId => {
      Object.keys(byEmp[empId]).forEach(day => {
        byEmp[empId][day].sort((a, b) => new Date(a.checkInTime).getTime() - new Date(b.checkInTime).getTime());
      });
    });
    return byEmp;
  }, [filteredAttendance]);

  const monthlyAttendanceSummary = useMemo(() => {
    const byMonth: Record<string, Record<string, number>> = {};
    filteredAttendance.forEach(a => {
      const month = (a.date || a.checkInTime.split('T')[0]).substring(0, 7);
      const day = a.date || a.checkInTime.split('T')[0];
      if (!byMonth[month]) byMonth[month] = {};
      byMonth[month][day] = (byMonth[month][day] || 0) + (a.durationMinutes || 0);
    });
    return Object.entries(byMonth).sort(([a], [b]) => b.localeCompare(a)).map(([month, days]) => {
      const totalMinutes = Object.values(days).reduce((s, v) => s + v, 0);
      const dayCount = Object.keys(days).length;
      return { month, days, totalMinutes, dayCount };
    });
  }, [filteredAttendance]);

  const handleExportXLSX = async () => {
    if (sales.length === 0 && expenses.length === 0) {
      alert("لا توجد بيانات للتصدير");
      return;
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'مركز طيبة';
    workbook.created = new Date();

    const thin = { style: 'thin' as const };
    const b = { top: thin, left: thin, bottom: thin, right: thin };

    const hdrF = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Arial' };
    const hdrBg = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF2C5F8A' } };
    const dataF = { size: 10, name: 'Arial' };
    const greenBg = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF28A745' } };
    const orangeBg = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE67E22' } };
    const navyBg = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF2C3E50' } };
    const c = (a: string) => ({ horizontal: a as any, vertical: 'middle' as const });

    // ── Sheet 1: ملخص ──
    const ws1 = workbook.addWorksheet('ملخص');
    ws1.columns = [{ width: 38 }, { width: 22 }];
    ws1.mergeCells('A1:B1');
    const t = ws1.getCell('A1');
    t.value = `التقرير المالي من ${dateFrom} إلى ${dateTo}`;
    t.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
    t.fill = navyBg; t.alignment = c('center');
    ws1.getRow(1).height = 38;

    const addRow = (ws: any, row: number, col: number, val: any, font: any, fill: any, align: string, numFmt?: string) => {
      const cell = ws.getCell(row, col);
      cell.value = val;
      cell.font = font; cell.fill = fill; cell.alignment = c(align); cell.border = b;
      if (numFmt) cell.numFmt = numFmt;
    };

    const secRow = (ws: any, r: number, label: string) => {
      ws.mergeCells(r, 1, r, 2);
      addRow(ws, r, 1, label, hdrF, orangeBg, 'center');
    };

    secRow(ws1, 3, 'فترة التقرير');
    addRow(ws1, 4, 1, 'إجمالي المبيعات', dataF, { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } }, 'right');
    addRow(ws1, 4, 2, period.totalRevenue, { ...dataF, bold: true }, { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } }, 'center', '#,##0.00');
    addRow(ws1, 5, 1, 'إجمالي الربح', dataF, { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }, 'right');
    addRow(ws1, 5, 2, period.totalProfit, { ...dataF, bold: true, color: { argb: 'FF28A745' } }, { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }, 'center', '#,##0.00');
    addRow(ws1, 6, 1, 'إجمالي المصاريف', dataF, { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8E8' } }, 'right');
    addRow(ws1, 6, 2, period.totalExpenses, { ...dataF, bold: true, color: { argb: 'FFE74C3C' } }, { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8E8' } }, 'center', '#,##0.00');
    addRow(ws1, 7, 1, 'صافي الربح', dataF, { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } }, 'right');
    addRow(ws1, 7, 2, period.netIncome, { ...dataF, bold: true, color: { argb: period.netIncome >= 0 ? 'FF28A745' : 'FFE74C3C' } }, { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } }, 'center', '#,##0.00');
    addRow(ws1, 8, 1, 'عدد أيام الفترة', dataF, { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }, 'right');
    addRow(ws1, 8, 2, period.days, { ...dataF, bold: true }, { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }, 'center');

    secRow(ws1, 10, 'كل الوقت');
    const overallData: [string, number, string][] = [
      ['إجمالي المبيعات', overall.totalRevenue, 'FFF8F9FA'],
      ['إجمالي الربح', overall.totalProfit, 'FFE8F5E9'],
      ['إجمالي المصاريف والرواتب', overall.totalExpenses, 'FFFDE8E8'],
      ['صافي الربح النهائي', overall.netIncome, 'FFF8F9FA'],
    ];
    overallData.forEach(([label, val, bg], i) => {
      const r = i + 11;
      addRow(ws1, r, 1, label, dataF, { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }, 'right');
      const cVal = label.includes('الربح') && !label.includes('المصاريف') ? (val >= 0 ? 'FF28A745' : 'FFE74C3C') : undefined;
      addRow(ws1, r, 2, val, { ...dataF, bold: true, ...(cVal ? { color: { argb: cVal } } : {}) }, { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }, 'center', '#,##0.00');
    });

    // ── Sheet 2: المبيعات حسب المنتج ──
    const ws2 = workbook.addWorksheet('المبيعات حسب المنتج');
    ws2.columns = [{ width: 28 }, { width: 12 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 14 }];
    const ph = ['المنتج', 'الكمية', 'الإيرادات', 'التكلفة', 'الربح', 'ملاحظات'];
    ws2.addRow(ph).eachCell(cell => { cell.font = hdrF; cell.fill = hdrBg; cell.alignment = { horizontal: 'center', vertical: 'middle' }; cell.border = b; });
    ws2.getRow(1).height = 26;
    productSales.forEach(p => {
      const vals = [p.name, p.qty, p.revenue, p.purchaseCost, p.profit, p.isManual ? 'خارج المخزن' : ''];
      const row = ws2.addRow(vals);
      row.eachCell((cell: any, col: number) => {
        cell.font = dataF; cell.border = b; cell.alignment = col === 1 ? c('right') : c('center');
        if ([3, 4, 5].includes(col)) cell.numFmt = '#,##0.00';
      });
    });
    const tQty = productSales.reduce((s, p) => s + p.qty, 0);
    const tRev = productSales.reduce((s, p) => s + p.revenue, 0);
    const tCost = productSales.reduce((s, p) => s + p.purchaseCost, 0);
    const tProf = productSales.reduce((s, p) => s + p.profit, 0);
    const tr = ws2.addRow(['الإجمالي', tQty, tRev, tCost, tProf, '']);
    tr.eachCell((cell: any, col: number) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Arial' };
      cell.fill = greenBg; cell.border = b; cell.alignment = col === 1 ? c('right') : c('center');
      if ([3, 4, 5].includes(col)) cell.numFmt = '#,##0.00';
    });

    // ── Sheet 3: المصاريف ──
    const ws3 = workbook.addWorksheet('المصاريف');
    ws3.columns = [{ width: 14 }, { width: 16 }, { width: 32 }, { width: 18 }];
    ws3.addRow(['التاريخ', 'التصنيف', 'الوصف', 'المبلغ']).eachCell(cell => {
      cell.font = hdrF; cell.fill = hdrBg; cell.alignment = { horizontal: 'center', vertical: 'middle' }; cell.border = b;
    });
    filteredExpenses.forEach(e => {
      const row = ws3.addRow([new Date(e.date).toLocaleDateString(), e.category, e.description, e.amount]);
      row.eachCell((cell: any, col: number) => {
        cell.font = dataF; cell.border = b; cell.alignment = c('center');
        if (col === 3) cell.alignment = c('right');
        if (col === 4) cell.numFmt = '#,##0.00';
      });
    });
    const te = filteredExpenses.reduce((s, e) => s + e.amount, 0);
    const etr = ws3.addRow(['', '', 'الإجمالي', te]);
    etr.eachCell((cell: any, col: number) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Arial' };
      cell.fill = greenBg; cell.border = b; cell.alignment = c('center');
      if (col === 3) cell.alignment = c('right');
      if (col === 4) cell.numFmt = '#,##0.00';
    });

    // ── Sheet 4: الفواتير ──
    const ws4 = workbook.addWorksheet('الفواتير');
    ws4.columns = [{ width: 22 }, { width: 14 }, { width: 12 }, { width: 16 }, { width: 16 }, { width: 12 }, { width: 20 }, { width: 16 }];
    ws4.addRow(['رقم الفاتورة', 'التاريخ', 'عدد الأصناف', 'الإجمالي', 'الربح', 'طريقة الدفع', 'العميل', 'الموظف']).eachCell(cell => {
      cell.font = hdrF; cell.fill = hdrBg; cell.alignment = { horizontal: 'center', vertical: 'middle' }; cell.border = b;
    });
    filteredSales.forEach(s => {
      const row = ws4.addRow([s.id, new Date(s.date).toLocaleDateString(), s.items.length, s.totalAmount, s.profit, s.paymentMethod, s.customerName || '-', s.createdBy]);
      row.eachCell((cell: any, col: number) => {
        cell.font = dataF; cell.border = b; cell.alignment = c('center');
        if ([4, 5].includes(col)) cell.numFmt = '#,##0.00';
      });
    });
    const totalInvProfit = filteredSales.reduce((s, inv) => s + inv.profit, 0);
    const debtInvoices = filteredSales.filter(s => s.paymentMethod === PaymentMethod.DEBT);
    const totalDebt = debtInvoices.reduce((s, inv) => s + inv.totalAmount, 0);
    const dr = ws4.addRow(['', '', 'إجمالي الربح', totalInvProfit, 'إجمالي الديون', totalDebt, '', '']);
    dr.eachCell((cell: any, col: number) => {
      if ([3, 4, 5, 6].includes(col)) {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Arial' };
        cell.fill = col === 6 ? orangeBg : greenBg;
        cell.alignment = c('center'); cell.border = b;
        if ([4, 6].includes(col)) cell.numFmt = '#,##0.00';
      }
    });
    const dr2 = ws4.addRow(['', '', `عدد فواتير الديون`, debtInvoices.length, '', '', '', '']);
    dr2.eachCell((cell: any, col: number) => {
      if ([3, 4].includes(col)) {
        cell.font = { bold: true, italic: true, size: 10, color: { argb: 'FFE67E22' }, name: 'Arial' };
        cell.alignment = c('center'); cell.border = b;
      }
    });

    // ── Sheet 5: ملخص مدة العمل اليومية ──
    if (filteredAttendance.length > 0) {
      const ws5 = workbook.addWorksheet('ملخص مدة العمل اليومية');
      ws5.columns = [{ width: 24 }, { width: 18 }, { width: 20 }];
      ws5.addRow(['اسم المستخدم', 'التاريخ', 'مجموع ساعات العمل']).eachCell(cell => {
        cell.font = hdrF; cell.fill = hdrBg; cell.alignment = { horizontal: 'center', vertical: 'middle' }; cell.border = b;
      });
      ws5.getRow(1).height = 26;

      const allDays = new Set<string>();
      Object.values(attendanceByEmployeeAndDay).forEach(days => {
        Object.keys(days).forEach(d => allDays.add(d));
      });
      const sortedDays = Array.from(allDays).sort().reverse();

      let grandTotalMinutes = 0;
      sortedDays.forEach(day => {
        Object.entries(attendanceByEmployeeAndDay).forEach(([empId, days]) => {
          if (!days[day]) return;
          const sessions = days[day];
          const empName = sessions[0]?.employeeName || empId;
          const dayTotal = sessions.reduce((s, a) => s + (a.durationMinutes || 0), 0);
          grandTotalMinutes += dayTotal;
          const h = Math.floor(dayTotal / 60);
          const m = dayTotal % 60;
          const row = ws5.addRow([empName, day, `${h}س ${m}د`]);
          row.eachCell((cell: any, col: number) => {
            cell.font = dataF; cell.border = b; cell.alignment = col === 1 ? c('right') : c('center');
          });
        });
      });

      const gh = Math.floor(grandTotalMinutes / 60);
      const gm = grandTotalMinutes % 60;
      const totalRow = ws5.addRow(['الإجمالي', '', `${gh}س ${gm}د`]);
      totalRow.eachCell((cell: any, col: number) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Arial' };
        cell.fill = greenBg; cell.border = b; cell.alignment = c('center');
        if (col === 1) cell.alignment = c('right');
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `تقرير_${dateFrom}_${dateTo}.xlsx`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 overflow-auto h-[calc(100vh-64px)]">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-slate-800">التقارير المالية</h2>
        <button onClick={handleExportXLSX}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors shadow-lg shadow-primary/25">
          <Download size={18} />
          <span>تصدير Excel</span>
        </button>
      </div>

      {/* Period Filter */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <Calendar size={18} className="text-slate-400" />
          <span className="text-sm font-medium text-slate-600">تقرير عن الفترة:</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-primary" />
          <span className="text-slate-400">إلى</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-primary" />
          <button onClick={() => { setDateFrom(yearStart); setDateTo(today); }}
            className="text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-200 transition-colors">هذه السنة</button>
          <button onClick={() => { const d = new Date(); d.setDate(d.getDate() - 30); setDateFrom(d.toISOString().split('T')[0]); setDateTo(today); }}
            className="text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-200 transition-colors">آخر 30 يوم</button>
        </div>
      </div>

      {/* Period Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-5 rounded-xl border-r-4 border-blue-500 shadow-sm">
          <p className="text-slate-500 text-xs font-medium">مبيعات الفترة</p>
          <h3 className="text-xl font-bold text-slate-800 mt-1">{period.totalRevenue.toLocaleString()} د.ل</h3>
        </div>
        <div className="bg-white p-5 rounded-xl border-r-4 border-green-500 shadow-sm">
          <p className="text-slate-500 text-xs font-medium">أرباح الفترة</p>
          <h3 className="text-xl font-bold text-slate-800 mt-1">{period.totalProfit.toLocaleString()} د.ل</h3>
        </div>
        <div className="bg-white p-5 rounded-xl border-r-4 border-orange-500 shadow-sm">
          <p className="text-slate-500 text-xs font-medium">مصاريف الفترة</p>
          <h3 className="text-xl font-bold text-slate-800 mt-1">{period.totalExpenses.toLocaleString()} د.ل</h3>
        </div>
        <div className={`bg-white p-5 rounded-xl border-r-4 shadow-sm ${period.netIncome >= 0 ? 'border-primary' : 'border-red-500'}`}>
          <p className="text-slate-500 text-xs font-medium">صافي ربح الفترة</p>
          <h3 className={`text-xl font-bold mt-1 ${period.netIncome >= 0 ? 'text-primary' : 'text-red-600'}`}>
            {period.netIncome.toLocaleString()} د.ل
          </h3>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Overall summary cards */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
          <p className="text-slate-400 text-xs mb-1">إجمالي الإيرادات (كل الوقت)</p>
          <p className="text-lg font-bold text-slate-800">{overall.totalRevenue.toLocaleString()} د.ل</p>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
          <p className="text-slate-400 text-xs mb-1">إجمالي المصاريف والرواتب (كل الوقت)</p>
          <p className="text-lg font-bold text-slate-800">{overall.totalExpenses.toLocaleString()} د.ل</p>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
          <p className="text-slate-400 text-xs mb-1">صافي الربح النهائي (كل الوقت)</p>
          <p className={`text-lg font-bold ${overall.netIncome >= 0 ? 'text-primary' : 'text-red-600'}`}>
            {overall.netIncome.toLocaleString()} د.ل
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Product Sales Table */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h3 className="font-bold text-slate-700 flex items-center gap-2">
              <FileText size={18} />
              المبيعات حسب المنتج - {dateFrom} إلى {dateTo}
            </h3>
          </div>
          <div className="overflow-auto max-h-96">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="p-3 text-slate-500 font-medium">المنتج</th>
                  <th className="p-3 text-slate-500 font-medium">الكمية</th>
                  <th className="p-3 text-slate-500 font-medium">الإيرادات</th>
                  <th className="p-3 text-slate-500 font-medium">الربح</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {productSales.map((p, i) => (
                  <tr key={i} className="hover:bg-slate-50/50">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800">{p.name}</span>
                        {p.isManual && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">خارج المخزن</span>}
                      </div>
                    </td>
                    <td className="p-3 text-slate-600">{p.qty}</td>
                    <td className="p-3 text-slate-800 font-bold">{p.revenue.toLocaleString()}</td>
                    <td className={`p-3 font-bold ${p.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>{p.profit.toLocaleString()}</td>
                  </tr>
                ))}
                {productSales.length === 0 && (
                  <tr><td colSpan={4} className="p-8 text-center text-slate-400">لا توجد مبيعات في هذه الفترة</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Expenses & Chart */}
        <div className="space-y-6">
          {/* Period expenses */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
            <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
              <FileText size={18} />
              مصاريف الفترة
            </h3>
            {periodExpensesByCat.length > 0 ? (
              <div className="space-y-2">
                {periodExpensesByCat.map((e, i) => (
                  <div key={i} className="flex justify-between items-center p-2 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">{e.name}</span>
                    <span className="text-sm font-bold text-slate-800">{e.value.toLocaleString()} د.ل</span>
                  </div>
                ))}
                <div className="flex justify-between items-center p-2 bg-orange-50 rounded-lg border border-orange-100 mt-2">
                  <span className="text-sm font-bold text-orange-700">الإجمالي</span>
                  <span className="text-sm font-bold text-orange-700">{period.totalExpenses.toLocaleString()} د.ل</span>
                </div>
              </div>
            ) : (
              <p className="text-slate-400 text-sm text-center py-4">لا توجد مصاريف في هذه الفترة</p>
            )}
          </div>

          {/* All-time expense distribution pie */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
            <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
              <FileText size={18} />
              توزيع المصاريف (كل الوقت)
            </h3>
            {allExpensesByCat.length > 0 ? (
              <>
                <div style={{ width: '100%', height: 200 }}>
                  <ResponsiveContainer width="99%" height="100%">
                    <PieChart>
                      <Pie data={allExpensesByCat} cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={5} dataKey="value">
                        {allExpensesByCat.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-1 text-xs">
                  {allExpensesByCat.map((e, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: COLORS[i % COLORS.length]}}></div>
                      <span className="text-slate-600">{e.name}: {e.value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-slate-400 text-sm text-center py-4">لا توجد مصاريف مسجلة</p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Clock size={22} />
            تقرير الدوام
          </h2>
          <div className="flex items-center gap-2">
            <Users size={16} className="text-slate-400" />
            <select
              value={selectedEmployeeId}
              onChange={e => setSelectedEmployeeId(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-primary bg-white"
            >
              <option value="all">جميع الموظفين</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
          </div>
        </div>

        {Object.keys(attendanceByEmployeeAndDay).length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-8 text-center text-slate-400">
            لا توجد سجلات دوام في هذه الفترة
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(attendanceByEmployeeAndDay).map(([empId, days]) => {
              const emp = employees.find(e => e.id === empId);
              const empName = emp?.name || days[Object.keys(days)[0]]?.[0]?.employeeName || empId;
              const dayEntries = Object.entries(days).sort(([a], [b]) => b.localeCompare(a));
              const empTotalMinutes = dayEntries.reduce((sum, [, sessions]) =>
                sum + sessions.reduce((s, a) => s + (a.durationMinutes || 0), 0), 0
              );

              return (
                <div key={empId} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                  <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                    <h3 className="font-bold text-slate-700">{empName}</h3>
                    <span className="text-sm font-bold text-primary">{formatDuration(empTotalMinutes)}</span>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {dayEntries.map(([day, sessions]) => {
                      const dayTotal = sessions.reduce((s, a) => s + (a.durationMinutes || 0), 0);
                      const dayKey = `${empId}-${day}`;
                      const isExpanded = expandedDays.has(dayKey);
                      const dayLabel = new Date(day + 'T00:00:00').toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

                      return (
                        <div key={day}>
                          <button
                            onClick={() => {
                              setExpandedDays(prev => {
                                const next = new Set(prev);
                                if (next.has(dayKey)) next.delete(dayKey); else next.add(dayKey);
                                return next;
                              });
                            }}
                            className="w-full flex items-center justify-between p-3 hover:bg-slate-50 transition-colors text-right"
                          >
                            <div className="flex items-center gap-2">
                              {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                              <span className="text-sm font-medium text-slate-700">{dayLabel}</span>
                              <span className="text-xs text-slate-400">({sessions.length} جلس{sessions.length === 1 ? 'ة' : 'ات'})</span>
                            </div>
                            <span className="text-sm font-bold text-primary">{formatDuration(dayTotal)}</span>
                          </button>

                          {isExpanded && (
                            <div className="px-4 pb-3">
                              <table className="w-full text-right text-sm">
                                <thead>
                                  <tr className="text-slate-500">
                                    <th className="pb-2 font-medium">#</th>
                                    <th className="pb-2 font-medium">الدخول</th>
                                    <th className="pb-2 font-medium">الخروج</th>
                                    <th className="pb-2 font-medium">المدة</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                  {sessions.map((s, i) => (
                                    <tr key={s.id} className="hover:bg-slate-50/50">
                                      <td className="py-2 text-slate-400">{i + 1}</td>
                                      <td className="py-2 text-slate-700">{formatTime(s.checkInTime)}</td>
                                      <td className="py-2">
                                        {s.checkOutTime ? (
                                          <span className="text-slate-700">{formatTime(s.checkOutTime)}</span>
                                        ) : (
                                          <span className="text-amber-500 font-medium">جاري العمل</span>
                                        )}
                                      </td>
                                      <td className="py-2 font-bold text-slate-800">{formatDuration(s.durationMinutes)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {monthlyAttendanceSummary.length > 0 && (
          <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <h3 className="font-bold text-slate-700 flex items-center gap-2">
                <Calendar size={18} />
                ملخص الدوام الشهري
              </h3>
            </div>
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-3 text-slate-500 font-medium">الشهر</th>
                  <th className="p-3 text-slate-500 font-medium">عدد الأيام</th>
                  <th className="p-3 text-slate-500 font-medium">إجمالي الدوام</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {monthlyAttendanceSummary.map(m => {
                  const [year, month] = m.month.split('-');
                  const monthLabel = new Date(Number(year), Number(month) - 1).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' });
                  return (
                    <tr key={m.month} className="hover:bg-slate-50/50">
                      <td className="p-3 font-medium text-slate-700">{monthLabel}</td>
                      <td className="p-3 text-slate-600">{m.dayCount}</td>
                      <td className="p-3 font-bold text-primary">{formatDuration(m.totalMinutes)}</td>
                    </tr>
                  );
                })}
                <tr className="bg-slate-50 font-bold">
                  <td className="p-3 text-slate-700">الإجمالي</td>
                  <td className="p-3 text-slate-600">{monthlyAttendanceSummary.reduce((s, m) => s + m.dayCount, 0)}</td>
                  <td className="p-3 text-primary">{formatDuration(monthlyAttendanceSummary.reduce((s, m) => s + m.totalMinutes, 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Reports;
