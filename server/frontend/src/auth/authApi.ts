import { ApiError } from "../api/client";

/**
 * Capa de autenticación REAL contra el backend (`/api/auth`), independiente de
 * `VITE_API_MODE`: el login siempre habla con el backend de verdad aunque los
 * datos de negocio estén en modo mock. Ver docs/product/alcance-panel-roles-firmware.md.
 */
const AUTH_BASE_URL = import.meta.env.VITE_AUTH_BASE_URL ?? "/api";

export interface AuthUser {
  id: string;
  username: string;
  role: string;
  permissions: string[];
  must_change_password: boolean;
}

export interface LoginResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: string;
  user: {
    id: string;
    username: string;
    role: string;
    must_change_password: boolean;
  };
}

async function authFetch(path: string, token: string | null, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init?.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetch(`${AUTH_BASE_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("No se puede contactar con el servidor. Compruebe la conexión de red.");
  }
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const res = await authFetch("/auth/login", null, {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (res.status === 401) throw new ApiError("Usuario o contraseña incorrectos.");
  if (!res.ok) throw new ApiError("No se ha podido iniciar sesión. Inténtelo de nuevo.");
  return (await res.json()) as LoginResponse;
}

/** Recupera identidad y permisos del token actual (`GET /auth/me`). */
export async function fetchMe(token: string): Promise<AuthUser> {
  const res = await authFetch("/auth/me", token);
  if (res.status === 401) throw new ApiError("La sesión ha caducado. Vuelva a entrar.");
  if (!res.ok) throw new ApiError("No se ha podido verificar la sesión.");
  const body = (await res.json()) as { userId: string; username: string; role: string; permissions: string[]; must_change_password?: boolean };
  return {
    id: body.userId,
    username: body.username,
    role: body.role,
    permissions: body.permissions ?? [],
    must_change_password: body.must_change_password ?? false,
  };
}

export async function changePassword(token: string, current: string, next: string): Promise<void> {
  const res = await authFetch("/auth/change-password", token, {
    method: "POST",
    body: JSON.stringify({ current_password: current, new_password: next }),
  });
  if (res.status === 401) throw new ApiError("La contraseña actual no es correcta.");
  if (!res.ok) throw new ApiError("No se ha podido cambiar la contraseña.");
}
