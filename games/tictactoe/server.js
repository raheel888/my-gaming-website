const { rooms, playerToRoom, makeRoomCode, broadcastToRoom } = require('../../lib/roomHelpers');

const TTT_CONFIG = {
  2: { n: 3, k: 3 },
  3: { n: 6, k: 4 },
  4: { n: 8, k: 4 }
};

function checkWin(board, idx, player, n, k) {
  const row = Math.floor(idx / n), col = idx % n;
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (const [dr, dc] of dirs) {
    let cells = [idx], r = row + dr, c = col + dc;
    while (r >= 0 && r < n && c >= 0 && c < n && board[r*n + c] === player) {
      cells.push(r*n + c); r += dr; c += dc;
    }
    r = row - dr; c = col - dc;
    while (r >= 0 && r < n && c >= 0 && c < n && board[r*n + c] === player) {
      cells.push(r*n + c); r -= dr; c -= dc;
    }
    if (cells.length >= k) return cells;
  }
  return null;
}

module.exports = {
  gameType: 'tictactoe',

  handleMessage(msg, ctx) {
    switch (msg.type) {
      case 'CREATE_ROOM': return this.createRoom(msg, ctx);
      case 'JOIN_ROOM': return this.joinRoom(msg, ctx);
      case 'LIST_ROOMS': return this.listRooms(msg, ctx);
      case 'START_GAME': return this.startGame(msg, ctx);
      case 'MAKE_MOVE': return this.makeMove(msg, ctx);
    }
  },

  createRoom(msg, { userId, displayName, ws }) {
    if (playerToRoom.has(userId)) {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Already in a room' }));
      return;
    }
    const code = makeRoomCode();
    const room = {
      id: code, gameType: 'tictactoe',
      name: msg.roomName || `${displayName}'s Tic Tac Toe`,
      maxPlayers: msg.maxPlayers || 4, players: [], status: 'waiting',
      board: [], turn: 0, gameOver: false, winningCells: null, scores: Array(4).fill(0)
    };
    rooms.set(code, room);
    playerToRoom.set(userId, code);
    room.players.push({ userId, displayName, ws, isHost: true });
    ws.send(JSON.stringify({ type: 'ROOM_CREATED', code, room, yourId: userId, gameType: 'tictactoe' }));
    broadcastToRoom(room, { type: 'PLAYERS_UPDATED', players: room.players.map(p => ({ userId: p.userId, displayName: p.displayName, isHost: p.isHost })) });
  },

  joinRoom(msg, { userId, displayName, ws }) {
    const code = msg.code?.toUpperCase();
    const room = rooms.get(code);
    if (!room) return ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found' }));
    if (room.players.some(p => p.userId === userId)) {
      playerToRoom.set(userId, code);
      return ws.send(JSON.stringify({ type: 'ROOM_JOINED', room, yourId: userId, isReconnect: true, gameType: 'tictactoe' }));
    }
    if (room.players.length >= room.maxPlayers) return ws.send(JSON.stringify({ type: 'ERROR', message: 'Room full' }));
    playerToRoom.set(userId, code);
    room.players.push({ userId, displayName, ws, isHost: false });
    ws.send(JSON.stringify({ type: 'ROOM_JOINED', room, yourId: userId, gameType: 'tictactoe' }));
    broadcastToRoom(room, { type: 'PLAYERS_UPDATED', players: room.players.map(p => ({ userId: p.userId, displayName: p.displayName, isHost: p.isHost })) });
  },

  listRooms(msg, { ws }) {
    const list = Array.from(rooms.values())
      .filter(r => r.status === 'waiting' && r.gameType === 'tictactoe')
      .map(r => ({ code: r.id, name: r.name, players: r.players.length, maxPlayers: r.maxPlayers, gameType: 'tictactoe' }));
    ws.send(JSON.stringify({ type: 'ROOM_LIST', rooms: list }));
  },

  startGame(msg, { userId }) {
    const room = rooms.get(playerToRoom.get(userId));
    if (!room || !room.players.some(p => p.userId === userId && p.isHost)) return;
    const cfg = TTT_CONFIG[room.maxPlayers];
    room.status = 'playing';
    room.board = Array(cfg.n * cfg.n).fill(null);
    room.turn = 0;
    room.gameOver = false;
    room.winningCells = null;
    room.players.forEach((p, i) => p.ws?.readyState === 1 && p.ws.send(JSON.stringify({ type: 'GAME_START', yourIndex: i, board: room.board, n: cfg.n, k: cfg.k })));
    broadcastToRoom(room, { type: 'STATE_SYNC', board: room.board, turn: room.turn, gameOver: false });
  },

  makeMove(msg, { userId }) {
    const room = rooms.get(playerToRoom.get(userId));
    if (!room || room.status !== 'playing' || room.gameOver) return;
    const idx = room.players.findIndex(p => p.userId === userId);
    if (idx !== room.turn) return;
    const cfg = TTT_CONFIG[room.maxPlayers];
    if (room.board[msg.index] !== null) return;
    room.board[msg.index] = idx;
    const winner = checkWin(room.board, msg.index, idx, cfg.n, cfg.k);
    if (winner) {
      room.gameOver = true;
      room.winningCells = winner;
      room.scores[idx]++;
    } else if (!room.board.includes(null)) {
      room.gameOver = true;
    } else {
      room.turn = (room.turn + 1) % room.players.length;
    }
    broadcastToRoom(room, { type: 'MOVE_MADE', board: room.board, turn: room.turn, gameOver: room.gameOver, winningCells: room.winningCells, scores: room.scores });
  }
};