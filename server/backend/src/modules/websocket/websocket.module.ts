import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig, CONFIG } from '../../config/configuration';
import { EVENT_PUBLISHER } from '../hits/ports';
import { LiveGateway } from './live.gateway';

@Global()
@Module({
  // El canal en directo verifica el MISMO token que el REST: sin esto el
  // gateway quedaba abierto, porque los guards globales son de contexto HTTP.
  imports: [
    JwtModule.registerAsync({
      inject: [CONFIG],
      useFactory: (config: AppConfig) => ({ secret: config.jwt.secret }),
    }),
  ],
  providers: [LiveGateway, { provide: EVENT_PUBLISHER, useExisting: LiveGateway }],
  exports: [LiveGateway, EVENT_PUBLISHER],
})
export class WebsocketModule {}
