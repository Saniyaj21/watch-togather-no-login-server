const state = {}; // { [roomId]: { [socketId]: { name, lastSeenAt } } }

module.exports = {
  update(roomId, socketId, name, lastSeenAt) {
    if (!state[roomId]) state[roomId] = {};
    state[roomId][socketId] = { name, lastSeenAt };
  },
  remove(roomId, socketId) {
    if (!state[roomId]) return;
    delete state[roomId][socketId];
    if (Object.keys(state[roomId]).length === 0) delete state[roomId];
  },
  getList(roomId) {
    return Object.values(state[roomId] || {});
  },
};
