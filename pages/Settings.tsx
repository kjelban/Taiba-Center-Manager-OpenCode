import React, { useState, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { Save, Upload, RotateCcw, CheckCircle, AlertTriangle, Plus, Trash2, List } from 'lucide-react';

const Settings: React.FC = () => {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const [newSeason, setNewSeason] = useState('');

  useEffect(() => {
    loadLists();
  }, []);

  const loadLists = async () => {
    const cats = await DataService.getCategories();
    const seas = await DataService.getSeasons();
    setCategories(cats);
    setSeasons(seas);
  };

  const handleAddCategory = async () => {
    if (newCategory.trim()) {
        await DataService.addCategory(newCategory.trim());
        setNewCategory('');
        loadLists();
    }
  };

  const handleDeleteCategory = async (cat: string) => {
    if (window.confirm(`هل أنت متأكد من حذف القسم "${cat}"؟`)) {
        await DataService.deleteCategory(cat);
        loadLists();
    }
  };

  const handleAddSeason = async () => {
    if (newSeason.trim()) {
        await DataService.addSeason(newSeason.trim());
        setNewSeason('');
        loadLists();
    }
  };

  const handleDeleteSeason = async (season: string) => {
    if (window.confirm(`هل أنت متأكد من حذف الموسم "${season}"؟`)) {
        await DataService.deleteSeason(season);
        loadLists();
    }
  };

  const handleBackup = async () => {
    try {
      const data = await DataService.getAllData();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `taiba_backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setStatusMessage('تم تحميل النسخة الاحتياطية بنجاح.');
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (e) {
      console.error(e);
      alert('فشل النسخ الاحتياطي');
    }
  };

  const handleRestore = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target?.result as string;
      if (content) {
        const success = await DataService.restoreData(content);
        if (success) {
          setStatusMessage('تم استعادة البيانات بنجاح. يرجى تحديث الصفحة.');
          setTimeout(() => window.location.reload(), 2000);
        } else {
          alert('فشل استعادة البيانات. تأكد من صحة الملف.');
        }
      }
    };
    reader.readAsText(file);
  };

  const handleClearData = async () => {
    if (window.confirm('تحذير: هذا سيحذف جميع بيانات التطبيق نهائياً. هل أنت متأكد؟')) {
        await DataService.clearAllData();
        window.location.reload();
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto h-[calc(100vh-64px)] overflow-y-auto">
      <h2 className="text-2xl font-bold text-slate-800 mb-6">الإعدادات</h2>

      {statusMessage && (
        <div className="bg-green-100 text-green-700 p-4 rounded-xl mb-6 flex items-center gap-2 border border-green-200">
          <CheckCircle size={20} />
          {statusMessage}
        </div>
      )}

      <div className="space-y-8">
        
        {/* List Management Section */}
        <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <h3 className="text-lg font-bold text-slate-700 mb-4 border-b border-slate-100 pb-2 flex items-center gap-2">
                <List size={20} />
                إدارة القوائم
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Categories */}
                <div>
                    <h4 className="font-bold text-slate-600 mb-3 text-sm">أقسام المنتجات</h4>
                    <div className="flex gap-2 mb-3">
                        <input 
                            type="text" 
                            className="flex-1 border border-slate-300 rounded-lg p-2 text-sm bg-white text-slate-900 outline-none focus:border-primary"
                            placeholder="اسم القسم الجديد"
                            value={newCategory}
                            onChange={(e) => setNewCategory(e.target.value)}
                        />
                        <button 
                            onClick={handleAddCategory}
                            className="bg-primary hover:bg-secondary text-white p-2 rounded-lg transition-colors"
                        >
                            <Plus size={20} />
                        </button>
                    </div>
                    <div className="bg-slate-50 rounded-lg border border-slate-200 h-48 overflow-y-auto p-2">
                        {categories.map((cat, idx) => (
                            <div key={idx} className="flex justify-between items-center bg-white p-2 mb-2 rounded border border-slate-100 text-sm">
                                <span>{cat}</span>
                                <button onClick={() => handleDeleteCategory(cat)} className="text-slate-400 hover:text-red-500">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Seasons */}
                <div>
                    <h4 className="font-bold text-slate-600 mb-3 text-sm">المواسم</h4>
                    <div className="flex gap-2 mb-3">
                        <input 
                            type="text" 
                            className="flex-1 border border-slate-300 rounded-lg p-2 text-sm bg-white text-slate-900 outline-none focus:border-primary"
                            placeholder="اسم الموسم الجديد"
                            value={newSeason}
                            onChange={(e) => setNewSeason(e.target.value)}
                        />
                        <button 
                            onClick={handleAddSeason}
                            className="bg-primary hover:bg-secondary text-white p-2 rounded-lg transition-colors"
                        >
                            <Plus size={20} />
                        </button>
                    </div>
                    <div className="bg-slate-50 rounded-lg border border-slate-200 h-48 overflow-y-auto p-2">
                        {seasons.map((season, idx) => (
                            <div key={idx} className="flex justify-between items-center bg-white p-2 mb-2 rounded border border-slate-100 text-sm">
                                <span>{season}</span>
                                <button onClick={() => handleDeleteSeason(season)} className="text-slate-400 hover:text-red-500">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>

        {/* Backup & Restore Section */}
        <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-700 mb-4 border-b border-slate-100 pb-2">إدارة البيانات</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-blue-50 p-6 rounded-xl border border-blue-100 flex flex-col items-center text-center">
              <div className="bg-blue-200 p-4 rounded-full text-blue-700 mb-4">
                <Save size={32} />
              </div>
              <h4 className="font-bold text-slate-800 mb-2">نسخ احتياطي</h4>
              <p className="text-sm text-slate-500 mb-6">حفظ جميع بيانات المتجر (المنتجات، المبيعات، الموظفين) في ملف JSON.</p>
              <button 
                onClick={handleBackup}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium w-full transition-colors"
              >
                تنزيل نسخة احتياطية
              </button>
            </div>

            <div className="bg-emerald-50 p-6 rounded-xl border border-emerald-100 flex flex-col items-center text-center">
              <div className="bg-emerald-200 p-4 rounded-full text-emerald-700 mb-4">
                <Upload size={32} />
              </div>
              <h4 className="font-bold text-slate-800 mb-2">استعادة البيانات</h4>
              <p className="text-sm text-slate-500 mb-6">استرجاع البيانات من ملف نسخة احتياطية سابق.</p>
              <label className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg font-medium w-full transition-colors cursor-pointer block">
                <span>اختيار ملف</span>
                <input type="file" accept=".json" onChange={handleRestore} className="hidden" />
              </label>
            </div>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="bg-white p-6 rounded-xl shadow-sm border border-red-100">
          <h3 className="text-lg font-bold text-red-600 mb-4 border-b border-red-100 pb-2 flex items-center gap-2">
            <AlertTriangle size={20} />
            منطقة الخطر
          </h3>
          <div className="flex items-center justify-between">
            <div>
                <h4 className="font-medium text-slate-800">حذف جميع البيانات</h4>
                <p className="text-sm text-slate-500">سيتم حذف المخزون، المبيعات، والموظفين وإعادة التطبيق لحالته الأصلية.</p>
            </div>
            <button 
                onClick={handleClearData}
                className="bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 px-4 py-2 rounded-lg font-medium transition-colors"
            >
                <RotateCcw size={16} className="inline ml-2" />
                إعادة ضبط المصنع
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Settings;