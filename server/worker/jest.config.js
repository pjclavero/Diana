/** Configuración de pruebas del worker Diana. Sin PostgreSQL: sólo lógica pura. */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  collectCoverageFrom: ['src/**/*.ts'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/', 'main.ts'],
  testEnvironment: 'node',
  testTimeout: 30000,
};
