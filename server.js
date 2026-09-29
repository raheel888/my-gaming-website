const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

// Serve the game page
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading game');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

// === MULTIPLAYER GAME LOGIC ===
const wss = new WebSocket.Server({ server });
const rooms = new Map();
const ALL_CATEGORIES = [
  { id: 'country', name: 'Country' }, { id: 'city', name: 'City' },
  { id: 'animal', name: 'Animal' }, { id: 'food', name: 'Food' },
  { id: 'color', name: 'Colour' }, { id: 'name', name: 'Name' },
  { id: 'object', name: 'Object' }, { id: 'plant', name: 'Plant' },
  { id: 'brand', name: 'Brand' }, { id: 'movie', name: 'Movie' },
  { id: 'book', name: 'Book' }, { id: 'river', name: 'River' }
];

function makeRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function generateLetter() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const rare = ['Q', 'X', 'Z', 'Y', 'K'];
  let l;
  do {
    l = letters[Math.floor(Math.random() * 26)];
  } while (rare.includes(l) && Math.random() > 0.3);
  return l;
}

function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  room.players.forEach(p => {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  });
}

wss.on('connection', (ws) => {
  let playerId = null;
  let roomCode = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      switch (msg.type) {
        case 'CREATE_ROOM': {
          const code = makeRoomCode();
          const cats = msg.selectedCategories?.length >= 3
            ? ALL_CATEGORIES.filter(c => msg.selectedCategories.includes(c.id))
            : ALL_CATEGORIES.slice(0, 6);
          rooms.set(code, {
            id: code,
            name: msg.roomName || 'Game Room',
            isPrivate: msg.isPrivate || false,
            totalRounds: msg.totalRounds || 5,
            timeLimit: msg.timeLimit || 60,
            maxPlayers: msg.maxPlayers || 8,
            categories: cats,
            players: [],
            currentRound: 0,
            status: 'waiting',
            letter: null,
            answers: {},
            votes: {},
            totals: {}
          });
          playerId = msg.playerId;
          roomCode = code;
          rooms.get(code).players.push({
            id: playerId,
            name: msg.playerName || 'Guest',
            ws,
            isHost: true
          });
          ws.send(JSON.stringify({ type: 'ROOM_CREATED', code, room: rooms.get(code) }));
          broadcast(rooms.get(code), { type: 'PLAYERS_UPDATED', players: rooms.get(code).players.map(p => ({id:p.id,name:p.name,isHost:p.isHost})) });
          break;
        }
        case 'JOIN_ROOM': {
          const room = rooms.get(msg.code);
          if (!room) return ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found' }));
          if (room.players.length >= room.maxPlayers) return ws.send(JSON.stringify({ type: 'ERROR', message: 'Room full' }));
          playerId = msg.playerId;
          roomCode = msg.code;
          room.players.push({
            id: playerId,
            name: msg.playerName || 'Guest',
            ws,
            isHost: false
          });
          ws.send(JSON.stringify({ type: 'ROOM_JOINED', room, playerId }));
          broadcast(room, { type: 'PLAYERS_UPDATED', players: room.players.map(p => ({id:p.id,name:p.name,isHost:p.isHost})) });
          break;
        }
        case 'LIST_ROOMS': {
          const list = Array.from(rooms.values())
            .filter(r => !r.isPrivate && r.status === 'waiting')
            .map(r => ({ code: r.id, name: r.name, players: r.players.length, maxPlayers: r.maxPlayers }));
          ws.send(JSON.stringify({ type: 'ROOM_LIST', rooms: list }));
          break;
        }
        case 'START_GAME': {
          const room = rooms.get(msg.roomCode);
          if (!room) return;
          room.status = 'playing';
          room.currentRound = 1;
          room.letter = generateLetter();
          room.answers = {};
          room.votes = {};
          broadcast(room, {
            type: 'ROUND_START',
            round: room.currentRound,
            totalRounds: room.totalRounds,
            letter: room.letter,
            categories: room.categories,
            timeLimit: room.timeLimit
          });
          break;
        }
        case 'SUBMIT_ANSWER': {
          const room = rooms.get(msg.roomCode);
          if (!room) return;
          if (!room.answers[playerId]) room.answers[playerId] = {};
          room.answers[playerId][msg.categoryId] = msg.answer;
          break;
        }
        case 'PRESSED_STOP': {
          const room = rooms.get(msg.roomCode);
          if (!room || room.status !== 'playing') return;
          room.status = 'voting';
          broadcast(room, { type: 'STOP_CALLED', byName: room.players.find(p => p.id === playerId)?.name });
          setTimeout(() => {
            broadcast(room, { type: 'VOTING_START', answers: room.answers, categories: room.categories });
          }, 500);
          break;
        }
        case 'TIME_UP': {
          const room = rooms.get(msg.roomCode);
          if (!room || room.status !== 'playing') return;
          room.status = 'voting';
          broadcast(room, { type: 'TIME_UP' });
          setTimeout(() => {
            broadcast(room, { type: 'VOTING_START', answers: room.answers, categories: room.categories });
          }, 500);
          break;
        }
        case 'SUBMIT_VOTE': {
          const room = rooms.get(msg.roomCode);
          if (!room) return;
          if (!room.votes[msg.targetPlayer]) room.votes[msg.targetPlayer] = {};
          room.votes[msg.targetPlayer][msg.categoryId] = msg.isValid;
          break;
        }
        case 'FINISH_VOTING': {
          const room = rooms.get(msg.roomCode);
          if (!room) return;
          const seen = new Map();
          for (const pid in room.answers) {
            for (const cat in room.answers[pid]) {
              const key = `${cat}:${(room.answers[pid][cat] || '').toLowerCase().trim()}`;
              seen.set(key, (seen.get(key) || 0) + 1);
            }
          }
          const scores = {};
          for (const pid in room.answers) {
            scores[pid] = {};
            for (const cat of room.categories.map(c => c.id)) {
              const ans = (room.answers[pid]?.[cat] || '').trim();
              const valid = room.votes?.[pid]?.[cat] !== false;
              if (!ans) scores[pid][cat] = 0;
              else if (!valid) scores[pid][cat] = 0;
              else if (seen.get(`${cat}:${ans.toLowerCase()}`) === 1) scores[pid][cat] = 10;
              else scores[pid][cat] = 5;
            }
          }
          if (!room.totals) room.totals = {};
          for (const pid in scores) {
            if (!room.totals[pid]) room.totals[pid] = 0;
            room.totals[pid] += Object.values(scores[pid]).reduce((a, b) => a + b, 0);
          }
          const board = room.players.map(p => ({
            playerId: p.id, name: p.name,
            roundScore: Object.values(scores[p.id] || {}).reduce((a, b) => a + b, 0),
            totalScore: room.totals[p.id]
          })).sort((a, b) => b.totalScore - a.totalScore);
          broadcast(room, { type: 'SCORES', scoreboard: board });
          setTimeout(() => {
            if (room.currentRound >= room.totalRounds) {
              broadcast(room, { type: 'GAME_END', finalRanking: board });
            } else {
              room.currentRound++;
              room.letter = generateLetter();
              room.answers = {};
              room.votes = {};
              room.status = 'playing';
              broadcast(room, {
                type: 'ROUND_START',
                round: room.currentRound,
                totalRounds: room.totalRounds,
                letter: room.letter,
                categories: room.categories,
                timeLimit: room.timeLimit
              });
            }
          }, 5000);
          break;
        }
      }
    } catch (e) { console.error('Message error:', e); }
  });

  ws.on('close', () => {
    if (!roomCode || !playerId) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    const idx = room.players.findIndex(p => p.id === playerId);
    if (idx !== -1) room.players.splice(idx, 1);
    if (room.players.length === 0) rooms.delete(roomCode);
    else broadcast(room, { type: 'PLAYERS_UPDATED', players: room.players.map(p => ({id:p.id,name:p.name,isHost:p.isHost})) });
  });
});

server.listen(PORT, () => {
  console.log(`✅ Categories Stop running on port ${PORT}`);
});