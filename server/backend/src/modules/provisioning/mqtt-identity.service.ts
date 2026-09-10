import { randomBytes, createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { hashSync } from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  IDENTITY_SOURCE,
  IdentitySourcePort,
  MQTT_CREDENTIAL_STORE,
  MqttCredentialStorePort,
} from './mqtt-identity.ports';

/** 192 bits de entropía, igual que `openssl rand -base64 24` de generate-users.sh. */
const SECRET_BYTES = 24;
const BCRYPT_ROUNDS = 10;

export interface IssuedIdentity {
  moduleId: string;
  slug: string;
  username: string;
  /** El `client_id` que el broker IMPONE (use_username_as_clientid true). */
  clientId: string;
  /**
   * La contraseña en claro. Aparece AQUÍ y en ningún otro sitio del sistema:
   * ni se persiste, ni se registra, ni hay endpoint que la devuelva.
   */
  secret: string;
  fingerprint: string;
  generation: number;
  issuedAt: Date;
  warning: string;
}

/** Lo que se puede consultar DESPUÉS. Nunca incluye el secreto. */
export interface IdentityMetadata {
  moduleId: string;
  slug: string;
  username: string;
  clientId: string;
  fingerprint: string;
  generation: number;
  issuedAt: Date;
  deliveredAt: Date;
  revokedAt: Date | null;
  issuedByUsername: string | null;
}

export interface IssuerActor {
  userId?: string;
  username?: string;
}

/**
 * AUTORIDAD DE CREDENCIALES MQTT (T4).
 *
 * ─ Reglas, todas comprobables ────────────────────────────────────────────────
 *
 *  1. UNA identidad por dispositivo. `module_mqtt_credentials` tiene índice
 *     único sobre `module_id` Y sobre `username`: compartir credencial no es un
 *     error que haya que recordar no cometer, es una escritura que la base
 *     rechaza.
 *  2. `username == slug == module_id == client_id`. Los tres primeros por la
 *     invariante F-02 de la fuente única; el `client_id` lo impone el broker
 *     con `use_username_as_clientid true`, así que el cliente no lo elige.
 *  3. El servidor genera el secreto. El frontend no puede: no tiene forma de
 *     escribir en el `passwd` del broker, y esta ruta es la única que la tiene.
 *  4. El secreto se entrega UNA vez, en el valor de retorno de `issue`. No se
 *     persiste en claro (sólo hash bcrypt + huella pública) y no hay ninguna
 *     lectura que lo devuelva. Perderlo obliga a ROTAR, que es lo correcto:
 *     una credencial recuperable es una credencial que alguien puede recuperar.
 *  5. Emitir una credencial NO cambia el estado del módulo. Sigue en PENDING /
 *     OFFLINE hasta que el dispositivo se conecte y publique de verdad; este
 *     servicio no toca `online`, `lastSeenAt` ni nada de presencia.
 */
@Injectable()
export class MqttIdentityService {
  private readonly logger = new Logger(MqttIdentityService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(IDENTITY_SOURCE) private readonly identities: IdentitySourcePort,
    @Inject(MQTT_CREDENTIAL_STORE) private readonly store: MqttCredentialStorePort,
  ) {}

