import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { compareSync } from 'bcryptjs';
import { createHash } from 'node:crypto';
import { MqttIdentityService } from '../../src/modules/provisioning/mqtt-identity.service';
import {
  IdentitySourcePort,
  MqttCredentialStorePort,
} from '../../src/modules/provisioning/mqtt-identity.ports';

/** Fuente única simulada: declara module-01..module-03 y nada más. */
function fuente(declarados = ['module-01', 'module-02', 'module-03']): IdentitySourcePort {
  return {
    listUsernames: async () => declarados,
    moduleIdOf: async (u) => (declarados.includes(u) ? u : null),
    describe: () => 'fuente de prueba',
  };
}

/** Almacén simulado que RECUERDA lo escrito, para poder afirmarlo. */
function almacen() {
  const escrito = new Map<string, string>();
  const store: MqttCredentialStorePort & { escrito: Map<string, string> } = {
    escrito,
    upsert: async (u, s) => {
      escrito.set(u, s);
    },
    remove: async (u) => {
      escrito.delete(u);
    },
    describe: () => 'almacén de prueba',
  };
  return store;
}

function prismaCon(modulo: any, credencial: any = null) {
  const filas: any = { cred: credencial };
  return {
    filas,
    module: { findUnique: jest.fn().mockResolvedValue(modulo) },
    moduleMqttCredential: {
      findUnique: jest.fn().mockImplementation(async () => filas.cred),
      upsert: jest.fn().mockImplementation(async (args: any) => {
        filas.cred = { ...(filas.cred ?? {}), ...args.create, ...args.update, id: 'c1' };
        return filas.cred;
      }),
      update: jest.fn().mockImplementation(async (args: any) => {
        filas.cred = { ...filas.cred, ...args.data };
        return filas.cred;
      }),
    },
  } as any;
}

const MODULO = { id: 'uuid-m1', slug: 'module-01' };

