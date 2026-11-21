/**
 * Konteks autentikasi frontend: menyimpan sesi (token di localStorage lewat
 * lib/api), memuat profil /auth/me saat aplikasi dibuka, dan menyediakan
 * login/logout untuk halaman.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getToken,
  login as apiLogin,
  logout as apiLogout,
  me,
  setToken,
  type User,
} from "../lib/api";

interface AuthState {
  user: User | null;
  /** true selama pemeriksaan sesi awal (/auth/me) belum selesai. */
  loading: boolean;
  login: (email: string, password: string, outletId?: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(() => getToken() !== null);

  useEffect(() => {
    let cancelled = false;
    if (!getToken()) {
      setLoading(false);
      return;
    }
    me()
      .then((u) => {
        if (!cancelled) setUser(u);
      })
      .catch(() => {
        // Token tidak sah/kedaluwarsa: bersihkan agar diarahkan ke /login.
        setToken(null);
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string, outletId?: string) => {
      const result = await apiLogin({
        email,
        password,
        ...(outletId ? { outlet_id: outletId } : {}),
      });
      setToken(result.token);
      setUser(result.user);
      return result.user;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // Sesi di server mungkin sudah tidak ada; tetap bersihkan lokal.
    }
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam AuthProvider");
  return ctx;
}