  /**
   * Emite (o ROTA, con `allowRotation`) la credencial de un módulo.
   *
   * El orden es: comprobar → escribir en el broker → registrar. Si el registro
   * fallase tras escribir en el broker quedaría una credencial válida sin fila
   * que la ampare; por eso el registro es lo último y su fallo se propaga con
   * el aviso explícito, en vez de tragarse el error y devolver un secreto que
   * el servidor no sabe que emitió.
   */
  async issue(
    moduleId: string,
    actor: IssuerActor = {},
    allowRotation = false,
  ): Promise<IssuedIdentity> {
    const module = await this.prisma.module.findUnique({
      where: { id: moduleId },
      select: { id: true, slug: true },
    });
    if (!module) throw new NotFoundException(`Módulo ${moduleId} no encontrado`);

    // (a) La identidad tiene que estar DECLARADA en la fuente única. Esta es la
    // regla que hace que la credencial nazca con una ACL que la acota: la ACL
    // se genera de ese mismo fichero. Sin esta comprobación se podría crear un
    // usuario que autentica y al que ninguna regla limita.
    const declaredModuleId = await this.identities.moduleIdOf(module.slug);
    if (declaredModuleId === null) {
      throw new BadRequestException(
        `El módulo '${module.slug}' no está declarado en la fuente única de identidades ` +
          `(${this.identities.describe()}). Declararlo allí y regenerar la ACL es requisito ` +
          'previo: una credencial sin regla de ACL autentica y no queda confinada a su ' +
          'subárbol.',
      );
    }
    // (b) F-02, verificada contra la fuente y no dada por supuesta.
    if (declaredModuleId !== module.slug) {
      throw new BadRequestException(
        `La fuente única asocia el usuario '${module.slug}' al module_id '${declaredModuleId}'. ` +
          'La invariante F-02 exige que sean el mismo valor.',
      );
    }

    const existing = await this.prisma.moduleMqttCredential.findUnique({
      where: { moduleId: module.id },
      select: { id: true, generation: true, username: true },
    });
    if (existing && !allowRotation) {
      throw new ConflictException(
        `El módulo '${module.slug}' ya tiene credencial MQTT emitida (generación ` +
          `${existing.generation}). La contraseña se entregó una sola vez y no se puede volver ` +
          'a leer: si se ha perdido, hay que ROTARLA explícitamente, no recuperarla.',
      );
    }

    // (c) Secreto del servidor. `base64url` para que no lleve caracteres que
    // haya que escapar en un fichero de configuración de firmware.
    const secret = randomBytes(SECRET_BYTES).toString('base64url');
    const fingerprint = createHash('sha256').update(secret).digest('hex').slice(0, 16);
    const secretHash = hashSync(secret, BCRYPT_ROUNDS);
    const generation = (existing?.generation ?? 0) + 1;
    const now = new Date();

    // (d) Al broker, por stdin.
    await this.store.upsert(module.slug, secret);

    // (e) Registro. Ni el secreto ni nada derivado de él salvo el hash y la
    // huella. `upsert` sobre `moduleId`, que es único: no puede haber dos.
    await this.prisma.moduleMqttCredential.upsert({
      where: { moduleId: module.id },
      create: {
        moduleId: module.id,
        username: module.slug,
        secretHash,
        fingerprint,
        generation,
        issuedAt: now,
        deliveredAt: now,
        issuedByUserId: actor.userId ?? null,
        issuedByUsername: actor.username ?? null,
      },
      update: {
        username: module.slug,
        secretHash,
        fingerprint,
        generation,
        issuedAt: now,
        deliveredAt: now,
        revokedAt: null,
        issuedByUserId: actor.userId ?? null,
        issuedByUsername: actor.username ?? null,
      },
    });

    // El registro lleva la HUELLA, jamás el secreto.
    this.logger.log(
      `Credencial MQTT emitida para '${module.slug}' (generación ${generation}, huella ` +
        `${fingerprint}) por ${actor.username ?? 'desconocido'}.`,
    );

    return {
      moduleId: module.id,
      slug: module.slug,
      username: module.slug,
      clientId: module.slug,
      secret,
      fingerprint,
      generation,
      issuedAt: now,
      warning:
        'Esta contraseña se muestra UNA sola vez. No se guarda en claro en ninguna parte y no ' +
        'hay forma de volver a leerla: si se pierde, hay que rotar la credencial. Emitirla no ' +
        'conecta el módulo: seguirá en PENDING hasta que el dispositivo publique de verdad.',
    };
  }

  /** Metadatos. Por construcción no puede devolver el secreto: no lo tiene. */
  async describe(moduleId: string): Promise<IdentityMetadata | null> {
    const row = await this.prisma.moduleMqttCredential.findUnique({
      where: { moduleId },
      include: { module: { select: { slug: true } } },
    });
    if (!row) return null;
    return {
      moduleId: row.moduleId,
      slug: row.module.slug,
      username: row.username,
      clientId: row.username,
      fingerprint: row.fingerprint,
      generation: row.generation,
      issuedAt: row.issuedAt,
      deliveredAt: row.deliveredAt,
      revokedAt: row.revokedAt,
      issuedByUsername: row.issuedByUsername,
    };
  }

  /** Retira la credencial del broker y marca la fila. La fila NO se borra:
   *  el rastro de que existió una credencial es parte de la auditoría. */
  async revoke(moduleId: string): Promise<{ username: string; revokedAt: Date }> {
    const row = await this.prisma.moduleMqttCredential.findUnique({
      where: { moduleId },
      select: { id: true, username: true },
    });
    if (!row) throw new NotFoundException('Ese módulo no tiene credencial MQTT emitida.');

    await this.store.remove(row.username);
    const revokedAt = new Date();
    await this.prisma.moduleMqttCredential.update({
      where: { id: row.id },
      data: { revokedAt },
    });
    this.logger.warn(`Credencial MQTT de '${row.username}' revocada.`);
    return { username: row.username, revokedAt };
  }
}
