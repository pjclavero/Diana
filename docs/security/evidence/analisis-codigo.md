# Evidencia · analisis de codigo (grep ejecutado 2026-07-20T23:34:26+02:00)

## CORS
```
server/backend/src/main.ts:24:  app.enableCors({
server/backend/src/modules/websocket/live.gateway.ts:20:@WebSocketGateway({ namespace: '/live', cors: { origin: true } })

compose.yml:
129:      CORS_ORIGIN: ${BACKEND_CORS_ORIGIN:-http://localhost:8080}

backend lee:
58:    corsOrigins: (process.env.CORS_ORIGINS ?? '')
```

## JWT
```
server/backend/src/modules/auth/jwt.strategy.ts:20:      secretOrKey: config.jwt.secret,
server/backend/src/config/configuration.ts:48:  const secret = process.env.JWT_SECRET ?? '';
server/backend/src/config/configuration.ts:51:      'JWT_SECRET no está definido. El backend no arranca en producción sin un secreto explícito.',
server/backend/src/config/configuration.ts:63:      secret: secret || 'desarrollo-inseguro-cambiar',

JWT_SECRET en compose.yml:
0
```

## Inyeccion SQL: unico uso de raw
```
server/backend/src/modules/health/health.module.ts:30:      await this.prisma.$queryRaw`SELECT 1`;
```

## XSS: dangerouslySetInnerHTML / innerHTML / eval
```
(sin coincidencias)
```

## Rate limiting y cabeceras
```
3:import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
44:    ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]),
79:    { provide: APP_GUARD, useClass: ThrottlerGuard },
3:import helmet from 'helmet';
22:  app.use(helmet());
45:    limit_req_zone $binary_remote_addr zone=api_general:10m rate=20r/s;
46:    limit_req_zone $binary_remote_addr zone=api_auth:10m rate=5r/s;
47:    limit_req_status 429;
59:        add_header X-Frame-Options "DENY" always;
60:        add_header X-Content-Type-Options "nosniff" always;
61:        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
62:        add_header X-XSS-Protection "1; mode=block" always;
63:        add_header Content-Security-Policy $csp_header always;
64:        add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
71:            limit_req zone=api_general burst=40 nodelay;
84:            limit_req zone=api_auth burst=10 nodelay;
109:            limit_req zone=api_general burst=40 nodelay;
123:            add_header Content-Type text/plain;
142:    #     add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
```

## Dockerfiles existentes
```
./server/frontend/Dockerfile
./simulators/target-module/Dockerfile
--- referenciados por compose.yml:
76:      context: ./server/frontend
109:      context: ./server/backend
161:      context: ./server/worker
209:      context: ./server/backend
349:      context: ./simulators/target-module
378:      context: ./server/backend
```

## Escapado CSV (sin neutralizacion de formulas)
```
export function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'bigint'
        ? value.toString()
        : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
```

## Gateway WebSocket (sin autenticacion)
```
@Injectable()
@WebSocketGateway({ namespace: '/live', cors: { origin: true } })
export class LiveGateway implements EventPublisherPort, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(LiveGateway.name);
  private readonly buffer: LiveEvent[] = [];
  private static readonly BUFFER_SIZE = 200;

  @WebSocketServer()
  server?: Server;

  handleConnection(client: Socket): void {
    this.logger.debug(`Cliente conectado al canal en directo: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Cliente desconectado: ${client.id}`);
  }

  /** El cliente se suscribe a un sistema concreto. */
  @SubscribeMessage('subscribe')
  onSubscribe(client: Socket, payload: { system_id?: string }): { subscribed: string } {
    const room = payload?.system_id ? `system:${payload.system_id}` : 'system:all';
    void client.join(room);
    return { subscribed: room };
  }

  publish(event: LiveEvent): void {
```
