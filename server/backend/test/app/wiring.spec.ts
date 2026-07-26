import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { buildOpenApiDocument } from '../../src/swagger';

/**
 * Comprueba que el grafo de dependencias del monolito modular se resuelve
 * entero. No necesita PostgreSQL ni Mosquitto: ambos quedan desactivados.
 */
describe('Arranque de la aplicación', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DIANA_SKIP_DB = '1';
    process.env.DIANA_SKIP_BOOTSTRAP = '1';
    process.env.MQTT_ENABLED = 'false';
    process.env.JWT_SECRET = 'secreto-de-pruebas-no-productivo';
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ?? 'postgresql://diana:diana@localhost:5432/diana';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  it('todos los módulos del encargo §9 se instancian', () => {
    expect(app).toBeDefined();
  });

  it('el documento OpenAPI se genera con las rutas esperadas', () => {
    const document = buildOpenApiDocument(app);
    const paths = Object.keys(document.paths ?? {});

    expect(paths.length).toBeGreaterThan(40);
    for (const expected of [
      '/api/auth/login',
      '/api/games',
      '/api/hits',
      '/api/accuracy/rounds/{roundId}/participants/{participantId}',
      '/api/ammo/participants/{participantId}',
      '/api/exports/rounds/{roundId}/hits.csv',
      '/api/statistics/games/{gameId}/participants/{participantId}/reset',
      '/api/audit',
      '/api/health',
      '/api/mqtt/status',
    ]) {
      expect(paths).toContain(expected);
    }
  });

  it('la documentación advierte del caso not_computable (ADR-0006)', () => {
    const document = buildOpenApiDocument(app);
    expect(document.info.description).toContain('not_computable');
    expect(document.info.description).toContain('ADR-0002');
  });
});
