export const AuthService = {
  signIn: async (_email: string, _password: string): Promise<any> => {
    throw new Error('Use server-side login via /api/auth/login');
  },

  signOut: async (): Promise<void> => {
    // Handled via logoutSession in base.ts / AuthProvider
  },

  onAuthStateChanged: (callback: (user: any | null) => void) => {
    // No-op: server-side auth doesn't use Firebase Auth state
    callback(null);
    return () => {};
  },

  getCurrentUser: (): any | null => {
    return null;
  },

  getIdToken: async (): Promise<string | null> => {
    return null;
  },
};
