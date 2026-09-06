/**
 * Configuración de jest del carril E2E-3.
 *
 * Se ejecuta con el jest y el ts-jest de `server/backend` (ahí están las
 * dependencias y el `tsconfig.json` con el que se compila el propio backend):
 * compilar el código del backend con otro tsconfig sería medir un artefacto
 * distinto del que se despliega.
 *
 *   cd server/backend && npx jest -c ../../tests/e2e/device-management/jest.config.js --maxWorkers=2
 *
 * `maxWorkers` está fijado a 1 aquí a propósito: el escenario levanta
 * contenedores con execFileSync (que BLOQUEA el bucle de eventos) y comparte un
 * único dispositivo de larga vida. Repartirlo entre workers no lo acelera y sí
 * produce rojos por contención, que envenenan cualquier puerta que se apoye en
 * esto.
 */
const path = require('path');

const backend = path.resolve(__dirname, '../../../server/backend');

module.exports = {
  rootDir: __dirname,
  moduleFileExtensions: ['js', 'json', 'ts'],
  // El carril vive fuera de `server/backend`, así que la resolución de módulos
  // tiene que apuntar explícitamente a SUS dependencias: son las mismas con las
  // que corre el backend, y usar otras mediría otro artefacto.
  modulePaths: [path.join(backend, 'node_modules')],
  testRegex: '.*\\.e2e\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': [require.resolve('ts-jest', { paths: [backend] }), { tsconfig: path.join(backend, 'tsconfig.json'), isolatedModules: true }],
  },
  testEnvironment: 'node',
  // El escenario arranca dos contenedores, compila el firmware y aplica
  // migraciones: un timeout corto mide la máquina, no el producto.
  testTimeout: 600000,
  maxWorkers: 1,
  forceExit: false,
};
