const { ALL_CATEGORIES } = require('../../lib/constants');
const { 
  rooms, playerToRoom, makeRoomCode, generateLetter, 
  broadcastToRoom, cleanupPlayerFromRoom 
} = require('../../lib/roomHelpers');
const { loadData, saveData } = require('../../lib/dataStore');

module.exports = {
  gameType: 'categories',

  handleMessage(msg, ctx) {
    const { type } = msg;
    switch (type) {
      case 'CREATE_ROOM': return this.createRoom(msg, ctx);
      case 'JOIN_ROOM': return this.joinRoom(msg, ctx);
      case 'LIST_ROOMS': return this.listRooms(msg, ctx);
      case 'START_GAME': return this.startGame(msg, ctx);
      case 'SUBMIT_ANSWER': return this.submitAnswer(msg, ctx);
      case 'PRESSED_STOP': return this.pressedStop(msg, ctx);
      case 'TIME_UP': return this.timeUp(msg, ctx);
      case 'SUBMIT_VOTE': return this.submitVote(msg, ctx);
      case 'FINISH_VOTING': return this.finishVoting(msg, ctx);
    }
  },

  createRoom(msg, { userId, displayName, ws }) {
    if (playerToRoom.has(userId)) {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Already in a room' }));
      return;
    }
    const code = makeRoomCode();
    const selectedCats = msg.selectedCategories?.length >= 3
      ? ALL_CATEGORIES.filter(c => msg.selectedCategories.includes(c.id))
      : ALL_CATEGORIES.slice(0, 6);

    const room = {
      id: code,
      gameType: 'categories',
      name: msg.roomName || `${displayName}'s Game`,
      isPrivate: msg.isPrivate || false,
      totalRounds: msg.totalRounds || 5,
      timeLimit: msg.timeLimit || 60,
      maxPlayers: msg.maxPlayers || 8,
      categories: selectedCats,
      players: [],
      currentRound: 0,
      status: 'waiting',
      letter: null,
      answers: {},
      votes: {},
      votersDone: new Set(),
      totals: {},
      stopPressedBy: null,
      stopPressedByName: null,
      lockedPlayers: new Set()
    };

    rooms.set(code, room);
    playerToRoom.set(userId, code);
    room.players.push({ userId, displayName, ws, isHost: true });

    ws.send(JSON.stringify({
      type: 'ROOM_CREATED', code, room, yourId: userId
    }));
    broadcastToRoom(room, {
      type: 'PLAYERS_UPDATED',
      players: room.players.map(p => ({ userId: p.userId, displayName: p.displayName, isHost: p.isHost }))
    });
  },

  joinRoom(msg, { userId, displayName, ws }) {
    const targetCode = msg.code?.toUpperCase();
    const room = rooms.get(targetCode);
    if (!room) return ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found' }));
    if (room.status === 'ended') return ws.send(JSON.stringify({ type: 'ERROR', message: 'Game already finished' }));

    const oldCode = playerToRoom.get(userId);
    if (oldCode && oldCode !== targetCode) {
      cleanupPlayerFromRoom(userId, rooms.get(oldCode));
    }

    const existing = room.players.find(p => p.userId === userId);
    if (existing) {
      existing.ws = ws;
      playerToRoom.set(userId, targetCode);
      return ws.send(JSON.stringify({
        type: 'ROOM_JOINED', room, yourId: userId, isReconnect: true
      }));
    }

    if (room.players.length >= room.maxPlayers) {
      return ws.send(JSON.stringify({ type: 'ERROR', message: 'Room full' }));
    }

    playerToRoom.set(userId, targetCode);
    room.players.push({ userId, displayName, ws, isHost: false });

    ws.send(JSON.stringify({
      type: 'ROOM_JOINED', room, yourId: userId
    }));
    broadcastToRoom(room, {
      type: 'PLAYERS_UPDATED',
      players: room.players.map(p => ({ userId: p.userId, displayName: p.displayName, isHost: p.isHost }))
    });
  },

  listRooms(msg, { ws }) {
    const list = Array.from(rooms.values())
      .filter(r => !r.isPrivate && r.status === 'waiting' && r.gameType === 'categories')
      .map(r => ({
        code: r.id, name: r.name, players: r.players.length, maxPlayers: r.maxPlayers
      }));
    ws.send(JSON.stringify({ type: 'ROOM_LIST', rooms: list }));
  },

  startGame(msg, { userId }) {
    const room = rooms.get(playerToRoom.get(userId));
    if (!room) return;
    if (!room.players.some(p => p.userId === userId && p.isHost)) return;

    room.status = 'playing';
    room.currentRound = 1;
    room.letter = generateLetter();
    room.answers = {};
    room.votes = {};
    room.votersDone = new Set();
    room.totals = room.totals || {};
    room.stopPressedBy = null;
    room.stopPressedByName = null;
    room.lockedPlayers = new Set();

    broadcastToRoom(room, {
      type: 'ROUND_START',
      round: 1, totalRounds: room.totalRounds,
      letter: room.letter, categories: room.categories, timeLimit: room.timeLimit
    });
  },

  submitAnswer(msg, { userId }) {
    const room = rooms.get(playerToRoom.get(userId));
    if (!room || room.status !== 'playing') return;
    if (!room.answers[userId]) room.answers[userId] = {};
    room.answers[userId][msg.categoryId] = msg.answer || '';
  },

  pressedStop(msg, { userId, displayName, ws }) {
    const room = rooms.get(playerToRoom.get(userId));
    if (!room || room.status !== 'playing') return;

    const isHost = room.players.some(p => p.userId === userId && p.isHost);

    // 👑 Host — stop for everyone
    if (isHost) {
      if (room.stopPressedBy) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'STOP already pressed' }));
        return;
      }
      room.stopPressedBy = userId;
      room.stopPressedByName = displayName;
      room.status = 'voting';

      broadcastToRoom(room, {
        type: 'STOP_CALLED', byId: userId, byName: displayName, scope: 'all'
      });

      setTimeout(() => {
        const ans = {};
        for (const pid in room.answers) ans[pid] = { ...room.answers[pid] };
        broadcastToRoom(room, { type: 'VOTING_START', answers: ans, categories: room.categories });
      }, 800);
      return;
    }

    // 👤 Non-host — lock only self
    if (room.lockedPlayers.has(userId)) {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'You already locked your answers' }));
      return;
    }
    room.lockedPlayers.add(userId);
    ws.send(JSON.stringify({
      type: 'SELF_LOCKED',
      message: '✅ Your answers are locked — waiting for others or host'
    }));

    // Everyone locked → auto proceed
    if (room.lockedPlayers.size === room.players.length) {
      room.status = 'voting';
      broadcastToRoom(room, { type: 'STOP_CALLED', byId: null, byName: 'Everyone', scope: 'all' });
      setTimeout(() => {
        const ans = {};
        for (const pid in room.answers) ans[pid] = { ...room.answers[pid] };
        broadcastToRoom(room, { type: 'VOTING_START', answers: ans, categories: room.categories });
      }, 800);
    }
  },

  timeUp(msg, { userId }) {
    const room = rooms.get(playerToRoom.get(userId));
    if (!room || room.status !== 'playing' || room.stopPressedBy) return;
    room.status = 'voting';
    broadcastToRoom(room, { type: 'TIME_UP' });
    setTimeout(() => {
      const ans = {};
      for (const pid in room.answers) ans[pid] = { ...room.answers[pid] };
      broadcastToRoom(room, { type: 'VOTING_START', answers: ans, categories: room.categories });
    }, 500);
  },

  submitVote(msg, { userId }) {
    const room = rooms.get(playerToRoom.get(userId));
    if (!room) return;
    if (!room.votes[msg.targetPlayer]) room.votes[msg.targetPlayer] = {};
    room.votes[msg.targetPlayer][msg.categoryId] = msg.isValid;
  },

  finishVoting(msg, { userId }) {
    const room = rooms.get(playerToRoom.get(userId));
    if (!room) return;
    if (!room.votersDone) room.votersDone = new Set();
    room.votersDone.add(userId);

    const allIds = room.players.map(p => p.userId);
    const everyoneVoted = allIds.every(pid => room.votersDone.has(pid));
    if (!everyoneVoted) return;

    // Calculate scores
    const seen = new Map();
    for (const pid in room.answers) {
      for (const cat in room.answers[pid]) {
        const v = (room.answers[pid][cat] || '').toLowerCase().trim();
        if (v) seen.set(`${cat}:${v}`, (seen.get(`${cat}:${v}`) || 0) + 1);
      }
    }

    const scores = {};
    for (const pid in room.answers) {
      scores[pid] = {};
      for (const cat of room.categories.map(c => c.id)) {
        const ans = (room.answers[pid]?.[cat] || '').trim();
        let validVotes = 0, invalidVotes = 0;
        for (const voter in room.votes || {}) {
          if (voter === pid) continue;
          if (room.votes[voter]?.[cat] === true) validVotes++;
          if (room.votes[voter]?.[cat] === false) invalidVotes++;
        }
        const isValid = validVotes >= invalidVotes;
        if (!ans) scores[pid][cat] = 0;
        else if (!isValid) scores[pid][cat] = 0;
        else if (seen.get(`${cat}:${ans.toLowerCase()}`) === 1) scores[pid][cat] = 10;
        else scores[pid][cat] = 5;
      }
    }

    if (!room.totals) room.totals = {};
    for (const pid in scores) {
      if (!room.totals[pid]) room.totals[pid] = 0;
      room.totals[pid] += Object.values(scores[pid]).reduce((a, b) => a + b, 0);
    }

    const scoreboard = room.players.map(p => ({
      userId: p.userId, displayName: p.displayName,
      roundScore: Object.values(scores[p.userId] || {}).reduce((a, b) => a + b, 0),
      totalScore: room.totals[p.userId]
    })).sort((a, b) => b.totalScore - a.totalScore);

    broadcastToRoom(room, { type: 'SCORES', scoreboard });

    // Next round or game end
    if (room.currentRound >= room.totalRounds) {
      const data = loadData();
      for (const pid in room.totals) {
        const entry = Object.entries(data.users).find(([_, u]) => u.userId === pid);
        if (entry) {
          entry[1].gamesPlayed = (entry[1].gamesPlayed || 0) + 1;
          entry[1].totalScore = (entry[1].totalScore || 0) + room.totals[pid];
        }
      }
      saveData(data);
      room.status = 'ended';
      broadcastToRoom(room, { type: 'GAME_END', finalRanking: scoreboard });
      rooms.delete(room.id);
    } else {
      room.currentRound++;
      room.letter = generateLetter();
      room.answers = {};
      room.votes = {};
      room.votersDone = new Set();
      room.stopPressedBy = null;
      room.stopPressedByName = null;
      room.lockedPlayers = new Set();
      room.status = 'playing';
      broadcastToRoom(room, {
        type: 'ROUND_START',
        round: room.currentRound, totalRounds: room.totalRounds,
        letter: room.letter, categories: room.categories, timeLimit: room.timeLimit
      });
    }
  }
};