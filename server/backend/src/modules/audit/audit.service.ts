import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthenticatedUser } from '../auth/permissions.guard';

export interface AuditInput {
  user?: AuthenticatedUser | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/** Campos que jamás se escriben en la auditoría (dosier 23.2: logs sin credenciales). */
const REDACTED_FIELDS = [
  'password',
  'password_hash',
  'passwordHash',
  'new_password',
  'current_password',
  'token',
  'access_token',
  'secret',
  'signature',
  'mqtt_password',
];

/** Sustituye por `«redactado»` cualquier campo sensible, a cualquier profundidad. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED_FIELDS.includes(key)) {
      out[key] = '«redactado»';
    } else if (typeof item === 'bigint') {
      out[key] = item.toString();
    } else {
      out[key] = redact(item);
    }
  }
  return out;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: input.user?.userId ?? null,
          actorUsername: input.user?.username ?? null,
          actorRole: input.user?.role ?? null,
          action: input.action,
          entity: input.entity,
          entityId: input.entityId ?? null,
          before: input.before === undefined ? undefined : (redact(input.before) as never),
          after: input.after === undefined ? undefined : (redact(input.after) as never),
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
    } catch (error) {
      // La auditoría nunca debe tumbar la operación auditada, pero el fallo
      // tiene que ser visible.
      this.logger.error(`No se pudo registrar la auditoría: ${(error as Error).message}`);
    }
  }
}
