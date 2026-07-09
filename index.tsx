import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Global error handler for uncaught errors
window.addEventListener('error', (event) => {
  event.preventDefault();
  event.stopPropagation();

  // Ignore known external errors (browser extensions / Chrome AI features)
  const msg = event.message || '';
  if (msg.includes('image.png') || msg.includes('model does not support image input')) {
    console.log('Ignored external error:', msg);
    return;
  }

  const errDiv = document.createElement('div');
  errDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#fee2e2;color:#991b1b;padding:20px;font-family:monospace;font-size:14px;z-index:99999;border-bottom:4px solid #ef4444;max-height:100vh;overflow:auto';
  const isJsError = event instanceof ErrorEvent;
  const targetEl = event.target as HTMLElement;
  const targetTag = targetEl?.tagName || '';
  const targetSrc = (targetEl as any)?.src || (targetEl as any)?.href || '';
  const stack = event.error?.stack || event.error?.toString() || '';
  const details = [
    `الرسالة: ${event.message}`,
    `نوع الخطأ: ${isJsError ? 'JavaScript Error' : 'Resource Error'}`,
    `الهدف: ${targetTag} ${targetSrc}`,
    `المصدر: ${event.filename || 'N/A'}:${event.lineno || '?'}:${event.colno || '?'}`,
    `حدث: ${event.type}`,
    `event.error: ${event.error ? 'موجود' : 'غير موجود'}`,
    `event.target: ${targetEl ? 'موجود' : 'غير موجود'}`,
    '',
    'Stack Traces:',
    stack || 'لا يوجد Stack'
  ].join('\n');
  errDiv.innerHTML = `<strong>❌ خطأ غير متوقع:</strong><br><pre style="white-space:pre-wrap;word-break:break-word">${details}</pre>`;
  document.body.prepend(errDiv);
  console.log('=== ERROR CAPTURED ===');
  console.log('Message:', event.message);
  console.log('Type:', isJsError ? 'JS Error' : 'Resource Error');
  console.log('Target:', targetTag, targetSrc);
  console.log('File:', event.filename, event.lineno, event.colno);
  console.log('Error Object:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  const reason = event.reason;
  const msg = reason?.message || reason?.toString() || '';

  // Ignore known external errors (browser extensions / Chrome AI features)
  if (msg.includes('image.png') || msg.includes('model does not support image input')) {
    console.log('Ignored external rejection:', msg);
    return;
  }

  const errDiv = document.createElement('div');
  errDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#fef3c7;color:#92400e;padding:20px;font-family:monospace;font-size:14px;z-index:99999;border-bottom:4px solid #f59e0b;max-height:100vh;overflow:auto';
  const stack = reason?.stack || '';
  errDiv.innerHTML = `<strong>⚠️ Promise غير معالج:</strong><br><pre style="white-space:pre-wrap;word-break:break-word">${msg}\n\n${stack}</pre>`;
  document.body.prepend(errDiv);
  console.log('=== UNHANDLED REJECTION ===');
  console.log('Reason:', reason);
  console.log('Stack:', stack);
});

const root = ReactDOM.createRoot(rootElement);
root.render(<App />);
