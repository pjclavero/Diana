/**
 * Sistema por defecto que muestra el panel cuando aún no hay selector de
 * sistema en la UI (instalación con un único `system_id`). El backend real
 * expondrá `GET /systems` para poblar un selector en Ola 2.
 */
export const DEFAULT_SYSTEM_ID = import.meta.env.VITE_DEFAULT_SYSTEM_ID ?? "system-a";
