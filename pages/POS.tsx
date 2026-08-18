import React, { useState, useEffect, useRef } from 'react';
import { Product, CartItem, PaymentMethod, Sale, Employee, Customer, SaleType } from '../types';
import { DataService } from '../services/dataService';
import { useDebounce } from '../utils/useDebounce';
import { Search, ShoppingCart, Trash2, CreditCard, Banknote, Plus, Minus, Check, ScanLine, X, RotateCcw, User, UserPlus, Printer, Clock, Calendar as CalendarIcon, AlertTriangle, PackagePlus } from 'lucide-react';
import ScannerModal from '../components/pos/ScannerModal';
import ProductGrid from '../components/pos/ProductGrid';
import CartSidebar from '../components/pos/CartSidebar';
import InvoiceModal from '../components/pos/InvoiceModal';
import POSDebtAlertModal from '../components/pos/POSDebtAlertModal';
import { printReceipt } from '../utils/printUtils';

interface POSProps {
    currentUser: Employee | null;
    invoiceToEdit?: Sale | null;
    onClearEdit?: () => void;
}

const POS: React.FC<POSProps> = ({ currentUser, invoiceToEdit, onClearEdit }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 300);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [processing, setProcessing] = useState(false);
  const [lastCompletedSale, setLastCompletedSale] = useState<Sale | null>(null);
  const [dueDate, setDueDate] = useState<string>('');
  
  // Customer State
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isDebtAlertOpen, setIsDebtAlertOpen] = useState(false);
  const [customerUnpaidInvoices, setCustomerUnpaidInvoices] = useState<Sale[]>([]);
  
  // Mobile Cart UI State
  const [isCartExpanded, setIsCartExpanded] = useState(false);

  // Scanner State
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  
  // Manual Item Dialog
  const [showManualDialog, setShowManualDialog] = useState(false);
  const [manualItemName, setManualItemName] = useState('');
  const [manualItemPrice, setManualItemPrice] = useState('');
  const [manualItemPurchasePrice, setManualItemPurchasePrice] = useState('');
  const [manualItemQty, setManualItemQty] = useState('1');

  
  // Ref to hold the latest products list
  const productsRef = useRef<Product[]>([]);

  
  // Date Input Ref
  const dateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubProducts = DataService.subscribeToProducts(data => {
        setProducts(data);
        setFilteredProducts(data);
        productsRef.current = data;
    });
    const unsubCustomers = DataService.subscribeToCustomers(setCustomers);
    
    return () => {
        unsubProducts();
        unsubCustomers();
    };
  }, []);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    if (invoiceToEdit) {
        setCart(invoiceToEdit.items);
        setPaymentMethod(invoiceToEdit.paymentMethod);
        if (invoiceToEdit.dueDate) setDueDate(invoiceToEdit.dueDate.split('T')[0]);
        if (invoiceToEdit.customerId && customers.length > 0) {
            const c = customers.find(x => x.id === invoiceToEdit.customerId);
            if (c) setSelectedCustomer(c);
        }
    } else {
        setCart([]);
        setPaymentMethod(PaymentMethod.CASH);
        setDueDate('');
        setSelectedCustomer(null);
    }
  }, [invoiceToEdit, customers]);

  useEffect(() => {
    setFilteredProducts(
        products.filter(p => 
            p.name.includes(debouncedSearch) || 
            p.id.includes(debouncedSearch) ||
            p.category.includes(debouncedSearch) ||
            (p.barcode && p.barcode.includes(debouncedSearch))
        )
    );
  }, [debouncedSearch, products]);
  
  // check selected customer's debt
  useEffect(() => {
    if (selectedCustomer) {
      DataService.getUnpaidSalesByCustomer(selectedCustomer.id).then(unpaid => {
        setCustomerUnpaidInvoices(unpaid);
        if (unpaid.length > 0) {
          setIsDebtAlertOpen(true);
        } else {
          setIsDebtAlertOpen(false);
        }
      });
    } else {
      setCustomerUnpaidInvoices([]);
      setIsDebtAlertOpen(false);
    }
  }, [selectedCustomer]);


  const addToCart = (product: Product) => {
    setLastCompletedSale(null);
    setCart(prev => {
        const existing = prev.find(item => item.id === product.id);
        if (existing) {
            return prev.map(item => item.id === product.id ? {...item, quantity: item.quantity + 1} : item);
        }
        return [...prev, {...product, quantity: 1}];
    });
  };

  const addManualItem = () => {
    const name = manualItemName.trim();
    const sellPrice = parseFloat(manualItemPrice);
    const buyPrice = parseFloat(manualItemPurchasePrice) || 0;
    const qty = parseInt(manualItemQty) || 1;
    if (!name || !sellPrice || sellPrice <= 0) return;
    setLastCompletedSale(null);
    setCart(prev => [...prev, {
      id: crypto.randomUUID(),
      name,
      category: 'خارج المخزن',
      size: '-',
      color: '-',
      purchasePrice: buyPrice,
      sellingPrice: sellPrice,
      stock: 999,
      minStockAlert: 0,
      season: '-',
      quantity: qty,
      isManualItem: true,
    }]);
    setManualItemName('');
    setManualItemPrice('');
    setManualItemPurchasePrice('');
    setManualItemQty('1');
    setShowManualDialog(false);
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
        if (item.id === id) {
            const newQty = Math.max(1, item.quantity + delta);
            const product = products.find(p => p.id === id);
            if (delta > 0 && product && newQty > product.stock) return item; 
            return {...item, quantity: newQty};
        }
        return item;
    }));
  };

  const setQuickDate = (type: 'week' | '2weeks' | 'month' | 'endMonth') => {
    const date = new Date();
    switch(type) {
        case 'week':
            date.setDate(date.getDate() + 7);
            break;
        case '2weeks':
            date.setDate(date.getDate() + 14);
            break;
        case 'month':
            date.setMonth(date.getMonth() + 1);
            break;
        case 'endMonth':
            const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
            date.setTime(nextMonth.getTime() - 1); 
            break;
    }
    setDueDate(date.toISOString().split('T')[0]);
  };

  const totalAmount = cart.reduce((sum, item) => sum + (item.sellingPrice * item.quantity), 0);

  const handleCheckout = async () => {
    if (cart.length === 0) return;

    // Debt Validation
    if (paymentMethod === PaymentMethod.DEBT) {
        if (!selectedCustomer) {
            alert("يجب اختيار العميل عند البيع بالآجل (الدين)");
            return;
        }
        if (!dueDate) {
            alert("يجب تحديد تاريخ استحقاق الدين");
            return;
        }
    }

    setProcessing(true);

    const totalCost = cart.reduce((sum, item) => sum + (item.purchasePrice * item.quantity), 0);
    const profit = totalAmount - totalCost;

    try {
      if (invoiceToEdit) {
          const updatedSale: Sale = {
              ...invoiceToEdit,
              items: cart,
              totalAmount,
              paymentMethod,
              profit,
              updatedBy: currentUser?.name || 'مجهول',
              updatedAt: new Date().toISOString(),
              customerId: selectedCustomer?.id,
              customerName: selectedCustomer?.name,
              dueDate: paymentMethod === PaymentMethod.DEBT ? new Date(dueDate).toISOString() : undefined,
              isPaid: paymentMethod !== PaymentMethod.DEBT
          };
          await DataService.updateSale(updatedSale);
          setLastCompletedSale(updatedSale);
          setCart([]);
          setSelectedCustomer(null);
          setDueDate('');
          if (onClearEdit) onClearEdit();
      } else {
          const newSale: Sale = {
              id: crypto.randomUUID(),
              type: SaleType.SALE,
              date: new Date().toISOString(),
              items: cart,
              totalAmount,
              paymentMethod,
              profit,
              createdBy: currentUser?.name || 'مجهول',
              customerId: selectedCustomer?.id,
              customerName: selectedCustomer?.name,
              dueDate: paymentMethod === PaymentMethod.DEBT ? new Date(dueDate).toISOString() : undefined,
              isPaid: paymentMethod !== PaymentMethod.DEBT
          };
          await DataService.createSale(newSale);
          setLastCompletedSale(newSale);
          
          setCart([]);
          setSelectedCustomer(null);
          setDueDate('');
      }
    } catch (err: any) {
      console.error('Checkout failed:', err);
      let errorMsg = err.message || 'فشلت عملية البيع';
      try {
        const jsonMatch = errorMsg.match(/\{.*\}$/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.error) errorMsg = parsed.error;
        }
      } catch {}
      alert(errorMsg);
    } finally {
      setProcessing(false);
    }
  };


  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-64px)] overflow-hidden bg-slate-50 relative">
        <ProductGrid 
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            filteredProducts={filteredProducts}
            addToCart={addToCart}
            onOpenScanner={() => setIsScannerOpen(true)}
            onAddManualItem={() => setShowManualDialog(true)}
        />
        <CartSidebar 
            isCartExpanded={isCartExpanded}
            customers={customers}
            selectedCustomer={selectedCustomer}
            setSelectedCustomer={setSelectedCustomer}
            customerUnpaidInvoices={customerUnpaidInvoices}
            setIsDebtAlertOpen={setIsDebtAlertOpen}
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
            dueDate={dueDate}
            setDueDate={setDueDate}
            setQuickDate={setQuickDate}
            cart={cart}
            updateQuantity={updateQuantity}
            removeFromCart={removeFromCart}
            totalAmount={totalAmount}
            processing={processing}
            handleCheckout={handleCheckout}
            invoiceToEdit={invoiceToEdit}
        />
        <InvoiceModal 
            sale={lastCompletedSale}
            onClose={() => setLastCompletedSale(null)}
            onPrint={printReceipt}
        />
        <ScannerModal 
            isOpen={isScannerOpen} 
            onClose={() => setIsScannerOpen(false)} 
            products={products}
            onProductScan={(product) => addToCart(product)}
        />

        {showManualDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowManualDialog(false)}>
                <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
                    <h3 className="text-lg font-bold text-slate-800 mb-4">إضافة صنف خارج المخزن</h3>
                    <div className="space-y-3">
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">اسم الصنف</label>
                            <input type="text" value={manualItemName} onChange={e => setManualItemName(e.target.value)}
                                className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:border-emerald-400 transition-colors text-sm" 
                                placeholder="مثال: كرتون ماء" autoFocus />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">سعر الشراء</label>
                            <input type="number" value={manualItemPurchasePrice} onChange={e => setManualItemPurchasePrice(e.target.value)}
                                className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:border-emerald-400 transition-colors text-sm" 
                                placeholder="0" min="0" step="0.01" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">سعر البيع</label>
                            <input type="number" value={manualItemPrice} onChange={e => setManualItemPrice(e.target.value)}
                                className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:border-emerald-400 transition-colors text-sm" 
                                placeholder="0" min="0" step="0.01" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">الكمية</label>
                            <input type="number" value={manualItemQty} onChange={e => setManualItemQty(e.target.value)}
                                className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:border-emerald-400 transition-colors text-sm" 
                                placeholder="1" min="1" />
                        </div>
                    </div>
                    <div className="flex gap-2 mt-5">
                        <button onClick={() => setShowManualDialog(false)}
                            className="flex-1 p-2.5 border border-slate-200 rounded-xl text-slate-600 font-medium hover:bg-slate-50 transition-colors text-sm">إلغاء</button>
                        <button onClick={addManualItem}
                            className="flex-1 p-2.5 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors text-sm shadow-lg shadow-emerald-600/20">إضافة</button>
                    </div>
                </div>
            </div>
        )}
        
        <POSDebtAlertModal 
            isOpen={isDebtAlertOpen}
            onClose={() => setIsDebtAlertOpen(false)}
            customer={selectedCustomer}
            unpaidInvoices={customerUnpaidInvoices}
        />
    </div>
  );
};

export default POS;
