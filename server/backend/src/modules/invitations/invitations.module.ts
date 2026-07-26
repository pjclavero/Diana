import { Global, Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { ManagerActivationController } from './manager-activation.controller';
import { ManagerActivationService } from './manager-activation.service';
import { SmtpService } from './smtp.service';

// Global porque la propiedad de módulos (F2) necesita abrir el ascenso a gestor
// al vender: vincular y activar son dos actos del mismo flujo (§3.1).
@Global()
@Module({
  controllers: [ManagerActivationController, InvitationsController],
  providers: [InvitationsService, SmtpService, ManagerActivationService],
  exports: [InvitationsService, SmtpService, ManagerActivationService],
})
export class InvitationsModule {}
