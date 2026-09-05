import 'reflect-metadata';

import { MqttService } from '../../src/modules/mqtt/mqtt.service';
import { ProvisioningCommandService } from '../../src/modules/provisioning/provisioning-command.service';
import { ProvisioningStateService } from '../../src/modules/provisioning/provisioning-state.service';
import {
  PROVISIONING_STATE_REPOSITORY,
  PROVISION_STATE_SINK,
} from '../../src/modules/provisioning/provisioning.ports';

/**
 * «`provision/state` NUNCA es autoridad» — comprobado en la ESTRUCTURA.
 *
 * Un comentario que lo prometa no impide nada. Lo que sí lo impide es que el
 * servicio de ingesta no tenga NADA con lo que actuar, y eso se lee en los
 * metadatos de inyección que Nest deja en la clase: `design:paramtypes` (las
 * dependencias por tipo) y `self:paramtypes` (las que llegan por `@Inject`).
 *
 * Se leen metadatos y no el texto del fichero a propósito. Buscar «MqttService»
 * con una expresión regular daría un falso negativo en cuanto alguien lo
 * inyectara con un alias, un token o una fábrica; los metadatos describen lo
 * que Nest va a construir de verdad.
 */

const SELF_DEPS = 'self:paramtypes';

function typeDeps(target: unknown): string[] {
  const types = (Reflect.getMetadata('design:paramtypes', target as object) ?? []) as Array<{
    name?: string;
  }>;
  return types.map((t) => t?.name ?? 'desconocido');
}

function tokenDeps(target: unknown): unknown[] {
  const declared = (Reflect.getMetadata(SELF_DEPS, target as object) ?? []) as Array<{
    param: unknown;
  }>;
  return declared.map((d) => d.param);
}

describe('ProvisioningStateService · no puede actuar, porque no tiene con qué', () => {
  it('NO depende de MqttService ni de ningún publicador', () => {
    expect(typeDeps(ProvisioningStateService)).not.toContain(MqttService.name);
    expect(typeDeps(ProvisioningStateService)).not.toContain(
      ProvisioningCommandService.name,
    );
  });

  it('NO depende del servicio que emite órdenes, ni por tipo ni por token', () => {
    const tokens = tokenDeps(ProvisioningStateService).map(String);
    expect(tokens.join('|')).not.toMatch(/SIGNER|DELEGATION|COMMAND/i);
  });

  it('sus únicas dependencias son el validador y los dos repositorios', () => {
    // La lista completa, no una ausencia: si mañana aparece una dependencia
    // nueva —sea cual sea— este test la pone sobre la mesa para que alguien
    // decida si el plano observacional debía crecer.
    const types = typeDeps(ProvisioningStateService);
    expect(types).toEqual(['ContractValidator', 'Object', 'Object']);
    const tokens = tokenDeps(ProvisioningStateService);
    expect(tokens).toHaveLength(2);
  });

  it('CONTROL POSITIVO: el servicio de MANDO sí depende de MqttService', () => {
    // Sin este control, los tres de arriba pasarían igual si `typeDeps`
    // devolviera siempre una lista vacía por un fallo de los metadatos.
    expect(typeDeps(ProvisioningCommandService)).toContain(MqttService.name);
  });

  it('el sumidero y el repositorio observacional son tokens distintos', () => {
    // Reutilizar un token haría que un `useExisting` accidental cruzara el lado
    // observacional con el de mando.
    expect(PROVISION_STATE_SINK).not.toBe(PROVISIONING_STATE_REPOSITORY);
  });
});

describe('el puerto observacional no expone nada ejecutable', () => {
  it('ProvisioningStateService no publica ningún método que ordene', () => {
    const methods = Object.getOwnPropertyNames(ProvisioningStateService.prototype).filter(
      (name) => name !== 'constructor',
    );
    // Repertorio cerrado: registrar, ingerir y leer. Nada de publicar, ordenar,
    // aplicar ni reconciliar.
    expect(methods.sort()).toEqual(['ingest', 'latestObserved', 'record']);
    expect(methods.join('|')).not.toMatch(/publish|apply|command|enforce|reconcile/i);
  });
});
