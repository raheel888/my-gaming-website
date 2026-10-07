const { rooms, playerToRoom, cleanupPlayerFromRoom } = require('./roomHelpers');

const gameHandlers = {};

function registerGame(gameType, handler) {
  gameHandlers[gameType] = handler;
  console.log(`🎮 Registered game: ${gameType}`);
}

function dispatchMessage(msg, ctx) {
  const gameType = msg.gameType || 'categories';
  const handler = gameHandlers[gameType];
  if (!handler) {
    ctx.ws.send(JSON.stringify({ type: 'ERROR', message: 'Unknown game type' }));
    return;
  }
  if (typeof handler.handleMessage === 'function') {
    handler.handleMessage(msg, { ...ctx, rooms, playerToRoom });
  }
}

function cleanupDisconnect(userId) {
  const roomCode = playerToRoom.get(userId);
  if (roomCode) cleanupPlayerFromRoom(userId, rooms.get(roomCode));
}

module.exports = { registerGame, dispatchMessage, cleanupDisconnect };