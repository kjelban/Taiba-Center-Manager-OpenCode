import React, { useRef } from 'react';
import { ShoppingCart, Trash2, CreditCard, Banknote, Plus, Minus, User, AlertTriangle, Clock, Calendar as CalendarIcon, Check } from 'lucide-react';
import { Customer, CartItem, PaymentMethod, Sale } from '../../types';

interface CartSidebarProps {
    isCartExpanded: boolean;
    customers: Customer[];
    selectedCustomer: Customer | null;
    setSelectedCustomer: (customer: Customer | null) => void;
    customerUnpaidInvoices: Sale[];
    setIsDebtAlertOpen: (isOpen: boolean) => void;
    paymentMethod: PaymentMethod;
    setPaymentMethod: (method: PaymentMethod) => void;
    dueDate: string;
    setDueDate: (date: string) => void;
    setQuickDate: (type: 'week' | '2weeks' | 'month' | 'endMonth') => void;
    cart: CartItem[];
    updateQuantity: (id: string, delta: number) => void;
    removeFromCart: (id: string) => void;
    totalAmount: number;
    processing: boolean;
    handleCheckout: () => void;
    invoiceToEdit?: Sale | null;
}

const CartSidebar: React.FC<CartSidebarProps> = ({
    isCartExpanded,
    customers,
    selectedCustomer,
    setSelectedCustomer,
    customerUnpaidInvoices,
    setIsDebtAlertOpen,
    paymentMethod,
    setPaymentMethod,
    dueDate,
    setDueDate,
    setQuickDate,
    cart,
    updateQuantity,
    removeFromCart,
    totalAmount,
    processing,
    handleCheckout,
    invoiceToEdit
}) => {
    const dateInputRef = useRef<HTMLInputElement>(null);

    return (
        <div className={`bg-white border-t md:border-t-0 md:border-r border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] md:shadow-xl flex flex-col z-20 w-full md:w-96 transition-[height] duration-300 ease-in-out ${isCartExpanded ? 'h-[85vh]' : 'h-[60vh]'} md:h-full md:static`}>
            {/* Customer Selection */}
            <div className="p-3 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-2">
                    <User size={18} className="text-slate-400" />
                    <select 
                        className="flex-1 bg-transparent outline-none text-sm text-slate-700"
                        value={selectedCustomer?.id || ''}
                        onChange={(e) => {
                            const c = customers.find(x => x.id === e.target.value);
                            setSelectedCustomer(c || null);
                        }}
                    >
                        <option value="">عميل عام (غير مسجل)</option>
                        {customers.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                </div>
                
                {selectedCustomer && customerUnpaidInvoices.length > 0 && (
                    <div className="mt-2 bg-rose-50 border border-rose-100 rounded-lg p-2 flex items-center justify-between text-rose-800 text-xs animate-in fade-in duration-200">
                        <div className="flex items-center gap-1.5 font-bold">
                            <AlertTriangle size={14} className="text-rose-600 animate-pulse" />
                            <span>مستحقات معلقة: {customerUnpaidInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0)} د.ل ({customerUnpaidInvoices.length} فواتير)</span>
                        </div>
                        <button 
                            type="button" 
                            onClick={() => setIsDebtAlertOpen(true)}
                            className="bg-rose-100 hover:bg-rose-200 text-rose-900 px-2 py-1 rounded font-bold transition-colors cursor-pointer"
                        >
                            تفاصيل
                        </button>
                    </div>
                )}
                
                {/* Enhanced Debt Date Selection */}
                {paymentMethod === PaymentMethod.DEBT && (
                    <div className="mt-3 bg-orange-50 border border-orange-200 rounded-xl p-3 animate-in slide-in-from-top-2">
                        <div className="flex items-center gap-2 mb-2 text-orange-800 font-bold text-xs">
                            <Clock size={14} />
                            <span>تاريخ استحقاق الدين</span>
                        </div>
                        
                        {/* Quick Action Buttons */}
                        <div className="grid grid-cols-2 gap-2 mb-2">
                            <button onClick={() => setQuickDate('week')} className="text-xs bg-white border border-orange-200 text-orange-700 py-1.5 rounded hover:bg-orange-100 transition-colors">بعد أسبوع</button>
                            <button onClick={() => setQuickDate('2weeks')} className="text-xs bg-white border border-orange-200 text-orange-700 py-1.5 rounded hover:bg-orange-100 transition-colors">بعد أسبوعين</button>
                            <button onClick={() => setQuickDate('month')} className="text-xs bg-white border border-orange-200 text-orange-700 py-1.5 rounded hover:bg-orange-100 transition-colors">بعد شهر</button>
                            <button onClick={() => setQuickDate('endMonth')} className="text-xs bg-white border border-orange-200 text-orange-700 py-1.5 rounded hover:bg-orange-100 transition-colors">نهاية الشهر</button>
                        </div>

                        {/* Calendar Input Container */}
                        <div className="relative">
                            <div className="flex items-center gap-2 bg-white border border-orange-200 rounded-lg p-2.5 cursor-pointer hover:border-orange-400 transition-colors">
                                <CalendarIcon size={18} className="text-orange-500" />
                                <span className={`flex-1 text-sm ${dueDate ? 'text-slate-900 font-bold' : 'text-slate-400'}`}>
                                    {dueDate || 'اضغط لاختيار التاريخ'}
                                </span>
                            </div>
                            <input 
                                ref={dateInputRef}
                                type="date" 
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                value={dueDate}
                                onChange={e => setDueDate(e.target.value)}
                                min={new Date().toISOString().split('T')[0]}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Cart Items */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50/50">
                {cart.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                        <ShoppingCart size={32} className="mb-2 opacity-20" />
                        <p className="text-sm">السلة فارغة</p>
                    </div>
                ) : (
                    cart.map(item => (
                        <div key={item.id} className="flex justify-between items-center bg-white p-2 rounded-lg border border-slate-100 shadow-sm">
                            <div className="flex-1 ml-2">
                                <div className="flex items-center gap-2">
                                    <h4 className="font-bold text-slate-800 text-sm line-clamp-1">{item.name}</h4>
                                    {item.isManualItem && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">خارج المخزن</span>}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                    <span>{item.sellingPrice} د.ل</span>
                                    <span className="text-slate-300">|</span>
                                    <span>الإجمالي: {item.sellingPrice * item.quantity}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1 bg-slate-50 rounded-lg border border-slate-200 p-0.5">
                                    <button onClick={() => updateQuantity(item.id, -1)} className="p-1.5 hover:bg-slate-200 rounded text-slate-600"><Minus size={12}/></button>
                                    <span className="text-xs font-bold w-5 text-center">{item.quantity}</span>
                                    <button onClick={() => updateQuantity(item.id, 1)} className="p-1.5 hover:bg-slate-200 rounded text-slate-600"><Plus size={12}/></button>
                                </div>
                                <button onClick={() => removeFromCart(item.id)} className="text-red-400 hover:text-red-600 p-1.5"><Trash2 size={16} /></button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Footer */}
            <div className="p-4 bg-white border-t border-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10">
                <div className="flex justify-between text-xl font-bold text-slate-900 mb-3">
                    <span>الإجمالي</span>
                    <span className="text-primary">{totalAmount} د.ل</span>
                </div>
                <div className="grid grid-cols-3 gap-1 mb-3">
                    <button onClick={() => setPaymentMethod(PaymentMethod.CASH)} className={`p-2 rounded-lg border flex flex-col items-center justify-center gap-1 transition-all ${paymentMethod === PaymentMethod.CASH ? 'bg-primary/10 border-primary text-primary font-bold' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                        <Banknote size={18} /> <span className="text-[10px]">نقدي</span>
                    </button>
                    <button onClick={() => setPaymentMethod(PaymentMethod.CARD)} className={`p-2 rounded-lg border flex flex-col items-center justify-center gap-1 transition-all ${paymentMethod === PaymentMethod.CARD ? 'bg-primary/10 border-primary text-primary font-bold' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                        <CreditCard size={18} /> <span className="text-[10px]">بطاقة</span>
                    </button>
                    <button onClick={() => setPaymentMethod(PaymentMethod.DEBT)} className={`p-2 rounded-lg border flex flex-col items-center justify-center gap-1 transition-all ${paymentMethod === PaymentMethod.DEBT ? 'bg-orange-100 border-orange-500 text-orange-700 font-bold' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                        <Clock size={18} /> <span className="text-[10px]">آجل (دين)</span>
                    </button>
                </div>
                <button 
                    className={`w-full py-3.5 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all shadow-lg ${cart.length === 0 ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none' : 'bg-primary hover:bg-primary/90 text-white shadow-primary/25 hover:shadow-primary/40'}`}
                    disabled={cart.length === 0 || processing || (paymentMethod === PaymentMethod.DEBT && !dueDate)}
                    onClick={handleCheckout}
                >
                    {processing ? (
                        <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                        <>
                            <Check size={24} />
                            {invoiceToEdit ? 'تحديث الفاتورة' : 'إتمام البيع'}
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};

export default CartSidebar;
