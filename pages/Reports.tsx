
import React, { useEffect, useState } from 'react';
import { DataService } from '../services/dataService';
import { Sale, Expense, Product } from '../types';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { FileText, Download, ClipboardCheck, X } from 'lucide-react';

const Reports: React.FC = () => {
  const [reportData, setReportData] = useState<{
    totalRevenue: number;
    totalProfit: number;
    totalExpenses: number;
    netIncome: number;
  }>({ totalRevenue: 0, totalProfit: 0, totalExpenses: 0, netIncome: 0 });

  const [expensesByCategory, setExpensesByCategory] = useState<any[]>([]);
  
  // Audit Modal State
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [auditCounts, setAuditCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let currentSales: Sale[] = [];
    let currentExpenses: Expense[] = [];
    let currentEmployees: any[] = [];
    let currentProducts: Product[] = [];

    const updateReport = () => {
      setProducts(currentProducts);

      const totalRevenue = currentSales.reduce((sum, s) => sum + s.totalAmount, 0);
      const totalProfit = currentSales.reduce((sum, s) => sum + s.profit, 0);
      const totalExpensesItems = currentExpenses.reduce((sum, e) => sum + e.amount, 0);
      const totalSalaries = currentEmployees.reduce((sum, e) => sum + e.salary, 0);
      
      const totalExpenses = totalExpensesItems + totalSalaries;
      const netIncome = totalProfit - totalExpenses;

      setReportData({ totalRevenue, totalProfit, totalExpenses, netIncome });

      const catMap: Record<string, number> = {};
      currentExpenses.forEach(e => {
        catMap[e.category] = (catMap[e.category] || 0) + e.amount;
      });
      catMap['رواتب'] = totalSalaries;

      const chartData = Object.keys(catMap).map(key => ({
        name: key,
        value: catMap[key]
      }));
      setExpensesByCategory(chartData);
    };

    const unsubSales = DataService.subscribeToSales(data => { currentSales = data; updateReport(); });
    const unsubExpenses = DataService.subscribeToExpenses(data => { currentExpenses = data; updateReport(); });
    const unsubEmployees = DataService.subscribeToEmployees(data => { currentEmployees = data; updateReport(); });
    const unsubProducts = DataService.subscribeToProducts(data => { currentProducts = data; updateReport(); });

    return () => {
      unsubSales();
      unsubExpenses();
      unsubEmployees();
      unsubProducts();
    };
  }, []);

  const handleExportCSV = async () => {
    const sales = await DataService.getSales();
    if (sales.length === 0) {
        alert("لا توجد مبيعات للتصدير");
        return;
    }
    
    // Create CSV content
    const header = ['رقم العملية', 'التاريخ', 'عدد الأصناف', 'المبلغ الإجمالي', 'الربح', 'طريقة الدفع'];
    const rows = sales.map(s => [
        `\t${s.id}`, // Prepend tab to force text format in Excel to avoid scientific notation (1.77E+12)
        new Date(s.date).toLocaleDateString(),
        s.items.length,
        s.totalAmount,
        s.profit,
        s.paymentMethod
    ]);

    const csvContent = [
        header.join(','),
        ...rows.map(row => row.join(','))
    ].join('\n');

    // Download
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' }); // Add BOM for Excel Arabic support
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `taiba_sales_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const openAudit = () => {
    const initialCounts: Record<string, number> = {};
    products.forEach(p => initialCounts[p.id] = p.stock);
    setAuditCounts(initialCounts);
    setIsAuditOpen(true);
  };

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

  return (
    <div className="p-6">
        <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-bold text-slate-800">التقارير المالية</h2>
            <button 
                onClick={handleExportCSV}
                className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors"
            >
                <Download size={18} />
                <span>تصدير Excel (CSV)</span>
            </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-white p-6 rounded-xl border-l-4 border-blue-500 shadow-sm">
                <p className="text-slate-500 text-sm font-medium">إجمالي الإيرادات</p>
                <h3 className="text-2xl font-bold text-slate-800 mt-2">{reportData.totalRevenue.toLocaleString()} د.ل</h3>
            </div>
            <div className="bg-white p-6 rounded-xl border-l-4 border-green-500 shadow-sm">
                <p className="text-slate-500 text-sm font-medium">إجمالي الربح (المبيعات)</p>
                <h3 className="text-2xl font-bold text-slate-800 mt-2">{reportData.totalProfit.toLocaleString()} د.ل</h3>
            </div>
            <div className="bg-white p-6 rounded-xl border-l-4 border-orange-500 shadow-sm">
                <p className="text-slate-500 text-sm font-medium">إجمالي المصاريف والرواتب</p>
                <h3 className="text-2xl font-bold text-slate-800 mt-2">{reportData.totalExpenses.toLocaleString()} د.ل</h3>
            </div>
            <div className={`bg-white p-6 rounded-xl border-l-4 shadow-sm ${reportData.netIncome >= 0 ? 'border-primary' : 'border-red-500'}`}>
                <p className="text-slate-500 text-sm font-medium">صافي الربح النهائي</p>
                <h3 className={`text-2xl font-bold mt-2 ${reportData.netIncome >= 0 ? 'text-primary' : 'text-red-600'}`}>
                    {reportData.netIncome.toLocaleString()} د.ل
                </h3>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                <h3 className="font-bold text-slate-700 mb-6 flex items-center gap-2">
                    <FileText size={20} />
                    توزيع المصاريف
                </h3>
                <div style={{ width: '100%', height: 250, minHeight: 250 }}>
                    <ResponsiveContainer width="99%" height="100%">
                        <PieChart>
                            <Pie
                                data={expensesByCategory}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                fill="#8884d8"
                                paddingAngle={5}
                                dataKey="value"
                            >
                                {expensesByCategory.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                    {expensesByCategory.map((entry, index) => (
                        <div key={index} className="flex items-center gap-2 text-sm">
                            <div className="w-3 h-3 rounded-full" style={{backgroundColor: COLORS[index % COLORS.length]}}></div>
                            <span className="text-slate-600">{entry.name}: {entry.value}</span>
                        </div>
                    ))}
                </div>
            </div>
            
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col justify-center items-center text-center">
                <div className="bg-slate-50 p-6 rounded-full mb-4">
                    <ClipboardCheck size={48} className="text-slate-300" />
                </div>
                <h3 className="text-lg font-bold text-slate-700 mb-2">تقرير الجرد السنوي</h3>
                <p className="text-slate-500 text-sm mb-6 max-w-xs">يمكنك بدء عملية جرد المخزون ومقارنة الكميات الفعلية بالمسجلة في النظام.</p>
                <button 
                    onClick={openAudit}
                    className="bg-slate-800 text-white px-6 py-2 rounded-lg hover:bg-slate-700 transition-colors"
                >
                    بدء جرد جديد
                </button>
            </div>
        </div>

        {/* Audit Modal */}
        {isAuditOpen && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl h-[80vh] flex flex-col">
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                        <h3 className="text-xl font-bold text-slate-800">جرد المخزون</h3>
                        <button onClick={() => setIsAuditOpen(false)} className="text-slate-400 hover:text-red-500">
                            <X size={24} />
                        </button>
                    </div>
                    
                    <div className="flex-1 overflow-auto p-6">
                        <table className="w-full text-right">
                            <thead className="bg-slate-50 sticky top-0">
                                <tr>
                                    <th className="p-3 text-sm text-slate-500">المنتج</th>
                                    <th className="p-3 text-sm text-slate-500">الكمية في النظام</th>
                                    <th className="p-3 text-sm text-slate-500">الكمية الفعلية</th>
                                    <th className="p-3 text-sm text-slate-500">الفرق</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {products.map(product => {
                                    const actual = auditCounts[product.id] || 0;
                                    const diff = actual - product.stock;
                                    return (
                                        <tr key={product.id}>
                                            <td className="p-3 font-medium">{product.name}</td>
                                            <td className="p-3">{product.stock}</td>
                                            <td className="p-3">
                                                <input 
                                                    type="number" 
                                                    className="border border-slate-300 rounded px-2 py-1 w-20 text-center outline-none focus:border-primary bg-white text-slate-900"
                                                    value={actual}
                                                    onChange={(e) => setAuditCounts({...auditCounts, [product.id]: Number(e.target.value)})}
                                                />
                                            </td>
                                            <td className={`p-3 font-bold ${diff < 0 ? 'text-red-500' : diff > 0 ? 'text-green-500' : 'text-slate-400'}`}>
                                                {diff > 0 ? '+' : ''}{diff}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <div className="p-6 border-t border-slate-100 flex justify-end gap-3">
                        <button onClick={() => setIsAuditOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg">إغلاق</button>
                        <button className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-secondary" onClick={() => {
                            alert("تم حفظ نتيجة الجرد (محاكاة)");
                            setIsAuditOpen(false);
                        }}>حفظ الجرد</button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};

export default Reports;
