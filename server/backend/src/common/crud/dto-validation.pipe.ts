import { BadRequestException, PipeTransform, Type } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

/**
 * Valida un cuerpo contra una clase DTO CONCRETA, pasada en el constructor.
 *
 * Existe porque el controlador CRUD genérico se fabrica en tiempo de ejecución
 * (`createCrudController`) y su firma declarada es `Record<string, unknown>`:
 * el `ValidationPipe` global de `main.ts` mira el METATIPO del parámetro, ve
 * `Object` y NO valida nada. Ese es exactamente el agujero por el que un
 * `PATCH /modules/:id` podía llevar `slug` o `configVersion`. Aquí el tipo no
 * se deduce del emitido por TypeScript: se declara.
 *
 * Política deliberada: `forbidNonWhitelisted`, es decir, un campo no declarado
 * en el DTO se RECHAZA con 400, no se ignora en silencio. Ignorar devuelve 200
 * y el cliente se queda creyendo que cambió algo que no cambió; eso convierte
 * un fallo de autoridad en un fallo invisible, y en el caso de `slug` (que es
 * el `module_id` de MQTT, invariante F-02) el cliente creería haber cambiado
 * la identidad del dispositivo.
 */
export class DtoValidationPipe<T extends object> implements PipeTransform<unknown, T> {
  constructor(private readonly dto: Type<T>) {}

  transform(value: unknown): T {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('El cuerpo de la petición debe ser un objeto JSON.');
    }

    const instance = plainToInstance(this.dto, value, {
      enableImplicitConversion: false,
    });

    const errors = validateSync(instance as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      skipMissingProperties: false,
    });

    if (errors.length > 0) {
      const messages = errors.flatMap((e) =>
        Object.values(e.constraints ?? { unknown: `Campo '${e.property}' no admitido.` }),
      );
      throw new BadRequestException(messages);
    }

    return instance;
  }
}