describe('T4 · autoridad de credenciales MQTT', () => {
  describe('el servidor es quien genera el secreto', () => {
    it('emite usuario == slug == module_id == client_id (F-02)', async () => {
      const store = almacen();
      const svc = new MqttIdentityService(prismaCon(MODULO), fuente(), store);
      const r = await svc.issue(MODULO.id);
      expect(r.username).toBe('module-01');
      expect(r.slug).toBe('module-01');
      expect(r.clientId).toBe('module-01');
    });

    it('el secreto tiene entropía de verdad y NO se repite entre emisiones', async () => {
      const secretos = new Set<string>();
      for (let i = 0; i < 25; i += 1) {
        const svc = new MqttIdentityService(prismaCon(MODULO), fuente(), almacen());
        const r = await svc.issue(MODULO.id);
        expect(r.secret.length).toBeGreaterThanOrEqual(32);
        secretos.add(r.secret);
      }
      expect(secretos.size).toBe(25);
    });

    it('el secreto llega AL BROKER, no sólo a la respuesta', async () => {
      const store = almacen();
      const svc = new MqttIdentityService(prismaCon(MODULO), fuente(), store);
      const r = await svc.issue(MODULO.id);
      expect(store.escrito.get('module-01')).toBe(r.secret);
    });
  });

  describe('el secreto se entrega UNA vez y no se puede volver a leer', () => {
    it('la fila guarda un HASH bcrypt, no el secreto', async () => {
      const prisma = prismaCon(MODULO);
      const r = await new MqttIdentityService(prisma, fuente(), almacen()).issue(MODULO.id);
      const guardado = prisma.moduleMqttCredential.upsert.mock.calls[0][0].create;

      expect(guardado.secretHash).not.toBe(r.secret);
      expect(guardado.secretHash).toMatch(/^\$2[aby]\$/);
      // Y es el hash DE ESE secreto: sirve para verificar, no para recuperar.
      expect(compareSync(r.secret, guardado.secretHash)).toBe(true);
      // Barrido: ningún campo persistido contiene el secreto en claro.
      expect(JSON.stringify(guardado)).not.toContain(r.secret);
    });

    it('la huella es pública y NO permite reconstruir el secreto', async () => {
      const r = await new MqttIdentityService(prismaCon(MODULO), fuente(), almacen()).issue(
        MODULO.id,
      );
      expect(r.fingerprint).toMatch(/^[0-9a-f]{16}$/);
      expect(r.fingerprint).toBe(
        createHash('sha256').update(r.secret).digest('hex').slice(0, 16),
      );
    });

    it('`describe` NO devuelve el secreto (ni tiene de dónde sacarlo)', async () => {
      const prisma = prismaCon(MODULO);
      const svc = new MqttIdentityService(prisma, fuente(), almacen());
      const emitida = await svc.issue(MODULO.id);
      prisma.moduleMqttCredential.findUnique = jest
        .fn()
        .mockResolvedValue({ ...prisma.filas.cred, module: { slug: 'module-01' } });

      const meta = await svc.describe(MODULO.id);
      expect(JSON.stringify(meta)).not.toContain(emitida.secret);
      expect(meta).not.toHaveProperty('secret');
      expect(meta).not.toHaveProperty('secretHash');
    });

    it('reemitir sin pedir rotación se rechaza: no es «volver a verla»', async () => {
      const prisma = prismaCon(MODULO, { id: 'c1', generation: 1, username: 'module-01' });
      const svc = new MqttIdentityService(prisma, fuente(), almacen());
      await expect(svc.issue(MODULO.id)).rejects.toThrow(ConflictException);
    });

    it('rotar explícitamente da un secreto NUEVO y sube la generación', async () => {
      const prisma = prismaCon(MODULO, { id: 'c1', generation: 1, username: 'module-01' });
      const svc = new MqttIdentityService(prisma, fuente(), almacen());
      const r = await svc.issue(MODULO.id, {}, true);
      expect(r.generation).toBe(2);
    });
  });

  describe('una identidad por dispositivo', () => {
    it('la credencial se escribe SOBRE el módulo (upsert por moduleId único)', async () => {
      const prisma = prismaCon(MODULO);
      await new MqttIdentityService(prisma, fuente(), almacen()).issue(MODULO.id);
      expect(prisma.moduleMqttCredential.upsert.mock.calls[0][0].where).toEqual({
        moduleId: MODULO.id,
      });
    });

    it('dos módulos distintos reciben secretos distintos', async () => {
      const a = await new MqttIdentityService(prismaCon(MODULO), fuente(), almacen()).issue(
        MODULO.id,
      );
      const b = await new MqttIdentityService(
        prismaCon({ id: 'uuid-m2', slug: 'module-02' }),
        fuente(),
        almacen(),
      ).issue('uuid-m2');
      expect(a.secret).not.toBe(b.secret);
      expect(a.username).not.toBe(b.username);
    });
  });

  describe('la fuente única manda', () => {
    it('un módulo NO declarado en identities.json no obtiene credencial', async () => {
      const store = almacen();
      const svc = new MqttIdentityService(
        prismaCon({ id: 'uuid-m9', slug: 'module-99' }),
        fuente(),
        store,
      );
      await expect(svc.issue('uuid-m9')).rejects.toThrow(BadRequestException);
      // Y NO se ha tocado el broker: la comprobación va antes de escribir.
      expect(store.escrito.size).toBe(0);
    });

    it('el error explica la consecuencia, no sólo la regla', async () => {
      const svc = new MqttIdentityService(
        prismaCon({ id: 'uuid-m9', slug: 'module-99' }),
        fuente(),
        almacen(),
      );
      await expect(svc.issue('uuid-m9')).rejects.toThrow(/ACL/i);
    });

    it('si la fuente rompiera F-02 (usuario != module_id) se rechaza', async () => {
      const desacoplada: IdentitySourcePort = {
        listUsernames: async () => ['module-01'],
        moduleIdOf: async () => 'm01', // distinto del usuario
        describe: () => 'fuente desacoplada',
      };
      const svc = new MqttIdentityService(prismaCon(MODULO), desacoplada, almacen());
      await expect(svc.issue(MODULO.id)).rejects.toThrow(/F-02/);
    });

    it('un módulo inexistente da 404 y no toca nada', async () => {
      const store = almacen();
      const svc = new MqttIdentityService(prismaCon(null), fuente(), store);
      await expect(svc.issue('nadie')).rejects.toThrow(NotFoundException);
      expect(store.escrito.size).toBe(0);
    });
  });

  describe('emitir una credencial NO conecta el módulo', () => {
    it('no escribe online, lastSeenAt, offlineSince ni bootId', async () => {
      const prisma = prismaCon(MODULO);
      // `module.update` ni siquiera está en el doble: si el servicio lo
      // llamase, la prueba reventaría con «is not a function». Esa es la
      // afirmación: este camino no toca la fila del módulo.
      await new MqttIdentityService(prisma, fuente(), almacen()).issue(MODULO.id);
      expect(prisma.module.findUnique).toHaveBeenCalled();
      expect((prisma.module as any).update).toBeUndefined();
    });

    it('la respuesta lo dice en voz alta', async () => {
      const r = await new MqttIdentityService(prismaCon(MODULO), fuente(), almacen()).issue(
        MODULO.id,
      );
      expect(r.warning).toMatch(/PENDING/);
      expect(r.warning).toMatch(/UNA sola vez/);
    });
  });

  describe('revocación', () => {
    it('retira del broker y marca la fila, sin borrarla', async () => {
      const store = almacen();
      await store.upsert('module-01', 'x');
      const prisma = prismaCon(MODULO, { id: 'c1', username: 'module-01', generation: 1 });
      const svc = new MqttIdentityService(prisma, fuente(), store);
      const r = await svc.revoke(MODULO.id);
      expect(store.escrito.has('module-01')).toBe(false);
      expect(prisma.moduleMqttCredential.update).toHaveBeenCalled();
      expect(r.revokedAt).toBeInstanceOf(Date);
    });

    it('revocar lo que no existe da 404', async () => {
      const svc = new MqttIdentityService(prismaCon(MODULO, null), fuente(), almacen());
      await expect(svc.revoke(MODULO.id)).rejects.toThrow(NotFoundException);
    });
  });
});
