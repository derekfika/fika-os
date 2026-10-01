const path = require('node:path');
const { typescriptLoader } = require('../../../scripts/testing/load-typescript.cjs');
const appRoot = path.resolve(__dirname, '..');
const load = typescriptLoader({ typescript: require('typescript'), appRoot, mocks: {
  [path.join(appRoot, 'lib/authmod-core/firestore-repository.ts')]: {},
  '@fika/server-shared/data-source-meter-server': { recordDataAccess() {} },
} });
// Run the existing assertions unchanged, using the same core code as production.
for (const name of ['authmod-vehicle-entitlement', 'authmod-core']) load(path.join(__dirname, name + '.test.ts'));
