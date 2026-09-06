-- ============================================================================
-- Diana · alta mínima para el carril E2E-2 (offline / recovery).
-- ============================================================================
-- Sin estas filas la presencia de un módulo NO se persiste: ResilienceService
-- .record() busca el módulo por slug y, si no existe, sólo deja una incidencia
-- `presence_unknown_module`. Es decir: sin alta previa el escenario pasaría en
-- verde sin ejercer NADA de la detección de caídas.
--
-- Tres módulos, cada uno con un papel distinto en el escenario:
--   e2e-module-03 → cae con Last Will y luego reconecta y recupera.
--   e2e-module-04 → testigo VIVO: manda telemetría para que el silencio de
--                   e2e-module-05 no se confunda con un apagón general
--                   (isBlackout: si callan TODOS no se declara ninguna caída).
--   e2e-module-05 → cae por SILENCIO (barrido), sin Last Will ninguno.
-- ============================================================================

INSERT INTO "public"."target_systems"
  (id, slug, name, description, state, modules_expected, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'e2e-system-a', 'Sistema E2E offline', 'Carril E2E-2', 'ready', 3, now(), now())
ON CONFLICT (slug) DO NOTHING;

INSERT INTO "public"."modules"
  (id, slug, target_system_id, friendly_name, role, state, online, created_at, updated_at)
SELECT gen_random_uuid(), m.slug, s.id, m.name, m.role::"public"."ModuleRole",
       'ready'::"public"."ModuleState", false, now(), now()
FROM (VALUES
        ('e2e-module-03', 'Diana 03', 'satellite'),
        ('e2e-module-04', 'Diana 04', 'satellite'),
        ('e2e-module-05', 'Diana 05', 'satellite')
     ) AS m(slug, name, role)
CROSS JOIN "public"."target_systems" s
WHERE s.slug = 'e2e-system-a'
ON CONFLICT (slug) DO NOTHING;

SELECT slug, online, last_seen_at, offline_since FROM "public"."modules" ORDER BY slug;
