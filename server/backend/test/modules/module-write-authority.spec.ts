import { BadRequestException } from '@nestjs/common';
import { DtoValidationPipe } from '../../src/common/crud/dto-validation.pipe';
import { CrudService } from '../../src/common/crud/crud.service';
import { CreateModuleDto, UpdateModuleDto } from '../../src/modules/modules/dto/module.dto';
import {
  MODULE_CREATABLE_FIELDS,
  MODULE_UPDATABLE_FIELDS,
  ModulesService,
} from '../../src/modules/modules/modules.service';

/**
 * T1 · AUTORIDAD SOBRE LA IDENTIDAD Y LA VERSIÓN.
 *
 * Lo que se afirma aquí es una AUSENCIA, y una ausencia es fácil de probar mal:
 * una prueba que reescriba la lista de campos y compruebe que su propia copia
 * no tiene `slug` pasa siempre. Por eso se importa la lista REAL del servicio
 * y se comprueba sobre ella, y por eso además se ejercita el pipe de verdad
 * con un cuerpo que lleva `slug`.
 */
describe('T1 · autoridad de escritura sobre Module', () => {
  describe('listas de campos escribibles', () => {
    it('`configVersion` no es escribible ni al crear ni al modificar', () => {
      expect(MODULE_CREATABLE_FIELDS).not.toContain('configVersion');
      expect(MODULE_UPDATABLE_FIELDS).not.toContain('configVersion');
    });

    it('las columnas nuevas de T2 tampoco: son propiedad del sistema', () => {
      for (const campo of [
        'desiredConfigVersion',
        'reportedConfigVersion',
        'configState',
        'configAppliedAt',
      ]) {
        expect(MODULE_CREATABLE_FIELDS).not.toContain(campo);
        expect(MODULE_UPDATABLE_FIELDS).not.toContain(campo);
      }
    });

    it('la presencia observada no es escribible por REST', () => {
      for (const campo of ['online', 'lastSeenAt', 'offlineSince', 'bootId', 'queueDepth']) {
        expect(MODULE_CREATABLE_FIELDS).not.toContain(campo);
        expect(MODULE_UPDATABLE_FIELDS).not.toContain(campo);
      }
    });

    it('`slug` se fija al crear y NO se puede modificar después', () => {
      expect(MODULE_CREATABLE_FIELDS).toContain('slug');
      expect(MODULE_UPDATABLE_FIELDS).not.toContain('slug');
    });

    it('`ownerId` sigue fuera: la propiedad se cambia por link/unlink', () => {
      expect(MODULE_CREATABLE_FIELDS).not.toContain('ownerId');
      expect(MODULE_UPDATABLE_FIELDS).not.toContain('ownerId');
    });
  });

  describe('el pipe RECHAZA (no ignora) lo que no es del cliente', () => {
    const update = new DtoValidationPipe(UpdateModuleDto);
    const create = new DtoValidationPipe(CreateModuleDto);

    it('PATCH {"configVersion": 999} → 400', () => {
      expect(() => update.transform({ configVersion: 999 })).toThrow(BadRequestException);
    });

    it('PATCH {"slug": "module-99"} → 400', () => {
      expect(() => update.transform({ slug: 'module-99' })).toThrow(BadRequestException);
    });

    it('el error DICE qué campo sobra (un 400 mudo no sirve de nada)', () => {
      let mensaje = '';
      try {
        update.transform({ slug: 'module-99' });
      } catch (e) {
        mensaje = JSON.stringify((e as BadRequestException).getResponse());
      }
      expect(mensaje).toContain('slug');
    });

    it('PATCH con un campo legítimo junto a `slug` NO se aplica a medias', () => {
      // El cuerpo entero se rechaza. Aceptar `friendlyName` y descartar `slug`
      // devolvería 200 con la identidad intacta y el cliente no se enteraría.
      expect(() => update.transform({ friendlyName: 'Diana 1', slug: 'module-99' })).toThrow(
        BadRequestException,
      );
    });

    it('PATCH con sólo campos legítimos pasa', () => {
      expect(update.transform({ friendlyName: 'Diana 1', maintenance: true })).toEqual({
        friendlyName: 'Diana 1',
        maintenance: true,
      });
    });

    it('POST admite `slug` (es el alta) pero no `configVersion`', () => {
      expect(create.transform({ slug: 'module-01' })).toMatchObject({ slug: 'module-01' });
      expect(() => create.transform({ slug: 'module-01', configVersion: 3 })).toThrow(
        BadRequestException,
      );
    });

    it('POST sin `slug` se rechaza: un módulo sin module_id no existe en MQTT', () => {
      expect(() => create.transform({ friendlyName: 'sin identidad' })).toThrow(
        BadRequestException,
      );
    });

    it('un `slug` que no cumple el patrón del contrato se rechaza', () => {
      for (const malo of ['AB', 'Module-01', 'módulo-01', 'a', '-abc', 'a'.repeat(64)]) {
        expect(() => create.transform({ slug: malo })).toThrow(BadRequestException);
      }
    });

    it('un cuerpo que no es objeto se rechaza', () => {
      expect(() => update.transform([{ slug: 'x' }])).toThrow(BadRequestException);
      expect(() => update.transform(null)).toThrow(BadRequestException);
    });
  });

  describe('el servicio no escribe lo que no debe, aunque el pipe se saltara', () => {
    // Defensa en profundidad: el pipe es la primera barrera y la lista blanca
    // del servicio la segunda. Se prueba la segunda por separado porque una
    // llamada interna a `update()` no pasa por el pipe.
    function fakeDelegate() {
      return {
        findMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ id: 'm1', slug: 'module-01' }),
        create: jest.fn().mockImplementation((a: any) => Promise.resolve(a.data)),
        update: jest.fn().mockImplementation((a: any) => Promise.resolve(a.data)),
        delete: jest.fn(),
        count: jest.fn(),
      };
    }

    it('`update` DESCARTA `slug` y `configVersion` de los datos que llegan a Prisma', async () => {
      const delegate = fakeDelegate();
      const service = new CrudService(
        delegate,
        'module',
        [...MODULE_CREATABLE_FIELDS],
        undefined,
        MODULE_UPDATABLE_FIELDS,
      );
      await service.update('m1', {
        friendlyName: 'ok',
        slug: 'module-99',
        configVersion: 999,
      } as any);

      const data = delegate.update.mock.calls[0][0].data;
      expect(data).toEqual({ friendlyName: 'ok' });
      expect(data).not.toHaveProperty('slug');
      expect(data).not.toHaveProperty('configVersion');
    });

    it('`create` SÍ deja pasar `slug`', async () => {
      const delegate = fakeDelegate();
      const service = new CrudService(
        delegate,
        'module',
        [...MODULE_CREATABLE_FIELDS],
        undefined,
        MODULE_UPDATABLE_FIELDS,
      );
      await service.create({ slug: 'module-01', friendlyName: 'ok' });
      expect(delegate.create.mock.calls[0][0].data).toMatchObject({ slug: 'module-01' });
    });

    it('un PATCH que SÓLO trae `slug` no llega a escribir nada', async () => {
      const delegate = fakeDelegate();
      const service = new CrudService(
        delegate,
        'module',
        [...MODULE_CREATABLE_FIELDS],
        undefined,
        MODULE_UPDATABLE_FIELDS,
      );
      await expect(service.update('m1', { slug: 'module-99' } as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(delegate.update).not.toHaveBeenCalled();
    });

    it('ModulesService se construye con las listas correctas', () => {
      const prisma = { module: fakeDelegate() } as any;
      const service = new ModulesService(prisma);
      expect((service as any).writableFields).toContain('slug');
      expect((service as any).updatableFields).not.toContain('slug');
      expect((service as any).writableFields).not.toContain('configVersion');
    });
  });
});
