const path = require('node:path');
const { fixture } = require('./helpers/authority-route-harness.cjs');
const f = fixture(['van1', 'van2'], [], true);
for (const name of ['delivery-loads', 'logistics-materialisation', 'logistics-projection', 'client-projection-safety']) f.load(path.join(__dirname, name + '.test.ts'));
