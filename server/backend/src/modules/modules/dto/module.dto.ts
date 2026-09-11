import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsIP,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  IsUUID,
} from 'class-validator';
import { IDENTIFIER_PATTERN } from '../../../contracts/topics';

/** Repertorios cerrados del esquema Prisma. Se declaran aquí para que el DTO
 *  rechace un valor fuera de rango ANTES de llegar a la base, y no con un error
 *  de Prisma que no dice qué valores eran admisibles. */
export const MODULE_ROLES = ['principal', 'satellite', 'auto'] as const;
export const SELECTOR_POSITIONS = ['SATELITE', 'AUTO', 'PRINCIPAL'] as const;
export const MODULE_STATES = [
  'boot',
  'selftest',
  'network',
  'registering',
  'ready',
  'calibration',
  'maintenance',
  'game_prepare',
  'game_countdown',
  'game_active',
  'game_paused',
  'game_finished',
  'error',
] as const;

const MAC_PATTERN = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

/**
 * Campos que un cliente puede fijar EN LA CREACIÓN de un módulo.
 *
 * `slug` sólo aparece aquí: es el `module_id` de MQTT y, por la invariante F-02
 * (`username == module_id`, ver infrastructure/mosquitto/identities.json), es
 * también el usuario del broker y el `client_id` que el broker impone. Se elige
 * una vez, al dar de alta el dispositivo, y a partir de ahí es identidad, no
 * dato editable: cambiarlo por un PATCH dejaría la fila apuntando a un
 * dispositivo distinto del que tiene las credenciales y la ACL.
 *
 * `configVersion` NO aparece ni aquí ni en el DTO de actualización: es
 * propiedad del sistema (T2) y sólo la avanza `config/push`.
 */
export class CreateModuleDto {
  @ApiProperty({
    description:
      'Identificador MQTT del módulo (module_id). Inmutable tras la creación: es la identidad del dispositivo (F-02).',
    pattern: IDENTIFIER_PATTERN.source,
  })
  @Matches(IDENTIFIER_PATTERN, {
    message:
      "slug debe cumplir el patrón de identificador del contrato (contracts/mqtt/README.md §1): minúsculas, dígitos y guiones, 3-63 caracteres.",
  })
  slug!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  targetSystemId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  friendlyName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  serial?: string | null;

  @ApiPropertyOptional({ pattern: MAC_PATTERN.source })
  @IsOptional()
  @Matches(MAC_PATTERN, { message: 'mac debe tener formato AA:BB:CC:DD:EE:FF.' })
  mac?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIP()
  ip?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  hardwareRevision?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetBoard?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  firmwareVersion?: string | null;

  @ApiPropertyOptional({ enum: MODULE_ROLES as unknown as string[] })
  @IsOptional()
  @IsIn(MODULE_ROLES as unknown as string[])
  role?: (typeof MODULE_ROLES)[number] | null;

  @ApiPropertyOptional({ enum: SELECTOR_POSITIONS as unknown as string[] })
  @IsOptional()
  @IsIn(SELECTOR_POSITIONS as unknown as string[])
  selector?: (typeof SELECTOR_POSITIONS)[number] | null;

  @ApiPropertyOptional({ enum: MODULE_STATES as unknown as string[] })
  @IsOptional()
  @IsIn(MODULE_STATES as unknown as string[])
  state?: (typeof MODULE_STATES)[number] | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  maintenance?: boolean;
}

/**
 * Campos que un cliente puede modificar de un módulo ya existente.
 *
 * Todo opcional, y SIN `slug` ni `configVersion`. Un PATCH que los traiga se
 * rechaza con 400 (`DtoValidationPipe`, `forbidNonWhitelisted`).
 *
 * ── ¿rechazar o ignorar? ─────────────────────────────────────────────────────
 * Se RECHAZA. Ignorar el campo devolvería 200 con un cuerpo en el que `slug`
 * sigue valiendo lo de antes: un cliente que compare lo que pidió con lo que
 * recibió lo notará, pero uno que sólo mire el código de estado creerá que
 * cambió la identidad MQTT del dispositivo. Con un 400 la respuesta dice
 * exactamente qué campo no es suyo y por qué. La regla es la misma que ya
 * aplica el resto de la API por el `ValidationPipe` global
 * (`forbidNonWhitelisted: true` en `main.ts`); lo que hacía el CRUD genérico —
 * descartar en silencio lo que no estuviera en la lista blanca del servicio —
 * era la excepción, no la norma.
 */
export class UpdateModuleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  targetSystemId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  friendlyName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  serial?: string | null;

  @ApiPropertyOptional({ pattern: MAC_PATTERN.source })
  @IsOptional()
  @Matches(MAC_PATTERN, { message: 'mac debe tener formato AA:BB:CC:DD:EE:FF.' })
  mac?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIP()
  ip?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  hardwareRevision?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetBoard?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  firmwareVersion?: string | null;

  @ApiPropertyOptional({ enum: MODULE_ROLES as unknown as string[] })
  @IsOptional()
  @IsIn(MODULE_ROLES as unknown as string[])
  role?: (typeof MODULE_ROLES)[number] | null;

  @ApiPropertyOptional({ enum: SELECTOR_POSITIONS as unknown as string[] })
  @IsOptional()
  @IsIn(SELECTOR_POSITIONS as unknown as string[])
  selector?: (typeof SELECTOR_POSITIONS)[number] | null;

  @ApiPropertyOptional({ enum: MODULE_STATES as unknown as string[] })
  @IsOptional()
  @IsIn(MODULE_STATES as unknown as string[])
  state?: (typeof MODULE_STATES)[number] | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  maintenance?: boolean;
}
