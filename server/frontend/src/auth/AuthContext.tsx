import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { changePassword as apiChangePassword, fetchMe, login as apiLogin, type AuthUser } from "./authApi";
import { getToken, setToken } from "./tokenStore";
import { permits } from "./permits";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login(username: string, password: string): Promise<AuthUser>;
  logout(): void;
  changePassword(current: string, next: string): Promise<void>;
  /** ¿El rol del usuario cubre el permiso? El comodín `*` lo cubre todo. */
  can(permission: string): boolean;
  hasRole(...roles: string[]): boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, initialUser }: { children: ReactNode; initialUser?: AuthUser | null }) {
  const [user, setUser] = useState<AuthUser | null>(initialUser ?? null);
  const [loading, setLoading] = useState(initialUser === undefined);

  // Al montar, si hay token guardado, recupera la identidad; si el token ya no
  // vale (401), se descarta y el usuario verá el login. Si se inyecta un usuario
  // inicial (pruebas), se omite esta comprobación.
  useEffect(() => {
    if (initialUser !== undefined) return;
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    let alive = true;
    fetchMe(token)
      .then((u) => alive && setUser(u))
      .catch(() => {
        if (!alive) return;
        setToken(null);
        setUser(null);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [initialUser]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiLogin(username, password);
    setToken(res.access_token);
    const u = await fetchMe(res.access_token);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const changePassword = useCallback(
    async (current: string, next: string) => {
      const token = getToken();
      if (!token) throw new Error("No hay sesión activa.");
      await apiChangePassword(token, current, next);
      setUser((prev) => (prev ? { ...prev, must_change_password: false } : prev));
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login,
      logout,
      changePassword,
      can: (permission) => (user ? permits(user.permissions, permission) : false),
      hasRole: (...roles) => (user ? roles.includes(user.role) : false),
    }),
    [user, loading, login, logout, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
