import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default class ErrorBoundary extends React.Component<Props, { hasError: boolean; error?: Error }> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): { hasError: boolean; error?: Error } {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center h-full p-10 text-center">
          <div className="bg-red-100 p-4 rounded-full mb-4">
            <AlertTriangle size={40} className="text-red-500" />
          </div>
          <h3 className="text-xl font-bold text-slate-800 mb-2">حدث خطأ غير متوقع</h3>
          <p className="text-slate-500 text-sm mb-4 max-w-md">
            {this.state.error?.message || 'نأسف للإزعاج، يرجى المحاولة مرة أخرى.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 bg-primary text-white px-6 py-2 rounded-lg hover:bg-secondary transition-colors"
          >
            <RefreshCw size={18} />
            إعادة تحميل
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
