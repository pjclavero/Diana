import { Controller, Get, Module } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Public } from '../auth/roles.decorator';
import { MqttService } from '../mqtt/mqtt.service';
import { IngestService } from '../mqtt/ingest.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly ingest: IngestService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Sonda de vida. No revela detalles internos.' })
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Sonda de disponibilidad: base de datos y broker' })
  async ready() {
    let database = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = true;
    } catch {
      database = false;
    }
    const ready = database;
    return {
      status: ready ? 'ok' : 'degraded',
      database,
      mqtt: this.mqtt.connected,
      ingest: this.ingest.getMetrics(),
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
