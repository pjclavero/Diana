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
};
