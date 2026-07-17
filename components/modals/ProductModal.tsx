import React from 'react';
import { Loader2 } from 'lucide-react';
import { Product } from '../../types';

interface ProductModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (e: React.FormEvent) => void;
    editingProduct: Product | null;
    formData: any;
    setFormData: (data: any) => void;
    categories: string[];
    seasons: string[];
    getAiPriceSuggestion: () => void;
    loadingAi: boolean;
    aiSuggestion: string | null;
}

const ProductModal: React.FC<ProductModalProps> = ({
    isOpen,
    onClose,
    onSave,
    editingProduct,
    formData,
    setFormData,
    categories,
    seasons,
    getAiPriceSuggestion,
    loadingAi,
    aiSuggestion
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true">
                <form onSubmit={onSave} className="p-6">
                    <h3 className="text-xl font-bold mb-6 text-slate-800">
                        {editingProduct ? 'تعديل بيانات المنتج' : 'إضافة منتج جديد'}
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1">اسم المنتج</label>
                            <input required type="text" className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none" 
                                value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} aria-label="اسم المنتج" />
                        </div>
                        
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">القسم</label>
                            <select className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none" 
                                value={formData.category || ''} onChange={e => setFormData({...formData, category: e.target.value})} aria-label="القسم">
                                {categories.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                        </div>
                        
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">الموسم</label>
                            <select className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none" 
                                value={formData.season || ''} onChange={e => setFormData({...formData, season: e.target.value})} aria-label="الموسم">
                                {seasons.map(season => (
                                    <option key={season} value={season}>{season}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">المقاس</label>
                            <input type="text" className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none" 
                                value={formData.size || ''} onChange={e => setFormData({...formData, size: e.target.value})} />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">اللون</label>
                            <input type="text" className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none" 
                                value={formData.color || ''} onChange={e => setFormData({...formData, color: e.target.value})} />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">باركود (اختياري)</label>
                            <input 
                                type="text" 
                                className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none"
                                placeholder="اتركه فارغاً للتوليد التلقائي" 
                                value={formData.barcode || ''} 
                                onChange={e => setFormData({...formData, barcode: e.target.value})} 
                            />
                        </div>
                        
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">الكمية المتوفرة</label>
                            <input required type="number" min="0" className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none" 
                                value={formData.stock || ''} onChange={e => setFormData({...formData, stock: Number(e.target.value)})} aria-label="الكمية المتوفرة" />
                        </div>

                        <div className="bg-blue-50 p-4 rounded-lg md:col-span-2 border border-blue-100">
                            <p className="text-sm font-bold text-blue-800 mb-2">التسعير الذكي</p>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">سعر الشراء (التكلفة)</label>
                                    <input required type="number" min="0" className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none" 
                                        value={formData.purchasePrice || ''} onChange={e => setFormData({...formData, purchasePrice: Number(e.target.value)})} aria-label="سعر الشراء" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">سعر البيع</label>
                                    <input required type="number" min="0" className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none font-bold text-primary" 
                                        value={formData.sellingPrice || ''} onChange={e => setFormData({...formData, sellingPrice: Number(e.target.value)})} aria-label="سعر البيع" />
                                </div>
                            </div>
                            
                            <button 
                                type="button" 
                                onClick={getAiPriceSuggestion}
                                className="mt-3 text-xs bg-white text-blue-600 px-3 py-2 rounded border border-blue-200 shadow-sm flex items-center gap-2 hover:bg-blue-50 transition-colors"
                            >
                                {loadingAi ? <Loader2 className="animate-spin" size={14} /> : <span className="text-lg">✨</span>}
                                اطلب اقتراح سعر من الذكاء الاصطناعي
                            </button>

                            {aiSuggestion && (
                                <div className="mt-2 text-xs text-slate-600 bg-white p-2 rounded border border-slate-200">
                                    {aiSuggestion}
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">حد التنبيه (للكمية المنخفضة)</label>
                            <input required type="number" className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2.5 outline-none" 
                                value={formData.minStockAlert || ''} onChange={e => setFormData({...formData, minStockAlert: Number(e.target.value)})} aria-label="حد التنبيه" />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                        <button 
                            type="button" 
                            onClick={onClose}
                            className="px-6 py-2 rounded-lg text-slate-600 hover:bg-slate-50 font-medium"
                        >
                            إلغاء
                        </button>
                        <button 
                            type="submit" 
                            className="px-6 py-2 rounded-lg bg-primary hover:bg-secondary text-white font-medium shadow-lg shadow-primary/30"
                        >
                            حفظ
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ProductModal;
