import { Logger } from '@nestjs/common';

// Silencia el logger de Nest durante las pruebas: los rechazos esperados
// generan avisos que ensucian la salida sin aportar información.
Logger.overrideLogger(false);
