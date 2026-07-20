import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig, CONFIG } from './config/configuration';
import { setupSwagger } from './swagger';

/** Los BigInt (microsegundos) se serializan como cadena, no se truncan. */
declare global {
  interface BigInt {
    toJSON(): string;
  }
}
BigInt.prototype.toJSON = function toJSON(this: bigint): string {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get<AppConfig>(CONFIG);

  app.use(helmet());
  app.setGlobalPrefix(config.globalPrefix);
  app.enableCors({
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  setupSwagger(app);

  await app.listen(config.port, '0.0.0.0');
  new Logger('bootstrap').log(
    `Diana backend escuchando en :${config.port} (prefijo /${config.globalPrefix}, docs en /docs)`,
  );
}

void bootstrap();
