import { auth } from './firebase';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  updatePassword as firebaseUpdatePassword,
  type User,
} from 'firebase/auth';

export const AuthService = {
  signIn: async (email: string, password: string): Promise<User> => {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return credential.user;
  },

  signUp: async (email: string, password: string): Promise<User> => {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    return credential.user;
  },

  signOut: async (): Promise<void> => {
    await firebaseSignOut(auth);
  },

  updatePassword: async (newPassword: string): Promise<void> => {
    const user = auth.currentUser;
    if (!user) throw new Error('No authenticated user');
    await firebaseUpdatePassword(user, newPassword);
  },

  onAuthStateChanged: (callback: (user: User | null) => void) => {
    return firebaseOnAuthStateChanged(auth, callback);
  },

  getCurrentUser: (): User | null => {
    return auth.currentUser;
  },

  getIdToken: async (): Promise<string | null> => {
    const user = auth.currentUser;
    if (!user) return null;
    return user.getIdToken();
  },
};
