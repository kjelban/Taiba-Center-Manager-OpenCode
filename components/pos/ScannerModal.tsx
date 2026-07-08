import React, { useEffect, useRef, useState } from 'react';
import { X, Check } from 'lucide-react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { Product } from '../../types';

interface ScannerModalProps {
    isOpen: boolean;
    onClose: () => void;
    products: Product[];
    onProductScan: (product: Product) => void;
}

const ScannerModal: React.FC<ScannerModalProps> = ({ isOpen, onClose, products, onProductScan }) => {
    const [scanSuccess, setScanSuccess] = useState(false);
    const scannerRef = useRef<Html5QrcodeScanner | null>(null);
    const lastScannedRef = useRef<{ code: string; time: number } | null>(null);
    const productsRef = useRef<Product[]>(products);

    useEffect(() => {
        productsRef.current = products;
    }, [products]);

    useEffect(() => {
        if (isOpen) {
            lastScannedRef.current = null;
            setScanSuccess(false);

            setTimeout(() => {
                if (!document.getElementById('reader')) return;

                if (scannerRef.current) {
                    try {
                        scannerRef.current.clear().catch(() => {});
                    } catch (e) {}
                }

                const scanner = new Html5QrcodeScanner(
                    "reader",
                    { fps: 10, qrbox: { width: 250, height: 150 }, aspectRatio: 1.0, disableFlip: false },
                    false
                );

                scanner.render(onScanSuccess, (err) => {});
                scannerRef.current = scanner;
            }, 100);
        } else {
            if (scannerRef.current) {
                try {
                    scannerRef.current.clear().catch(() => {});
                } catch (e) {}
            }
        }

        return () => {
            if (scannerRef.current) {
                try {
                    scannerRef.current.clear().catch(() => {});
                } catch (e) {}
            }
        };
    }, [isOpen]);

    const onScanSuccess = (decodedText: string) => {
        if (scanSuccess) return;

        const cleanCode = decodedText.trim();
        const now = Date.now();

        if (lastScannedRef.current && lastScannedRef.current.code === cleanCode && (now - lastScannedRef.current.time < 2500)) return;

        lastScannedRef.current = { code: cleanCode, time: now };
        const currentProducts = productsRef.current;
        const product = currentProducts.find(p => (p.barcode && p.barcode.trim() === cleanCode) || p.id === cleanCode);

        if (product) {
            if (product.stock > 0) {
                onProductScan(product);
                const audio = new Audio('https://www.soundjay.com/buttons/sounds/beep-07.mp3');
                audio.play().catch(() => {});
                setScanSuccess(true);
                setTimeout(() => setScanSuccess(false), 1200);
            } else {
                alert('المنتج نفد من المخزون');
            }
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden relative">
                <div className="p-4 border-b flex justify-between items-center bg-white">
                    <h3 className="font-bold text-lg text-slate-800">ماسح الباركود</h3>
                    <button onClick={onClose} className="text-slate-500 hover:text-red-500">
                        <X size={24} />
                    </button>
                </div>
                <style>{`
                    /* Force clean styles for library generated elements */
                    #reader {
                        border: none !important;
                        font-family: 'Tajawal', sans-serif !important;
                    }
                    /* Target all text inside the reader container to be white */
                    #reader * {
                        color: #fff;
                    }
                    /* Override link colors */
                    #reader a {
                        color: #93c5fd !important; /* light blue */
                        text-decoration: underline !important;
                    }
                    /* Specifically target the 'Scan Image' and 'Camera Permission' links/buttons */
                    #reader__dashboard_section_swaplink,
                    #reader__dashboard_section_csr span { 
                         color: #ffffff !important; 
                         font-weight: bold !important;
                    }
                    /* Ensure select dropdowns are readable */
                    #reader select {
                        background-color: #ffffff !important;
                        color: #000000 !important;
                        border: 1px solid #ccc !important;
                        padding: 4px !important;
                        border-radius: 4px !important;
                    }
                    /* Ensure the scan region is black */
                    #reader__scan_region {
                        background: #000 !important;
                    }
                `}</style>
                <div className="p-0 relative bg-black min-h-[350px] flex items-center justify-center">
                    <div id="reader" className="w-full"></div>
                    {scanSuccess && (
                        <div className="absolute inset-0 z-50 flex items-center justify-center bg-green-500/50 backdrop-blur-sm">
                            <div className="bg-white rounded-full p-6">
                                <Check size={64} className="text-green-600" />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ScannerModal;
