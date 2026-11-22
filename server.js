const path = require('node:path');
const { loadConfig } = require('./src/config');
const { Store } = require('./src/store');
const { createApp } = require('./src/app');

function fail(error) {
  console.error(`Cannot start: ${error.message}`);
  process.exit(1);
}

let config;
let store;
try {
  config = loadConfig();
  store = new Store({ file: path.resolve(config.dataFile) });
} catch (error) {
  fail(error);
}
const server = createApp({ store, config });
server.on('error', fail);
process.on('unhandledRejection', fail);

server.listen(config.port, () => {
  console.log(`Orders server is running on http://localhost:${config.port}`);
  console.log(`Staff screen: http://localhost:${config.port}/staff`);
  if (config.usingDefaultPin) {
    console.warn('STAFF_PIN is not set, using the development PIN 1234');
  }
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
