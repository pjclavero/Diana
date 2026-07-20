# DEPENDENCIAS

## Grafo

```
                 ┌──────────────────────────┐
                 │ WP-00 contratos v1       │  CONGELADO
                 └───┬───┬───┬───┬──────────┘
                     │   │   │   │
        ┌────────────┘   │   │   └──────────────┐
        ▼                ▼   ▼                  ▼
   WP-02 backend   WP-04 firmware  WP-05 simulador   WP-03 frontend
        │                │              │                 │
        │                └──────┬───────┘                 │
        │                       ▼                         │
        │                 (integración MQTT)              │
        └───────────────┬───────────────────────┬─────────┘
                        ▼                       ▼
                  WP-11 QA / E2E          WP-10 seguridad
                        │                       │
                        └───────────┬───────────┘
                                    ▼
                            WP-12 dictamen

WP-01 infra ─────────────► WP-08 VM + despliegue ─────► WP-11 QA en VM ─► WP-09 docs s9-server
WP-06 hardware  (sin dependencias de software)
WP-07 CI        (se ajusta cuando existen los paquetes)
```

## Reglas derivadas

1. Nada que hable MQTT arranca antes de que `contracts/validate.py` pase en verde. **Cumplido en la Ola 0.**
2. El frontend consume el OpenAPI del backend; hasta que exista, trabaja contra los
   tipos derivados de los contratos y datos de ejemplo.
3. La VM puede crearse en cuanto el inventario de Proxmox esté validado, en paralelo al
   desarrollo. El **despliegue** exige que WP-01/02/03 estén al menos construibles.
4. Un bloqueo en firmware no detiene backend, panel, simulador ni VM: el simulador es el
   sustituto contractual del firmware para toda la cadena servidor.
5. La documentación en `s9-server` exige datos reales de la VM: no se redacta antes.

## Bloqueos externos identificados

| Bloqueo | Afecta a | Mitigación |
|---|---|---|
| Sin daemon Docker ni sudo en la máquina de desarrollo | build/ejecución de imágenes en local | Todo el trabajo Docker real se hace en la VM 109; en local sólo `docker compose config` |
| Sin ESP-IDF instalado | compilación del binario ESP32-S3 | La lógica se compila y prueba en host con la HAL; la compilación con ESP-IDF queda documentada y verificada en CI |
| Sin hardware físico | calibración piezo, ERC sobre PCB real, consumo | Abstracción + simulador + procedimiento de validación física documentado |
| Auth key de Tailscale no provista | unión de la VM a la tailnet | Instalación completada y dejada lista; único paso pendiente documentado |
