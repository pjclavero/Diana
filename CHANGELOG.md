# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado semántico.

## [No publicado]

### Añadido

- Estructura profesional del repositorio con separación firmware / servidor / contratos.
- Contratos MQTT v1 congelados: 12 esquemas JSON Schema 2020-12, definiciones comunes,
  16 ejemplos válidos y 12 inválidos, y validador ejecutable (`contracts/validate.py`).
- Modelo temporal de cuatro marcas (dispositivo, coordinador, recepción, persistencia),
  con el tiempo del servidor excluido del payload por contrato.
- ADR 0001-0006: stack del servidor, modelo temporal, idempotencia, estructura del
  repositorio, identidad de la VM y precisión no calculable.
- Documentos de coordinación: plan maestro, paquetes de trabajo, propiedad de rutas,
  dependencias, decisiones, riesgos, matriz de pruebas y estado.
- `CONTRIBUTING.md`, `SECURITY.md` y `.gitignore` con exclusión de secretos.

## [0.1.0] — punto de partida

- Dosier técnico del sistema modular de dianas 3×3 (v0.1).
