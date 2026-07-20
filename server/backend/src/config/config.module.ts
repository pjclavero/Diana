import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfiguration } from './configuration';

/** La configuración es global: todos los módulos pueden inyectar `CONFIG`. */
@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: loadConfiguration }],
  exports: [CONFIG],
})
export class AppConfigModule {}
