const { rooms, playerToRoom, cleanupPlayerFromRoom } = require('../../lib/roomHelpers');
const { CATEGORIES } = require('./config');

function handleMessage(msg, ctx) {
  const { ws, userId, sendToAll, sendToOne } = ctx;
  const { type } = msg;

  switch (type) {
    case 'CREATE_ROOM': {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const room = {
        code,
        gameType: 'categories',
        hostId: userId,
        players: [{ id: userId, name: msg.playerName, score: 0, isHost: true }],
        categories: [],
        roundCount: parseInt(msg.rounds) || 3,
        currentRound: 0,
        status: 'waiting',
        answers: {},
        verifiedBy: {},
        lockedPlayers: new Set()
      };
      rooms.set(code, room);
      playerToRoom.set(userId, code);
      sendToOne(ws, { type: 'ROOM_CREATED', code, room });
      break;
    }

    case 'JOIN_ROOM': {
      const room = rooms.get(msg.code?.toUpperCase());
      if (!room) {
        sendToOne(ws, { type: 'ERROR', message: 'Room not found' });
        return;
      }
      if (room.status !== 'waiting') {
        sendToOne(ws, { type: 'ERROR', message: 'Game already in progress' });
        return;
      }
      room.players.push({ id: userId, name: msg.playerName, score: 0, isHost: false });
      playerToRoom.set(userId, msg.code.toUpperCase());
      sendToAll(room, { type: 'ROOM_JOINED', code: room.code, room });
      break;
    }

    case 'SELECT_CATEGORIES': {
      const room = rooms.get(playerToRoom.get(userId));
      if (!room || room.hostId !== userId) return;
      room.categories = CATEGORIES.filter(c => msg.selectedIds?.includes(c.id));
      sendToAll(room, { type: 'CATEGORIES_UPDATED', categories: room.categories });
      break;
    }

    case 'START_GAME': {
      const room = rooms.get(playerToRoom.get(userId));
      if (!room || room.hostId !== userId) return;
      room.status = 'playing';
      room.currentRound = 1;
      room.lockedPlayers = new Set();
      sendToAll(room, { 
        type: 'ROUND_START', 
        round: room.currentRound,
        totalRounds: room.roundCount,
        category: room.categories[0]
      });
      break;
    }

    case 'SUBMIT_ANSWER': {
      const room = rooms.get(playerToRoom.get(userId));
      if (!room || room.lockedPlayers.has(userId)) return;
      if (!room.answers[userId]) room.answers[userId] = [];
      room.answers[userId].push(msg.answer);
      sendToAll(room, { type: 'ANSWER_RECEIVED', playerId: userId, answer: msg.answer });
      break;
    }

    case 'STOP_GAME': {
      const roomCode = playerToRoom.get(userId);
      const room = rooms.get(roomCode);
      if (!room) return;
      if (room.hostId === userId) {
        sendToAll(room, { type: 'GAME_STOPPED_BY_HOST' });
      } else {
        room.lockedPlayers.add(userId);
        sendToOne(ws, { type: 'STOPPED_FOR_YOU' });
      }
      break;
    }

    case 'FINISH_VERIFICATION': {
      const room = rooms.get(playerToRoom.get(userId));
      if (!room) return;
      sendToAll(room, { type: 'ROUND_RESULTS', results: room.answers });
      break;
    }
  }
}

module.exports = { handleMessage };
