import React from 'react';
import { Plus, Search, ScanLine, PackagePlus } from 'lucide-react';
import { Product } from '../../types';

interface ProductGridProps {
    searchTerm: string;
    setSearchTerm: (term: string) => void;
    filteredProducts: Product[];
    addToCart: (product: Product) => void;
    onOpenScanner: () => void;
    onAddManualItem: () => void;
}

const ProductGrid: React.FC<ProductGridProps> = ({
    searchTerm,
    setSearchTerm,
    filteredProducts,
    addToCart,
    onOpenScanner,
    onAddManualItem
}) => {
    return (
        <div className="flex-1 flex flex-col min-h-0">
            {/* Search Header */}
            <div className="p-3 md:p-6 pb-2">
                <div className="flex gap-2">
                    <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-100 flex items-center gap-3 flex-1">
                        <Search className="text-slate-400" size={20} />
                        <input 
                            type="text" 
                            placeholder="بحث..." 
                            className="flex-1 outline-none text-slate-700 bg-transparent text-lg w-full"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button onClick={onOpenScanner} className="bg-slate-800 text-white px-4 rounded-xl flex flex-col items-center justify-center hover:bg-slate-700 transition-colors shadow-sm min-w-[60px]">
                        <ScanLine size={24} />
                        <span className="text-[10px] hidden md:inline">ماسح</span>
                    </button>
                    <button onClick={onAddManualItem} className="bg-emerald-600 text-white px-4 rounded-xl flex flex-col items-center justify-center hover:bg-emerald-700 transition-colors shadow-sm min-w-[60px]">
                        <PackagePlus size={24} />
                        <span className="text-[10px] hidden md:inline">يدوي</span>
                    </button>
                </div>
            </div>

            {/* Product Grid */}
            <div className="flex-1 overflow-y-auto p-3 md:p-6 pt-0">
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {filteredProducts.map(product => (
                        <div key={product.id} onClick={() => product.stock > 0 && addToCart(product)} className={`bg-white p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${product.stock > 0 ? 'hover:shadow-md border-slate-200 hover:border-primary/50' : 'opacity-60 cursor-not-allowed border-slate-100 bg-slate-50'}`}>
                            <div>
                                <div className="flex justify-between items-start mb-1">
                                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{product.size}</span>
                                    <span className="text-[10px] text-slate-400">{product.stock}</span>
                                </div>
                                <h3 className="font-bold text-slate-800 line-clamp-2 leading-tight mb-1 text-sm">{product.name}</h3>
                                <p className="text-[10px] text-slate-500 mb-2 truncate">{product.category} - {product.color}</p>
                            </div>
                            <div className="flex justify-between items-end">
                                <span className="text-base font-bold text-primary">{product.sellingPrice} د.ل</span>
                                <div className="bg-primary/10 text-primary p-1 rounded-lg"><Plus size={14} /></div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ProductGrid;
