import { Product, Sale } from "../types";
import { getServerSessionToken } from "./base";

export const GeminiService = {
  // Suggest a selling price based on cost and market trends via backend server
  suggestPrice: async (productName: string, costPrice: number, season: string): Promise<string> => {
    try {
      const token = getServerSessionToken();
      if (!token) return "عذراً، يجب تسجيل الدخول لاستخدام هذه الميزة.";;

      const response = await fetch("/api/gemini/suggest-price", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ productName, costPrice, season }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        return errData.error || "حدث خطأ غير متوقع على خادم الذكاء الاصطناعي";
      }

      const data = await response.json();
      return data.suggestion || "لم يتم استلام رد من نموذج الذكاء الاصطناعي";
    } catch (error) {
      console.error("Gemini Frontend Error:", error);
      return "حدث خطأ أثناء الاتصال بخادم الذكاء الاصطناعي";
    }
  },

  // Analyze Sales Data via backend server
  analyzeBusiness: async (sales: Sale[], products: Product[]): Promise<string> => {
    try {
      const token = getServerSessionToken();
      if (!token) return "عذراً، يجب تسجيل الدخول لاستخدام هذه الميزة.";

      const response = await fetch("/api/gemini/analyze-business", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ sales, products }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        return errData.error || "فشل التحليل الذكي للبيانات";
      }

      const data = await response.json();
      return data.analysis || "لا توجد نصائح حالياً";
    } catch (error) {
      console.error("Gemini Frontend Error:", error);
      return "فشل الاتصال بالخادم لإجراء التحليل الذكي";
    }
  }
};
