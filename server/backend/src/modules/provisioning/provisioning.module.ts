import { Global, Logger, Module } from '@nestjs/common';
import { readFileSync } from 'node:fs';

import { ContractValidator, getContractValidator } from '../../contracts/contract-validator';
import { DELEGATION_SCOPE } from './provisioning-canonical';
import {
  DelegationCredential,
  PROVISIONING_DELEGATION,
  ProvisioningCommandService,
} from './provisioning-command.service';
import { ProvisioningSigner, PROVISIONING_SIGNER } from './provisioning-signer';
import { ProvisioningController } from './provisioning.controller';
import {
  PROVISIONING_ORDER_REPOSITORY,
  PROVISIONING_STATE_REPOSITORY,
  PROVISION_STATE_SINK,
} from './provisioning.ports';
import {
  PrismaProvisioningOrderRepository,
  PrismaProvisioningStateRepository,
} from './provisioning.repository';
import { ProvisioningStateService } from './provisioning-state.service';

export const DELEGATION_FILE_ENV = 'DIANA_PROVISIONING_DELEGATION_FILE';

/**
 * Carga la credencial de delegación desde un fichero JSON.
 *
 * A diferencia de la clave privada, esto es material PÚBLICO: clave pública
 * operativa, identificadores y la firma de la raíz. No lleva secreto ninguno,
 * así que no se le exige 0600 ni se prohíbe que viva junto a la configuración
 * del despliegue. Lo que sí se comprueba es que sea coherente: un `scope`
 * distinto de `DIANA_PROVISIONING` no autoriza en este plano, y arrancar con
 * una credencial de otro ámbito sólo produciría órdenes que el módulo rechaza.
 */
export function loadDelegation(path: string): DelegationCredential {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const need = (key: string): string => {
    const value = raw[key];
    if (typeof value !== 'string' || value === '') {
      throw new Error(`La credencial de delegación ${path} no trae '${key}'.`);
    }
    return value;
  };
  const scope = need('scope');
  if (scope !== DELEGATION_SCOPE) {
    throw new Error(
      `La credencial de delegación ${path} tiene scope '${scope}'; ` +
        `este plano sólo acepta '${DELEGATION_SCOPE}'.`,
    );
  }
  return {
    delegationVersion: BigInt(String(raw.delegation_version ?? 1)),
    delegationId: need('delegation_id'),
    rootKeyId: need('root_key_id'),
    operationalKeyId: need('operational_key_id'),
    operationalPublicKey: need('operational_public_key'),
    scope,
    delegationSequence: BigInt(String(raw.delegation_sequence ?? 0)),
    systemId: need('system_id'),
    rootSignature: need('root_signature'),
  };
}

/**
 * Plano DEVICE_MANAGEMENT (contrato v1.2, ADR-0008).
 *
 * FALLO CERRADO EN EL ARRANQUE: si no hay clave operativa o no hay delegación,
 * los proveedores valen `null` y `ProvisioningCommandService` devuelve 503 en
 * vez de firmar. El backend arranca igual —la ingesta observacional de
 * `provision/state` no necesita clave ninguna y debe seguir funcionando—, pero
 * no emite órdenes. Lo contrario, arrancar «a medias» y publicar mensajes sin
 * firma, le daría al operador un «enviado» que el módulo tira a la basura.
 *
 * Lo que NO se hace aquí, y es la decisión importante: la clave privada no se
 * lee de una variable de entorno, ni de `argv`, ni de la configuración de Nest.
 * `DIANA_PROVISIONING_KEY_FILE` transporta una RUTA. Ver la cabecera de
 * `provisioning-signer.ts` para el resto del razonamiento.
 */
@Global()
@Module({
  controllers: [ProvisioningController],
  providers: [
    { provide: ContractValidator, useFactory: () => getContractValidator() },
    { provide: PROVISIONING_ORDER_REPOSITORY, useClass: PrismaProvisioningOrderRepository },
    { provide: PROVISIONING_STATE_REPOSITORY, useClass: PrismaProvisioningStateRepository },
    {
      provide: PROVISIONING_SIGNER,
      useFactory: (): ProvisioningSigner | null => {
        const logger = new Logger('ProvisioningModule');
        try {
          const signer = ProvisioningSigner.fromEnv();
          if (!signer) {
            logger.warn(
              'Plano de aprovisionamiento SIN clave operativa: no se emitirán órdenes ' +
                '(la ingesta observacional sigue activa).',
            );
          }
          return signer;
        } catch (error) {
          // Un fallo aquí es de configuración de seguridad y debe verse entero;
          // el mensaje nunca contiene material de clave, sólo la ruta.
          logger.error(
            `Clave de aprovisionamiento rechazada: ${(error as Error).message}`,
          );
          return null;
        }
      },
    },
    {
      provide: PROVISIONING_DELEGATION,
      useFactory: (): DelegationCredential | null => {
        const logger = new Logger('ProvisioningModule');
        const path = process.env[DELEGATION_FILE_ENV];
        if (!path) {
          logger.warn(
            `Plano de aprovisionamiento SIN credencial de delegación (${DELEGATION_FILE_ENV}).`,
          );
          return null;
        }
        try {
          return loadDelegation(path);
        } catch (error) {
          logger.error(`Credencial de delegación rechazada: ${(error as Error).message}`);
          return null;
        }
      },
    },
    ProvisioningCommandService,
    ProvisioningStateService,
    { provide: PROVISION_STATE_SINK, useExisting: ProvisioningStateService },
  ],
  exports: [
    ProvisioningCommandService,
    ProvisioningStateService,
    PROVISION_STATE_SINK,
    PROVISIONING_ORDER_REPOSITORY,
    PROVISIONING_STATE_REPOSITORY,
  ],
})
export class ProvisioningModule {}
