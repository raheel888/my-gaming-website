const rooms = new Map();
const playerToRoom = new Map();

function makeRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function generateLetter() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const rare = ['Q','X','Z','Y','K'];
  let l;
  do {
    l = letters[Math.floor(Math.random() * 26)];
  } while (rare.includes(l) && Math.random() > 0.3);
  return l;
}

function broadcastToRoom(room, message) {
  const data = JSON.stringify(message);
  room.players.forEach(p => {
    if (p.ws?.readyState === 1) p.ws.send(data);
  });
}

function cleanupPlayerFromRoom(userId, room) {
  if (!room) return;
  const stillHere = room.players.filter(p => p.userId !== userId);

  if (stillHere.length === 0) {
    rooms.delete(room.id);
    playerToRoom.delete(userId);
    return;
  }

  playerToRoom.delete(userId);
  if (!stillHere.some(p => p.isHost)) stillHere[0].isHost = true;
  room.players = stillHere;

  broadcastToRoom(room, {
    type: 'PLAYERS_UPDATED',
    players: stillHere.map(p => ({ userId: p.userId, displayName: p.displayName, isHost: p.isHost }))
  });
}

module.exports = {
  rooms,
  playerToRoom,
  makeRoomCode,
  generateLetter,
  broadcastToRoom,
  cleanupPlayerFromRoom
};