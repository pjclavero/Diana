import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    // Permite instanciar la aplicación sin base de datos para tareas que no la
    // necesitan (generación de OpenAPI, inspección de rutas).
    if (process.env.DIANA_SKIP_DB === '1') {
      this.logger.warn('Conexión a PostgreSQL omitida (DIANA_SKIP_DB=1)');
      return;
    }
    try {
      await this.$connect();
      this.logger.log('Conectado a PostgreSQL');
    } catch (error) {
      this.logger.error(`No se pudo conectar a PostgreSQL: ${(error as Error).message}`);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
