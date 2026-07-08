import { Sale, SaleType, PaymentMethod } from '../types';

export const printReceipt = (sale: Sale) => {
    const printWindow = window.open('', '', 'width=350,height=700');
    if (!printWindow) return;

    const formattedDate = new Date(sale.date).toLocaleDateString('ar-LY', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    const formattedTime = new Date(sale.date).toLocaleTimeString('ar-LY', {
        hour: '2-digit',
        minute: '2-digit'
    });
    const isReturn = sale.type === SaleType.RETURN;
    const isDebt = sale.paymentMethod === PaymentMethod.DEBT;

    printWindow.document.write(`
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>فاتورة #${sale.id}</title>
            <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
            <style>
                body {
                    font-family: 'Tajawal', sans-serif;
                    padding: 15px;
                    font-size: 13px;
                    width: 80mm;
                    margin: 0 auto;
                    color: #222;
                    background: #fff;
                }
                .logo-container {
                    text-align: center;
                    margin-bottom: 12px;
                }
                .store-title {
                    font-size: 24px;
                    font-weight: 800;
                    margin: 0;
                    color: #0d9488;
                    letter-spacing: -0.5px;
                }
                .store-subtitle {
                    font-size: 13px;
                    font-weight: 500;
                    color: #4b5563;
                    margin: 4px 0 0px 0;
                }
                .store-meta {
                    font-size: 11px;
                    color: #6b7280;
                    margin: 3px 0 0 0;
                }
                .divider {
                    border-top: 2px dashed #e5e7eb;
                    margin: 12px 0;
                }
                .double-divider {
                    border-top: 4px double #e5e7eb;
                    margin: 12px 0;
                }
                .receipt-type {
                    text-align: center;
                    font-weight: 800;
                    font-size: 16px;
                    background: #f3f4f6;
                    padding: 6px;
                    border-radius: 6px;
                    margin: 8px 0;
                    color: ${isReturn ? '#dc2626' : '#1f2937'};
                }
                .meta-table {
                    width: 100%;
                    font-size: 12px;
                    border-collapse: collapse;
                    margin-bottom: 8px;
                }
                .meta-table td {
                    padding: 4px 0;
                    vertical-align: top;
                }
                .meta-label {
                    color: #4b5563;
                    font-weight: 500;
                    width: 90px;
                }
                .meta-value {
                    color: #111827;
                    font-weight: 700;
                    text-align: left;
                }
                .items-table {
                    width: 100%;
                    border-collapse: collapse;
                    text-align: right;
                    font-size: 12px;
                    margin-top: 10px;
                }
                .items-table th {
                    border-bottom: 2px solid #111827;
                    padding-bottom: 6px;
                    color: #111827;
                    font-weight: 800;
                }
                .items-table td {
                    padding: 8px 0;
                    border-bottom: 1px dashed #e5e7eb;
                }
                .item-name {
                    font-weight: 700;
                    font-size: 13px;
                    color: #111827;
                    margin-bottom: 2px;
                }
                .item-desc {
                    font-size: 10px;
                    color: #6b7280;
                }
                .pricing-summary {
                    margin-top: 16px;
                }
                .pricing-row {
                    display: flex;
                    justify-content: space-between;
                    padding: 4px 0;
                    font-size: 13px;
                }
                .pricing-row.total {
                    font-size: 18px;
                    font-weight: 800;
                    color: #0d9488;
                    border-top: 2px solid #111827;
                    padding-top: 8px;
                    margin-top: 8px;
                }
                .debt-box {
                    margin-top: 16px;
                    background: #fff7ed;
                    border: 1px solid #fdba74;
                    padding: 10px;
                    border-radius: 8px;
                    font-size: 12px;
                    color: #c2410c;
                    text-align: center;
                }
                .payment-box {
                    margin-top: 16px;
                    background: #f0fdfa;
                    padding: 10px;
                    border-radius: 8px;
                    font-size: 12px;
                    color: #0f766e;
                    text-align: center;
                    font-weight: 700;
                }
                .debt-status-paid {
                    margin-top: 16px;
                    background: #f0fdf4;
                    border: 1px solid #86efac;
                    padding: 10px;
                    border-radius: 8px;
                    font-size: 12px;
                    color: #166534;
                    text-align: center;
                }
                .qr-section {
                    text-align: center;
                    margin-top: 20px;
                }
                .qr-image {
                    width: 100px;
                    height: 100px;
                    margin: 0 auto;
                    display: block;
                }
                .footer {
                    text-align: center;
                    font-size: 11px;
                    color: #4b5563;
                    margin-top: 12px;
                }
            </style>
        </head>
        <body onload="window.print()">
            <div class="logo-container">
                <h1 class="store-title">مركز طيبة للتسوق</h1>
                <div class="store-subtitle">أزياء راقية - أحذية - حقائب</div>
                <div class="store-meta">العنوان: شارع عمر المختار - بجوار المصرف</div>
                <div class="store-meta">هاتف: 0921234567</div>
            </div>

            <div class="divider"></div>
            
            <div class="receipt-type">
                ${isReturn ? 'إيصال مرتجع بضاعة' : 'فاتورة مبيعات مبسطة'}
            </div>

            <table class="meta-table">
                <tr>
                    <td class="meta-label">رقم الفاتورة:</td>
                    <td class="meta-value">#${sale.id}</td>
                </tr>
                <tr>
                    <td class="meta-label">تاريخ الإصدار:</td>
                    <td class="meta-value">${formattedDate}</td>
                </tr>
                <tr>
                    <td class="meta-label">وقت الإصدار:</td>
                    <td class="meta-value">${formattedTime}</td>
                </tr>
                <tr>
                    <td class="meta-label">الموظف:</td>
                    <td class="meta-value">${sale.createdBy}</td>
                </tr>
                <tr>
                    <td class="meta-label">العميل:</td>
                    <td class="meta-value">${sale.customerName || 'عميل سريع'}</td>
                </tr>
                <tr>
                    <td class="meta-label">طريقة الدفع:</td>
                    <td class="meta-value">${sale.paymentMethod}</td>
                </tr>
            </table>

            <div class="divider"></div>

            <table class="items-table">
                <thead>
                    <tr>
                        <th style="text-align: right;">الصنف</th>
                        <th style="text-align: center; width: 40px;">الكمية</th>
                        <th style="text-align: left; width: 60px;">السعر</th>
                        <th style="text-align: left; width: 70px;">الإجمالي</th>
                    </tr>
                </thead>
                <tbody>
                    ${sale.items.map(item => `
                        <tr>
                            <td>
                                <div class="item-name">${item.name}</div>
                                <div class="item-desc">مقاس: ${item.size || '-'} | لون: ${item.color || '-'}</div>
                            </td>
                            <td style="text-align: center; font-weight: 500;">${item.quantity}</td>
                            <td style="text-align: left; color: #4b5563;">${item.sellingPrice}</td>
                            <td style="text-align: left; font-weight: 700;">${Math.abs(item.sellingPrice * item.quantity)} د.ل</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="pricing-summary">
                <div class="pricing-row">
                    <span>المجموع الفرعي:</span>
                    <span style="font-weight: 500;">${Math.abs(sale.totalAmount)} د.ل</span>
                </div>
                <div class="pricing-row total">
                    <span>الإجمالي النهائي:</span>
                    <span>${Math.abs(sale.totalAmount)} د.ل</span>
                </div>
            </div>

            ${isDebt ? (
                sale.isPaid ? `
                    <div class="debt-status-paid">
                        <strong>حالة الدين:</strong> تم سداد الدين بالكامل في 
                        ${sale.paidAt ? new Date(sale.paidAt).toLocaleDateString('ar-LY') : 'تاريخ غير محدد'}
                    </div>
                ` : `
                    <div class="debt-box">
                        <strong>حالة الدين:</strong> هذه الفاتورة مطلوبة للدفع (آجل)<br/>
                        تاريخ الاستحقاق: ${sale.dueDate ? new Date(sale.dueDate).toLocaleDateString('ar-LY') : 'غير محدد'}
                    </div>
                `
            ) : `
                <div class="payment-box">
                    شكراً لشرائكم من طيبة سنتر! نرجو أن تنال المنتجات رضاكم.
                </div>
            `}

            <div class="qr-section">
                <img class="qr-image" src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${sale.id}" alt="QR code" />
                <p style="font-family: monospace; font-size: 10px; color: #6b7280; margin: 4px 0 0 0; letter-spacing: 1.5px;">* ${sale.id} *</p>
            </div>

            <div class="double-divider"></div>

            <div class="footer">
                <strong>شروط وقوانين الاسترجاع:</strong>
                <p style="margin: 4px 0;">* الاستبدال أو الاسترجاع يتم خلال 3 أيام من تاريخ الشراء.</p>
                <p style="margin: 4px 0;">* يشترط إحضار الفاتورة الأصلية وسلامة البضاعة في علبتها وتحت الملصق الخاص بها.</p>
                <p style="margin: 8px 0 0 0; font-weight: 700; color: #0d9488;">دمتم وعائلتكم بأفضل صحة وحال</p>
            </div>
        </body>
        </html>
    `);
    printWindow.document.close();
};
