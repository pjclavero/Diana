/** Configuración de pruebas del backend Diana.
 *
 * Las pruebas unitarias y de dominio NO necesitan PostgreSQL ni Mosquitto.
 * Las pruebas de integración viven en `test/integration/` y se saltan solas
 * si no hay `DATABASE_URL` (ver test/integration/README.md).
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  setupFilesAfterEnv: ['<rootDir>/test/jest.setup.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/', 'main.ts'],
  testEnvironment: 'node',
  testTimeout: 30000,
  // Tope de paralelismo. Sin el, `broker.integration.spec.ts` daba rojo en 2 de
  // cada 4 ejecuciones: su beforeAll arranca un contenedor con execFileSync,
  // que BLOQUEA el bucle de eventos, mientras 7 workers saturan las 8 CPU y el
  // hook se pasa de los 120 s. El producto estaba bien; lo que fallaba era el
  // utillaje de medida, y una puerta que da rojo la mitad de las veces por
  // contencion envenena cualquier gate que se apoye en ella.
  maxWorkers: 2,
};
