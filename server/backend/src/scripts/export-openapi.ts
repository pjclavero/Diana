/**
 * Genera `contracts/api/openapi.json` a partir de la propia aplicación.
 *
 * Es la ÚNICA ruta de `contracts/` que WP-02 puede escribir (OWNERSHIP.md), y
 * lo hace como artefacto generado: no se edita a mano.
 *
 * No necesita base de datos ni broker: la aplicación se crea sin escuchar.
 */
import { NestFactory } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../app.module';
import { resolveContractsDir } from '../contracts/contracts-path';
import { buildOpenApiDocument } from '../swagger';

async function main(): Promise<void> {
  process.env.MQTT_ENABLED = 'false';
  process.env.DIANA_SKIP_BOOTSTRAP = '1';
  process.env.DIANA_SKIP_DB = '1';
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://diana:diana@localhost:5432/diana';

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.setGlobalPrefix(process.env.API_PREFIX ?? 'api');
  await app.init();

  const document = buildOpenApiDocument(app);
  const target = path.join(resolveContractsDir(), 'api', 'openapi.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  const paths = Object.keys(document.paths ?? {}).length;
  process.stdout.write(`OpenAPI escrito en ${target} (${paths} rutas)\n`);

  await app.close();
}

void main().catch((error) => {
  process.stderr.write(`Error generando OpenAPI: ${(error as Error).stack}\n`);
  process.exit(1);
});
