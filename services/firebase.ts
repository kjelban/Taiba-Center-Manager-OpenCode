import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyArcKYFvX8MGofzZMaI14b1Hwu2iN8Z08k",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "adroit-weaver-v6tp2.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "adroit-weaver-v6tp2",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "adroit-weaver-v6tp2.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "191458469411",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:191458469411:web:801356664e1bd88952f396",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "",
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID || "ai-studio-taibacentermanag-c767774a-873a-4b8d-81a6-1c3761dba0ea",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
