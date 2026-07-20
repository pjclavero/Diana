import { Controller, Get, Global, Module, Post, Body, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContractValidator, getContractValidator } from '../../contracts/contract-validator';
import { AppConfig, CONFIG } from '../../config/configuration';
import { HIT_REPOSITORY, INCIDENT_SINK } from '../hits/ports';
import { PrismaHitRepository } from '../hits/prisma-hit.repository';
import { PrismaIncidentSink } from '../maintenance/incident.sink';
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

  @Post('modules/:moduleId/command')
  @RequirePermissions('commands:publish')
  @ApiOperation({ summary: 'Publica un comando a un módulo (contrato §6)' })
  sendCommand(
    @Param('moduleId') moduleId: string,
    @Body() body: { action: string; params?: Record<string, unknown>; expires_in_ms?: number },
  ) {
    return this.mqtt.sendModuleCommand(moduleId, body.action, body.params, body.expires_in_ms);
  }
}

@Global()
@Module({
  controllers: [MqttController],
  providers: [
    { provide: ContractValidator, useFactory: () => getContractValidator() },
    { provide: HIT_REPOSITORY, useClass: PrismaHitRepository },
    { provide: INCIDENT_SINK, useClass: PrismaIncidentSink },
    {
      provide: INGEST_OPTIONS,
      inject: [CONFIG],
      useFactory: (config: AppConfig) => config.ingest,
    },
    IngestService,
    MqttService,
  ],
  exports: [MqttService, IngestService, ContractValidator],
})
export class MqttModule {}
