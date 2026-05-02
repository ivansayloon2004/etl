const { MemoryStore } = require("./memoryStore");
const { PostgresStore } = require("./postgresStore");

async function createStore(config) {
  if (config.databaseUrl) {
    try {
      const store = new PostgresStore(config);
      await store.init();
      return store;
    } catch (error) {
      if (!config.enableMemoryFallback) {
        throw error;
      }

      console.warn(`PostgreSQL connection failed. Falling back to memory store: ${error.message}`);
    }
  }

  const store = new MemoryStore(config);
  await store.init();
  return store;
}

module.exports = {
  createStore
};
