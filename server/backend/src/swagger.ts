import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Diana · API del servidor de dianas modulares')
    .setDescription(
      'API REST del backend Diana (WP-02).\n\n' +
        'Notas normativas:\n' +
        '- Los tiempos de impacto se exponen en MICROSEGUNDOS y por separado: ' +
        '`device_event_us` (T1, del ESP32), `coordinator_elapsed_us` (T2, del módulo ' +
        'principal), `received_at` (T3) y `persisted_at` (T4). El backend nunca reescribe ' +
        'T1 ni T2 (ADR-0002).\n' +
        '- `accuracy_status` puede valer `not_computable`: en ese caso `shots_fired`, ' +
        '`accuracy_total` y `accuracy_valid` son `null` y NO deben mostrarse como 0 % ' +
        '(ADR-0006).\n' +
        '- Los duplicados de impacto son normales con QoS 1 y no son errores (ADR-0003).',
    )
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addTag('auth', 'Autenticación y roles')
    .addTag('games', 'Partidas y motor de juego')
    .addTag('hits', 'Eventos de impacto (inmutables)')
    .addTag('accuracy', 'Munición y precisión (ADR-0006)')
    .addTag('exports', 'Exportación CSV')
    .build();

  return SwaggerModule.createDocument(app, config);
}

export function setupSwagger(app: INestApplication): OpenAPIObject {
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
  return document;
}
