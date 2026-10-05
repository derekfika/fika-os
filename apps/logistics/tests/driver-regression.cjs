const path = require('node:path');
const { fixture } = require('./helpers/authority-route-harness.cjs');
const f = fixture(['van1', 'van2']);
for (const name of ['mobile-driver', 'mobile-projection-first', 'mobile-ui-contract', 'projection-dashboard-adapter']) f.load(path.join(__dirname, name + '.test.ts'));
