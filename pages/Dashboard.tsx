
import React, { useEffect, useState } from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer
} from 'recharts';
import { DataService } from '../services/dataService';
import { DollarSign, AlertTriangle, TrendingUp, Package, Users } from 'lucide-react';
import { COLORS } from '../utils/formatUtils';

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState({
    dailySales: 0,
    totalProfit: 0,
    lowStockCount: 0,
    totalProducts: 0
  });
  const [chartData, setChartData] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [employeePerformance, setEmployeePerformance] = useState<any[]>([]);

  useEffect(() => {
    let currentSales: any[] = [];
    let currentProducts: any[] = [];

    const updateDashboard = () => {
      // Calculate Stats
      const today = new Date().toISOString().split('T')[0];
      const todaySales = currentSales
        .filter(s => s.date.startsWith(today) && s.type !== 'مرتجع')
        .reduce((sum, s) => sum + s.totalAmount, 0);

      const lowStock = currentProducts.filter(p => p.stock <= p.minStockAlert).length;

      const totalProfit = currentSales.reduce((sum, s) => sum + s.profit, 0);

      setStats({
        dailySales: todaySales,
        totalProfit: totalProfit, 
        lowStockCount: lowStock,
        totalProducts: currentProducts.length
      });

      // Chart 1: Sales Last 7 Days
      const last7Days = Array.from({length: 7}, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return d.toISOString().split('T')[0];
      }).reverse();

      const data = last7Days.map(date => {
        const daySales = currentSales
            .filter(s => s.date.startsWith(date) && s.type !== 'مرتجع')
            .reduce((sum, s) => sum + s.totalAmount, 0);
        return { name: date.slice(5), sales: daySales };
      });
      setChartData(data);

      // Chart 2: Top Selling Products
      const productSalesMap: Record<string, number> = {};
      currentSales.forEach(sale => {
        if (sale.type === 'مرتجع') return;
        sale.items.forEach((item: any) => {
            productSalesMap[item.name] = (productSalesMap[item.name] || 0) + item.quantity;
        });
      });
      const sortedProducts = Object.entries(productSalesMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));
      setTopProducts(sortedProducts);

      // Chart 3: Employee Performance
      const empSalesMap: Record<string, number> = {};
      currentSales.forEach(sale => {
        if (sale.type === 'مرتجع') return;
        empSalesMap[sale.createdBy] = (empSalesMap[sale.createdBy] || 0) + sale.totalAmount;
      });
      const sortedEmps = Object.entries(empSalesMap)
        .map(([name, total]) => ({ name, total }));
      setEmployeePerformance(sortedEmps);
    };

    const unsubSales = DataService.subscribeToSales(sales => {
        currentSales = sales;
        updateDashboard();
    });

    const unsubProducts = DataService.subscribeToProducts(products => {
        currentProducts = products;
        updateDashboard();
    });

    return () => {
        unsubSales();
        unsubProducts();
    };
  }, []);

  return (
    <div className="p-6 space-y-6">
      <header className="mb-8">
        <h2 className="text-3xl font-bold text-slate-800">لوحة التحكم</h2>
        <p className="text-slate-500">نظرة عامة على أداء طيبة سنتر</p>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="مبيعات اليوم" 
          value={`${stats.dailySales} د.ل`} 
          icon={<DollarSign className="text-white" />} 
          color="bg-emerald-500" 
        />
        <StatCard 
          title="إجمالي الأرباح" 
          value={`${stats.totalProfit} د.ل`} 
          icon={<TrendingUp className="text-white" />} 
          color="bg-blue-500" 
        />
        <StatCard 
          title="تنبيهات المخزون" 
          value={`${stats.lowStockCount} منتج`} 
          icon={<AlertTriangle className="text-white" />} 
          color="bg-red-500" 
          alert={stats.lowStockCount > 0}
        />
        <StatCard 
          title="إجمالي الأصناف" 
          value={`${stats.totalProducts}`} 
          icon={<Package className="text-white" />} 
          color="bg-purple-500" 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
        {/* Sales Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold mb-4 text-slate-700">تحليل المبيعات (آخر 7 أيام)</h3>
          <div style={{ width: '100%', height: 300, minHeight: 300 }}>
            <ResponsiveContainer width="99%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    cursor={{fill: '#f1f5f9'}}
                />
                <Bar dataKey="sales" fill="#0d9488" radius={[4, 4, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top Products */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <h3 className="text-lg font-bold mb-4 text-slate-700 flex items-center gap-2">
                <Package size={20} />
                المنتجات الأكثر مبيعاً
            </h3>
            <div className="space-y-4">
                {topProducts.map((p, idx) => {
                    const maxCount = topProducts.length > 0 ? topProducts[0].count : 1;
                    return (
                    <div key={idx} className="flex items-center justify-between">
                        <span className="text-slate-600 font-medium">{idx + 1}. {p.name}</span>
                        <div className="flex items-center gap-2">
                            <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-primary" 
                                    style={{ width: `${(p.count / maxCount) * 100}%` }}
                                ></div>
                            </div>
                            <span className="text-xs font-bold text-slate-500 w-8">{p.count}</span>
                        </div>
                    </div>
                    );
                })}
            </div>
        </div>

        {/* Employee Performance */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <h3 className="text-lg font-bold mb-4 text-slate-700 flex items-center gap-2">
                <Users size={20} />
                أداء الموظفين (المبيعات)
            </h3>
             <div style={{ width: '100%', height: 200, minHeight: 200 }}>
                <ResponsiveContainer width="99%" height="100%">
                    <BarChart layout="vertical" data={employeePerformance}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                        <XAxis type="number" hide />
                        <YAxis dataKey="name" type="category" width={80} />
                        <Tooltip />
                        <Bar dataKey="total" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={20} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon, color, alert = false }: any) => (
  <div className={`bg-white p-6 rounded-xl shadow-sm border ${alert ? 'border-red-200 ring-2 ring-red-50' : 'border-slate-100'} flex items-center justify-between transition-transform hover:scale-[1.02]`}>
    <div>
      <p className="text-sm font-medium text-slate-500 mb-1">{title}</p>
      <h3 className={`text-2xl font-bold ${alert ? 'text-red-600' : 'text-slate-800'}`}>{value}</h3>
    </div>
    <div className={`h-12 w-12 rounded-lg ${color} flex items-center justify-center shadow-md`}>
      {icon}
    </div>
  </div>
);

export default Dashboard;
