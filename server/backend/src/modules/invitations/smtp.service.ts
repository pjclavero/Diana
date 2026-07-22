import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

const SINGLETON = 'singleton';

export interface SmtpUpdate {
  host?: string | null;
  port?: number | null;
  secure?: boolean;
  username?: string | null;
  password?: string | null;
  fromAddress?: string | null;
}

/**
 * Configuración SMTP (una sola fila). La contraseña se guarda pero NUNCA se
 * devuelve por la API: sólo se expone `hasPassword`. Mientras `host` esté vacío, el
 * correo no está configurado y las invitaciones muestran el código en el panel.
 */
@Injectable()
export class SmtpService {
  constructor(private readonly prisma: PrismaService) {}

  /** ¿Hay SMTP configurado (al menos host y remitente)? */
  async isConfigured(): Promise<boolean> {
    const s = await this.prisma.smtpSetting.findUnique({ where: { id: SINGLETON } });
    return !!(s?.host && s.fromAddress);
  }

  /** Configuración pública (sin la contraseña). */
  async get() {
    const s = await this.prisma.smtpSetting.findUnique({ where: { id: SINGLETON } });
    return {
      host: s?.host ?? null,
      port: s?.port ?? null,
      secure: s?.secure ?? true,
      username: s?.username ?? null,
      fromAddress: s?.fromAddress ?? null,
      hasPassword: !!s?.password,
      configured: !!(s?.host && s?.fromAddress),
    };
  }

  /** Actualiza la configuración. Una contraseña vacía/omitida NO borra la guardada. */
  async update(input: SmtpUpdate) {
    const data = {
      host: input.host ?? null,
      port: input.port ?? null,
      secure: input.secure ?? true,
      username: input.username ?? null,
      fromAddress: input.fromAddress ?? null,
      // Sólo se cambia la contraseña si viene una no vacía.
      ...(input.password ? { password: input.password } : {}),
    };
    await this.prisma.smtpSetting.upsert({
      where: { id: SINGLETON },
      update: data,
      create: { id: SINGLETON, ...data },
    });
    return this.get();
  }
}
