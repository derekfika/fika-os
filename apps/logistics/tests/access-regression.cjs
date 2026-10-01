const path = require('node:path');
const { typescriptLoader } = require('../../../scripts/testing/load-typescript.cjs');
const appRoot = path.resolve(__dirname, '..');
const load = typescriptLoader({ typescript: require('typescript'), appRoot, mocks: {
  '@fika/server-shared/data-source-meter-server': { recordDataAccess() {}, withDataTrace: (_, callback) => callback() },
  '@fika/server-shared/data-source-meter-client': { recordDataAccess() {}, withDataTrace: (_, callback) => callback() },
} });
for (const name of ['hosting-boundaries', 'admission-middleware', 'mobile-projection-first', 'mobile-driver', 'fixed-van-routes', 'projection-dashboard-adapter', 'planning', 'scheduling', 'projection-fetch']) load(path.join(__dirname, name + '.test.ts'));
