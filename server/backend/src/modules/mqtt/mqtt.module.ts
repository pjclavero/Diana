import { Controller, Get, Global, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContractValidator, getContractValidator } from '../../contracts/contract-validator';
import { AppConfig, CONFIG } from '../../config/configuration';
import { HIT_ATTRIBUTOR, HIT_REPOSITORY, INCIDENT_SINK, PRESENCE_SINK } from '../hits/ports';
import { PrismaHitRepository } from '../hits/prisma-hit.repository';
import { PrismaHitAttributor } from '../hits/prisma-hit-attributor';
import { PrismaIncidentSink } from '../maintenance/incident.sink';
import { ResilienceService } from '../resilience/resilience.service';
import { RequirePermissions } from '../auth/roles.decorator';
import { IngestService, INGEST_OPTIONS } from './ingest.service';
import { MqttService } from './mqtt.service';

@ApiTags('mqtt')
@ApiBearerAuth()
@Controller('mqtt')
export class MqttController {
  constructor(
    private readonly mqtt: MqttService,
    private readonly ingest: IngestService,
  ) {}

  @Get('status')
  @RequirePermissions('modules:read')
  @ApiOperation({ summary: 'Estado del cliente MQTT y métricas de ingesta' })
  status() {
    return {
      connected: this.mqtt.connected,
      metrics: this.ingest.getMetrics(),
    };
  }

  /*
   * RETIRADA: `POST /mqtt/modules/:moduleId/command`.
   *
   * Era un paso genérico al canal de JUEGO `module/{id}/command`: autenticado,
   * protegido sólo por `commands:publish` —permiso que `operador`, `gestor` y
   * `mantenimiento` tienen de serie, o sea el mismo personal técnico que usa
   * F6— y frenado únicamente por la ACL del broker. La orden del operador es
   * que no exista ningún puente del backend hacia ese tópico, «ni siquiera
   * apagado»; además el contrato v1.1 retiró `"backend"` del enum `issuer` de
   * `module-command.schema.json`, así que esta ruta construía un mensaje que
   * el propio contrato declara inválido.
   *
   * No se ha migrado a `maintenance/command` porque los repertorios son
   * disjuntos (`action` de juego vs `command_type` de mantenimiento) y las
   * operaciones legítimas de mantenimiento ya tienen sus rutas propias en
   * F6 (`/modules/:id/identify`, `self-test`, `led-test`, `calibrate`…).
   * No se ha encontrado ningún consumidor: ni `server/frontend/src` (sólo
   * aparece en `schema.d.ts`, que es espejo generado del OpenAPI), ni
   * `simulators/` —`operator-cli` publica en el canal de juego con sus
   * propias credenciales contra el broker, no a través del backend—.
   *
   * NOTA de divergencia: `contracts/api/openapi.json` y el
   * `server/frontend/src/api/generated/schema.d.ts` derivado siguen listando
   * esta ruta. Están fuera del territorio de este carril; hay que
   * regenerarlos (`src/scripts/export-openapi.ts`).
   */
}

@Global()
@Module({
  controllers: [MqttController],
  providers: [
    { provide: ContractValidator, useFactory: () => getContractValidator() },
    { provide: HIT_REPOSITORY, useClass: PrismaHitRepository },
    { provide: INCIDENT_SINK, useClass: PrismaIncidentSink },
    { provide: HIT_ATTRIBUTOR, useClass: PrismaHitAttributor },
    // G-I: la presencia se persiste y decide sobre la ronda. Vive aquí para no
    // crear un ciclo con MqttService (la pausa se ordena por MQTT).
    ResilienceService,
    { provide: PRESENCE_SINK, useExisting: ResilienceService },
    {
      provide: INGEST_OPTIONS,
      inject: [CONFIG],
      useFactory: (config: AppConfig) => config.ingest,
    },
    IngestService,
    MqttService,
  ],
  exports: [MqttService, IngestService, ContractValidator, ResilienceService],
})
export class MqttModule {}
