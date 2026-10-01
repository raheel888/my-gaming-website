const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

const sessions = new Map();
const rooms = new Map();
const playerToRoom = new Map();

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

function broadcastToRoom(room, message) {
  const data = JSON.stringify(message);
  room.players.forEach(p => {
    if (p.ws?.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  });
}

function cleanupPlayerFromRoom(playerId, room) {
  if (!room) return;
  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx !== -1) room.players.splice(idx, 1);
  playerToRoom.delete(playerId);
  if (room.players.length === 0) {
    rooms.delete(room.id);
  } else {
    if (room.players.every(p => !p.isHost)) {
      room.players[0].isHost = true;
    }
    broadcastToRoom(room, { 
      type: 'PLAYERS_UPDATED', 
      players: room.players.map(p => ({id:p.id,name:p.name,isHost:p.isHost})) 
    });
  }
}

const server = http.createServer((req, res) => {
  let filePath = 'public/index.html';
  if (req.url.startsWith('/categories-stop')) {
    filePath = 'public/categories-stop.html';
  } else {
    filePath = `public${req.url}`;
  }

  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8'
  };

  fs.readFile(path.join(__dirname, filePath), (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h1>404 — Not Found</h1><a href="/">← Go Home</a>');
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let playerId = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      
      if (msg.playerId) {
        playerId = msg.playerId;
        sessions.set(playerId, { 
          name: msg.playerName || 'Guest',
          lastSeen: Date.now()
        });
      }
      if (!playerId) return;
      if (sessions.has(playerId)) {
        sessions.get(playerId).lastSeen = Date.now();
      }

      switch (msg.type) {
        case 'CREATE_ROOM': {
          if (playerToRoom.has(playerId)) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Already in a room — refresh to reset' }));
            return;
          }

          const code = makeRoomCode();
          const cats = msg.selectedCategories?.length >= 3
            ? ALL_CATEGORIES.filter(c => msg.selectedCategories.includes(c.id))
            : ALL_CATEGORIES.slice(0, 6);
          
          const room = {
            id: code,
            name: msg.roomName || `${sessions.get(playerId).name}'s Game`,
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
          
          rooms.set(code, room);
          playerToRoom.set(playerId, code);
          
          room.players.push({
            id: playerId,
            name: sessions.get(playerId).name,
            ws,
            isHost: true
          });
          
          ws.send(JSON.stringify({ type: 'ROOM_CREATED', code, room, yourId: playerId }));
          broadcastToRoom(room, { 
            type: 'PLAYERS_UPDATED', 
            players: room.players.map(p => ({id:p.id,name:p.name,isHost:p.isHost})) 
          });
          break;
        }

        case 'JOIN_ROOM': {
          const targetCode = msg.code?.toUpperCase();
          const targetRoom = rooms.get(targetCode);
          
          if (!targetRoom) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found — check the code!' }));
            return;
          }
          if (targetRoom.status !== 'waiting') {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Game already in progress' }));
            return;
          }
          if (targetRoom.players.length >= targetRoom.maxPlayers) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Room is full' }));
            return;
          }

          const existingCode = playerToRoom.get(playerId);
          if (existingCode && existingCode !== targetCode) {
            cleanupPlayerFromRoom(playerId, rooms.get(existingCode));
          }
          
          const existingPlayer = targetRoom.players.find(p => p.id === playerId);
          if (existingPlayer) {
            existingPlayer.ws = ws;
            playerToRoom.set(playerId, targetCode);
            ws.send(JSON.stringify({ type: 'ROOM_JOINED', room: targetRoom, yourId: playerId, isReconnect: true }));
            return;
          }
          
          playerToRoom.set(playerId, targetCode);
          targetRoom.players.push({
            id: playerId,
            name: sessions.get(playerId).name,
            ws,
            isHost: false
          });
          
          ws.send(JSON.stringify({ type: 'ROOM_JOINED', room: targetRoom, yourId: playerId }));
          broadcastToRoom(targetRoom, { 
            type: 'PLAYERS_UPDATED', 
            players: targetRoom.players.map(p => ({id:p.id,name:p.name,isHost:p.isHost})) 
          });
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
          const room = rooms.get(msg.roomCode || playerToRoom.get(playerId));
          if (!room) return;
          if (!room.players.some(p => p.id === playerId && p.isHost)) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Only host can start' }));
            return;
          }
          
          room.status = 'playing';
          room.currentRound = 1;
          room.letter = generateLetter();
          room.answers = {};
          room.votes = {};
          
          broadcastToRoom(room, {
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
          const room = rooms.get(msg.roomCode || playerToRoom.get(playerId));
          if (!room) return;
          if (!room.answers[playerId]) room.answers[playerId] = {};
          room.answers[playerId][msg.categoryId] = msg.answer || '';
          break;
        }

        // ✅ FIXED: STOP → Voting flow
        case 'PRESSED_STOP': {
          const room = rooms.get(msg.roomCode || playerToRoom.get(playerId));
          if (!room || room.status !== 'playing') return;
          
          room.status = 'voting';
          const byName = room.players.find(p => p.id === playerId)?.name || 'Someone';
          
          // Step 1: Announce STOP to everyone
          broadcastToRoom(room, { type: 'STOP_CALLED', byName });
          
          // Step 2: Immediately send voting data — NO delay gap
          setTimeout(() => {
            const answers = {};
            for (const pid in room.answers) {
              answers[pid] = { ...room.answers[pid] };
            }
            // ✅ Critical: Send to ALL including the person who pressed STOP
            broadcastToRoom(room, {
              type: 'VOTING_START',
              answers: answers,
              categories: room.categories
            });
          }, 500);
          break;
        }

        case 'TIME_UP': {
          const room = rooms.get(msg.roomCode || playerToRoom.get(playerId));
          if (!room || room.status !== 'playing') return;
          
          room.status = 'voting';
          broadcastToRoom(room, { type: 'TIME_UP' });
          
          setTimeout(() => {
            const answers = {};
            for (const pid in room.answers) {
              answers[pid] = { ...room.answers[pid] };
            }
            broadcastToRoom(room, {
              type: 'VOTING_START',
              answers: answers,
              categories: room.categories
            });
          }, 500);
          break;
        }

        case 'SUBMIT_VOTE': {
          const room = rooms.get(msg.roomCode || playerToRoom.get(playerId));
          if (!room) return;
          if (!room.votes[msg.targetPlayer]) room.votes[msg.targetPlayer] = {};
          room.votes[msg.targetPlayer][msg.categoryId] = msg.isValid;
          break;
        }

        case 'FINISH_VOTING': {
          const room = rooms.get(msg.roomCode || playerToRoom.get(playerId));
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
          
          broadcastToRoom(room, { type: 'SCORES', scoreboard: board });
          
          setTimeout(() => {
            if (room.currentRound >= room.totalRounds) {
              broadcastToRoom(room, { type: 'GAME_END', finalRanking: board });
            } else {
              room.currentRound++;
              room.letter = generateLetter();
              room.answers = {};
              room.votes = {};
              room.status = 'playing';
              
              broadcastToRoom(room, {
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
    } catch (e) {
      console.error('Message error:', e);
    }
  });

  ws.on('close', () => {
    if (!playerId) return;
    const code = playerToRoom.get(playerId);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    
    setTimeout(() => {
      const stillConnected = room.players.find(p => p.id === playerId && p.ws?.readyState === WebSocket.OPEN);
      if (!stillConnected) {
        cleanupPlayerFromRoom(playerId, room);
      }
    }, 1000);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
