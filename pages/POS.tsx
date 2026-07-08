
import React, { useState, useEffect, useRef } from 'react';
import { Product, CartItem, PaymentMethod, Sale, Employee, Customer, SaleType } from '../types';
import { DataService } from '../services/dataService';
import { Search, ShoppingCart, Trash2, CreditCard, Banknote, Plus, Minus, Check, ScanLine, X, RotateCcw, User, UserPlus, Printer, Clock, Calendar as CalendarIcon, AlertTriangle } from 'lucide-react';
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
            p.name.includes(searchTerm) || 
            p.id.includes(searchTerm) || 
            p.category.includes(searchTerm) ||
            (p.barcode && p.barcode.includes(searchTerm))
        )
    );
  }, [searchTerm, products]);
  
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
            // Set to last day of current month
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
            id: Date.now().toString(),
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
    
    // Products will automatically update via subscription
    setProcessing(false);
  };


  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-64px)] overflow-hidden bg-slate-50 relative">
        <ProductGrid 
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            filteredProducts={filteredProducts}
            addToCart={addToCart}
            onOpenScanner={() => setIsScannerOpen(true)}
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
