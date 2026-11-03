const { rooms, playerToRoom, cleanupPlayerFromRoom } = require('../../lib/roomHelpers');

function handleMessage(msg, ctx) {
  const { ws, userId, sendToAll, sendToOne } = ctx;
  const { type } = msg;

  switch (type) {
    case 'CREATE_ROOM': {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const room = {
        code,
        gameType: 'tictactoe',
        hostId: userId,
        players: [{ id: userId, name: msg.playerName, symbol: 'X', score: 0, isHost: true }],
        board: Array(9).fill(null),
        currentTurn: userId,
        status: 'waiting',
        winner: null
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
      if (room.players.length >= 4) {
        sendToOne(ws, { type: 'ERROR', message: 'Room is full' });
        return;
      }
      const symbols = ['O', '●', '■'];
      const symbol = symbols[room.players.length - 1] || '?';
      room.players.push({ id: userId, name: msg.playerName, symbol, score: 0, isHost: false });
      playerToRoom.set(userId, msg.code.toUpperCase());
      sendToAll(room, { type: 'ROOM_JOINED', code: room.code, room });
      break;
    }

    case 'START_GAME': {
      const room = rooms.get(playerToRoom.get(userId));
      if (!room || room.hostId !== userId) return;
      room.status = 'playing';
      room.board = Array(9).fill(null);
      room.currentTurn = room.players[0].id;
      room.winner = null;
      sendToAll(room, { type: 'GAME_STARTED', room });
      break;
    }

    case 'MAKE_MOVE': {
      const room = rooms.get(playerToRoom.get(userId));
      if (!room || room.status !== 'playing') return;
      if (room.currentTurn !== userId) return;
      if (room.board[msg.index] !== null) return;
      
      const player = room.players.find(p => p.id === userId);
      room.board[msg.index] = player.symbol;
      
      const winningLine = checkWin(room.board);
      if (winningLine) {
        room.status = 'finished';
        room.winner = userId;
        player.score++;
        sendToAll(room, { type: 'GAME_OVER', winnerId: userId, room });
      } else if (!room.board.includes(null)) {
        room.status = 'finished';
        sendToAll(room, { type: 'GAME_DRAW', room });
      } else {
        const nextIndex = (room.players.findIndex(p => p.id === userId) + 1) % room.players.length;
        room.currentTurn = room.players[nextIndex].id;
        sendToAll(room, { type: 'BOARD_UPDATED', room });
      }
      break;
    }
  }
}

function checkWin(board) {
  const lines = [
    [0,1,2], [3,4,5], [6,7,8],
    [0,3,6], [1,4,7], [2,5,8],
    [0,4,8], [2,4,6]
  ];
  for (const [a,b,c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return [a,b,c];
  }
  return null;
}

module.exports = { handleMessage };
