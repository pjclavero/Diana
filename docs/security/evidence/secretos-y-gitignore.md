# Evidencia · secretos y .gitignore (ejecutado 2026-07-20T23:33:42+02:00)

## git log -p --all | patrones de secreto (sin resultados)
```
$ git log -p --all | grep -nE "(BEGIN .*PRIVATE KEY|ghp_...|AKIA...|eyJhbGciOi|password=...|SECRET=...)"
coincidencias: 0
```

## git status --ignored
```
?? docs/security/evidence/
!! contracts/__pycache__/
!! firmware/esp32/build-host/
!! server/backend/node_modules/
!! simulators/node_modules/
```

## git check-ignore -v sobre rutas sensibles
```
infrastructure/mosquitto/passwd                         NO IGNORADO
mosquitto/passwd                                        .gitignore:10:mosquitto/passwd	mosquitto/passwd
infrastructure/mosquitto/certs/server.key               .gitignore:5:*.key	infrastructure/mosquitto/certs/server.key
.env                                                    .gitignore:2:.env	.env
server/backend/src/modules/exports/exports.module.ts    NO IGNORADO
server/backend/data/exports                             .gitignore:43:data/	server/backend/data/exports
```

## En la VM de produccion (192.168.1.209, /opt/diana) — solo lectura
```
$ git check-ignore -v infrastructure/mosquitto/passwd
rc=1 (1 = NO ignorado)
$ ls -l
-rw------- 1 diana-admin diana-admin 1599 Jul 20 21:30 infrastructure/mosquitto/passwd
$ git status --porcelain
?? infrastructure/mosquitto/passwd
```
