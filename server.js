const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

// Serve pages
const server = http.createServer((req, res) => {
  console.log(`➡️ ${req.method} ${req.url}`);

  let filePath = 'public/index.html'; // default = homepage
  if (req.url === '/' || req.url === '/home' || req.url === '/index.html') {
    filePath = 'public/index.html';
  } else if (req.url === '/categories-stop' || req.url === '/categories-stop.html') {
    filePath = 'public/categories-stop.html';
  } else {
    filePath = `public${req.url}`;
  }

  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json'
  };

  fs.readFile(path.join(__dirname, filePath), (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h1>404 — Page not found</h1><a href="/">← Go Home</a>');
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
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
  const rare = ['Q','X','Z','Y','K'];
  let l;
  do { l = letters[Math.floor(Math.random()*26)]; }
  while (rare.includes(l) && Math.random() > 0.3);
  return l;
}

function broadcast(room, excludeId = null) {
  return (msg) => {
    const data = JSON.stringify(msg);
    room.players.forEach(p => {
      if (p.id !== excludeId && p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(data);
      }
    });
  };
}

wss.on('connection', (ws) => {
  let playerId = null;
  let roomCode = null;
  let room = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      switch (msg.type) {
        case 'CREATE_ROOM': {
          const code = makeRoomCode();
          const cats = msg.selectedCategories?.length >= 3
            ? ALL_CATEGORIES.filter(c => msg.selectedCategories.includes(c.id))
            : ALL_CATEGORIES.slice(0, 6);
          
          room = {
            id: code,
            name: msg.roomName || `${msg.playerName}'s Game`,
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
          };
          
          playerId = msg.playerId;
          roomCode = code;
          rooms.set(code, room);
          
          room.players.push({
            id: playerId,
            name: msg.playerName || 'Guest',
            ws,
            isHost: true
          });
          
          ws.send(JSON.stringify({ type: 'ROOM_CREATED', code, room }));
          broadcast(room)({ type: 'PLAYERS_UPDATED', players: room.players.map(p => ({id:p.id,name:p.name,isHost:p.isHost})) });
          break;
        }

        case 'JOIN_ROOM': {
          roomCode = msg.code?.toUpperCase();
          room = rooms.get(roomCode);
          
          if (!room) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found — check the code!' }));
            return;
          }
          if (room.players.length >= room.maxPlayers) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Room is full' }));
            return;
          }
          if (room.status !== 'waiting') {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Game already in progress' }));
            return;
          }
          
          playerId = msg.playerId;
          room.players.push({
            id: playerId,
            name: msg.playerName || 'Guest',
            ws,
            isHost: false
          });
          
          ws.send(JSON.stringify({ type: 'ROOM_JOINED', room, playerId }));
          broadcast(room)({ type: 'PLAYERS_UPDATED', players: room.players.map(p => ({id:p.id,name:p.name,isHost:p.isHost})) });
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
          if (!room) return;
          room.status = 'playing';
          room.currentRound = 1;
          room.letter = generateLetter();
          room.answers = {};
          room.votes = {};
          
          broadcast(room)({
            type: 'ROUND_START',
            round: room.currentRound,
            totalRounds: room.totalRounds,
            letter: room.letter,
            categories: room.categories,
            timeLimit: room.timeLimit
          });
          // Also send to host who sent this message
          ws.send(JSON.stringify({
            type: 'ROUND_START',
            round: room.currentRound,
            totalRounds: room.totalRounds,
            letter: room.letter,
            categories: room.categories,
            timeLimit: room.timeLimit
          }));
          break;
        }

        case 'SUBMIT_ANSWER': {
          if (!room) return;
          if (!room.answers[playerId]) room.answers[playerId] = {};
          room.answers[playerId][msg.categoryId] = msg.answer || '';
          break;
        }

        case 'PRESSED_STOP': {
          if (!room || room.status !== 'playing') return;
          room.status = 'voting';
          const byName = room.players.find(p => p.id === playerId)?.name || 'Someone';
          broadcast(room)({ type: 'STOP_CALLED', byName });
          ws.send(JSON.stringify({ type: 'STOP_CALLED', byName }));
          
          setTimeout(() => {
            const ansData = {};
            for (const pid in room.answers) {
              ansData[pid] = { ...room.answers[pid] };
            }
            broadcast(room)({ type: 'VOTING_START', answers: ansData, categories: room.categories });
            ws.send(JSON.stringify({ type: 'VOTING_START', answers: ansData, categories: room.categories }));
          }, 600);
          break;
        }

        case 'TIME_UP': {
          if (!room || room.status !== 'playing') return;
          room.status = 'voting';
          broadcast(room)({ type: 'TIME_UP' });
          ws.send(JSON.stringify({ type: 'TIME_UP' }));
          
          setTimeout(() => {
            const ansData = {};
            for (const pid in room.answers) {
              ansData[pid] = { ...room.answers[pid] };
            }
            broadcast(room)({ type: 'VOTING_START', answers: ansData, categories: room.categories });
            ws.send(JSON.stringify({ type: 'VOTING_START', answers: ansData, categories: room.categories }));
          }, 600);
          break;
        }

        case 'SUBMIT_VOTE': {
          if (!room) return;
          if (!room.votes[msg.targetPlayer]) room.votes[msg.targetPlayer] = {};
          room.votes[msg.targetPlayer][msg.categoryId] = msg.isValid;
          break;
        }

        case 'FINISH_VOTING': {
          if (!room) return;
          
          const seen = new Map();
          for (const pid in room.answers) {
            for (const cat in room.answers[pid]) {
              const val = (room.answers[pid][cat] || '').toLowerCase().trim();
              if (val) seen.set(`${cat}:${val}`, (seen.get(`${cat}:${val}`) || 0) + 1);
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
          
          broadcast(room)({ type: 'SCORES', scoreboard: board });
          ws.send(JSON.stringify({ type: 'SCORES', scoreboard: board }));
          
          setTimeout(() => {
            if (room.currentRound >= room.totalRounds) {
              broadcast(room)({ type: 'GAME_END', finalRanking: board });
              ws.send(JSON.stringify({ type: 'GAME_END', finalRanking: board }));
            } else {
              room.currentRound++;
              room.letter = generateLetter();
              room.answers = {};
              room.votes = {};
              room.status = 'playing';
              
              broadcast(room)({
                type: 'ROUND_START',
                round: room.currentRound,
                totalRounds: room.totalRounds,
                letter: room.letter,
                categories: room.categories,
                timeLimit: room.timeLimit
              });
              ws.send(JSON.stringify({
                type: 'ROUND_START',
                round: room.currentRound,
                totalRounds: room.totalRounds,
                letter: room.letter,
                categories: room.categories,
                timeLimit: room.timeLimit
              }));
            }
          }, 5000);
          break;
        }
      }
    } catch (e) {
      console.error('Message error:', e);
    }
  });

  ws.on('close', () => {
    if (!roomCode || !playerId) return;
    const r = rooms.get(roomCode);
    if (!r) return;
    const idx = r.players.findIndex(p => p.id === playerId);
    if (idx !== -1) r.players.splice(idx, 1);
    
    if (r.players.length === 0) {
      rooms.delete(roomCode);
    } else {
      broadcast(r)({ type: 'PLAYERS_UPDATED', players: r.players.map(p => ({id:p.id,name:p.name,isHost:p.isHost})) });
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
