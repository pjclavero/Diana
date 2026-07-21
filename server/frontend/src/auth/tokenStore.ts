/**
 * Almacén del token JWT. Único punto que toca `localStorage`, de modo que el
 * resto del panel (y el `realAdapter`) lo lea desde aquí sin acoplarse al
 * mecanismo de persistencia.
 */
const STORAGE_KEY = "diana.auth.token";

let current: string | null = readInitial();

function readInitial(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return current;
}

export function setToken(token: string | null): void {
  current = token;
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Entorno sin localStorage (p. ej. pruebas): el valor en memoria basta.
  }
}
