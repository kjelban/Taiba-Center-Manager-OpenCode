import React, { useState, useEffect, useRef } from 'react';
import { Product } from '../types';
import { DataService } from '../services/dataService';
import ProductModal from '../components/modals/ProductModal';
import { GeminiService } from '../services/geminiService';
import { Search, Plus, Edit2, Trash, AlertCircle, Loader2, Printer } from 'lucide-react';
import Barcode from 'react-barcode';

const Inventory: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState('');
  
  // Lists
  const [categories, setCategories] = useState<string[]>([]);
  const [seasons, setSeasons] = useState<string[]>([]);

  // Form State
  const [formData, setFormData] = useState<Partial<Product>>({
    name: '', category: '', size: '', color: '', purchasePrice: 0, sellingPrice: 0, stock: 0, minStockAlert: 5, season: 'عام', barcode: ''
  });

  useEffect(() => {
    const unsubProducts = DataService.subscribeToProducts(setProducts);
    loadLists();
    return () => {
        unsubProducts();
    };
  }, []);

  const loadLists = async () => {
    const cats = await DataService.getCategories();
    const seas = await DataService.getSeasons();
    setCategories(cats);
    setSeasons(seas);
    // Set default category if not set
    if (!formData.category && cats.length > 0) {
        setFormData(prev => ({...prev, category: cats[0]}));
    }
  };

  const filteredProducts = products.filter(p => 
    p.name.includes(searchTerm) || 
    p.category.includes(searchTerm) ||
    p.id.includes(searchTerm) ||
    (p.barcode && p.barcode.includes(searchTerm))
  );

  const handleOpenModal = (product?: Product) => {
    if (product) {
      setEditingProduct(product);
      setFormData(product);
    } else {
      setEditingProduct(null);
      setFormData({
        name: '', category: categories[0] || '', size: '', color: '', purchasePrice: 0, sellingPrice: 0, stock: 0, minStockAlert: 5, season: 'عام', barcode: ''
      });
    }
    setAiSuggestion('');
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const productId = editingProduct ? editingProduct.id : Date.now().toString();
    const productToSave: Product = {
        id: productId,
        name: formData.name!,
        category: formData.category!,
        size: formData.size!,
        color: formData.color!,
        purchasePrice: Number(formData.purchasePrice),
        sellingPrice: Number(formData.sellingPrice),
        stock: Number(formData.stock),
        minStockAlert: Number(formData.minStockAlert),
        season: formData.season || 'عام',
        // If barcode is empty, use ID as barcode
        barcode: formData.barcode || productId
    };

    await DataService.saveProduct(productToSave);
    setIsModalOpen(false);
    loadProducts();
  };

  const getAiPriceSuggestion = async () => {
    if (!formData.name || !formData.purchasePrice) return;
    setLoadingAi(true);
    const suggestion = await GeminiService.suggestPrice(
        formData.name, 
        Number(formData.purchasePrice), 
        formData.season || 'عام'
    );
    setAiSuggestion(suggestion);
    setLoadingAi(false);
  };

  // Function to open print window for barcode
  const handlePrintBarcode = (product: Product) => {
    const printWindow = window.open('', '', 'width=400,height=400');
    if (printWindow) {
      const barcodeValue = product.barcode || product.id;
      printWindow.document.write(`
        <html>
          <head>
            <title>طباعة باركود - ${product.name}</title>
            <style>
              body { font-family: 'Tajawal', sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; text-align: center; }
              .label { border: 1px dashed #ccc; padding: 10px; border-radius: 8px; width: 100%; max-width: 300px; }
              h3 { margin: 5px 0; font-size: 16px; }
              p { margin: 5px 0; font-size: 14px; color: #555; }
              .price { font-weight: bold; font-size: 18px; margin-top: 5px; }
            </style>
            <!-- Load React and ReactDOM from CDN for simple rendering inside print window -->
             <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.0/dist/JsBarcode.all.min.js"></script>
          </head>
          <body>
            <div class="label">
              <h3>طيبة سنتر</h3>
              <p>${product.name}</p>
              <p>${product.size} | ${product.color}</p>
              <svg id="barcode"></svg>
              <div class="price">${product.sellingPrice} د.ل</div>
            </div>
            <script>
              JsBarcode("#barcode", "${barcodeValue}", {
                format: "CODE128",
                width: 2,
                height: 50,
                displayValue: true
              });
              window.print();
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  return (
    <div className="p-6 h-[calc(100vh-64px)] overflow-hidden flex flex-col">
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <div>
            <h2 className="text-2xl font-bold text-slate-800">إدارة المخزون</h2>
            <p className="text-slate-500 text-sm">إدارة المنتجات، الكميات، وتسعير الأصناف</p>
        </div>
        <button 
          onClick={() => handleOpenModal()}
          className="bg-primary hover:bg-secondary text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
        >
          <Plus size={18} />
          <span>إضافة منتج جديد</span>
        </button>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center gap-3 mb-6">
        <Search className="text-slate-400" size={20} />
        <input 
          type="text" 
          placeholder="بحث باسم المنتج، الصنف، الرقم أو الباركود..." 
          className="flex-1 outline-none text-slate-700 bg-transparent"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-auto bg-white rounded-xl shadow-sm border border-slate-100">
        <table className="w-full text-right">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr>
              <th className="p-4 text-slate-500 font-medium text-sm">المنتج</th>
              <th className="p-4 text-slate-500 font-medium text-sm">القسم</th>
              <th className="p-4 text-slate-500 font-medium text-sm">المواصفات</th>
              <th className="p-4 text-slate-500 font-medium text-sm">سعر البيع</th>
              <th className="p-4 text-slate-500 font-medium text-sm">المخزون</th>
              <th className="p-4 text-slate-500 font-medium text-sm">باركود</th>
              <th className="p-4 text-slate-500 font-medium text-sm">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredProducts.map(product => (
              <tr key={product.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="p-4 font-medium text-slate-800">{product.name}</td>
                <td className="p-4 text-slate-600">{product.category}</td>
                <td className="p-4 text-slate-500 text-sm">
                    <span className="bg-slate-100 px-2 py-1 rounded text-xs ml-1">{product.size}</span>
                    <span className="bg-slate-100 px-2 py-1 rounded text-xs">{product.color}</span>
                </td>
                <td className="p-4 font-bold text-primary">{product.sellingPrice}</td>
                <td className="p-4">
                  <div className={`flex items-center gap-2 ${product.stock <= product.minStockAlert ? 'text-red-600 font-bold' : 'text-slate-600'}`}>
                    {product.stock}
                    {product.stock <= product.minStockAlert && <AlertCircle size={14} />}
                  </div>
                </td>
                <td className="p-4">
                    <div className="opacity-50 hover:opacity-100 transition-opacity">
                        <Barcode value={product.barcode || product.id} height={20} width={1} displayValue={false} />
                    </div>
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <button 
                        onClick={() => handlePrintBarcode(product)}
                        className="text-slate-400 hover:text-slate-700 bg-slate-100 p-2 rounded-full transition-colors"
                        title="طباعة باركود"
                    >
                        <Printer size={16} />
                    </button>
                    <button 
                        onClick={() => handleOpenModal(product)}
                        className="text-slate-400 hover:text-primary transition-colors p-1"
                    >
                        <Edit2 size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredProducts.length === 0 && (
            <div className="p-12 text-center text-slate-400">
                لا توجد منتجات مطابقة للبحث
            </div>
        )}
      </div>

      <ProductModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSave}
        editingProduct={editingProduct}
        formData={formData}
        setFormData={setFormData}
        categories={categories}
        seasons={seasons}
        getAiPriceSuggestion={getAiPriceSuggestion}
        loadingAi={loadingAi}
        aiSuggestion={aiSuggestion}
      />
    </div>
  );
};

export default Inventory;