// Per-request context (who is logged in), readable from views without
// passing it through every function.
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

module.exports = {
  run: (value, fn) => als.run(value, fn),
  viewer: () => (als.getStore() || {}).user || null,
};
