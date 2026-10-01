const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

// === PERSISTENT STORE — in-memory now, database later ===
const sessions = new Map();       // playerId → { name, lastSeen }
const rooms = new Map();          // roomCode → room object
const playerToRoom = new Map();   // playerId → roomCode (track who is where)

const ALL_CATEGORIES = [
  { id: 'country', name: 'Country' }, { id: 'city', name: 'City' },
  { id: 'animal', name: 'Animal' }, { id: 'food', name: 'Food' },
  { id: 'color', name: 'Colour' }, { id: 'name', name: 'Name' },
  { id: 'object', name: 'Object' }, { id: 'plant', name: 'Plant' },
  { id: 'brand', name: 'Brand' }, { id: 'movie', name: 'Movie' },
  { id: 'book', name: 'Book' }, { id: 'river', name: 'River' }
];

// === HELPERS ===
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

function broadcast(room, excludePlayerId = null) {
  return (msg) => {
    const data = JSON.stringify(msg);
    room.players.forEach(p => {
      if (p.id !== excludePlayerId && p.ws?.readyState === WebSocket.OPEN) {
        p.ws.send(data);
      }
    });
  };
}

function cleanupPlayerFromRoom(playerId, room) {
  if (!room) return;
  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx !== -1) room.players.splice(idx, 1);
  playerToRoom.delete(playerId);
  if (room.players.length === 0) {
    rooms.delete(room.id);
  } else {
    // Transfer host if needed
    if (room.players.every(p => !p.isHost)) {
      room.players[0].isHost = true;
    }
    broadcast(room)({ type: 'PLAYERS_UPDATED', players: room.players.map(p => ({id:p.id,name:p.name,isHost:p.isHost})) });
  }
}

// === HTTP SERVER — Serve Pages ===
const server = http.createServer((req, res) => {
  console.log(`➡️ ${req.method} ${req.url}`);

  let filePath = 'public/index.html';
  if (req.url === '/' || req.url === '/index.html') {
    filePath = 'public/index.html';
  } else if (req.url.startsWith('/categories-stop')) {
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

// === WEBSOCKET — GAME LOGIC ===
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let playerId = null;
  let roomCode = null;
  let room = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      
      // Track identity from first message
      if (msg.playerId) {
        playerId = msg.playerId;
        sessions.set(playerId, { 
          name: msg.playerName || 'Guest',
          lastSeen: Date.now()
        });
      }
      
      if (!playerId) return;

      // Update last seen
      if (sessions.has(playerId)) {
        sessions.get(playerId).lastSeen = Date.now();
      }

      switch (msg.type) {
        // ─── CREATE ROOM ───
        case 'CREATE_ROOM': {
          // Prevent duplicate room membership
          if (playerToRoom.has(playerId)) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'You are already in a room — refresh to reset' }));
            return;
          }

          const code = makeRoomCode();
          const cats = msg.selectedCategories?.length >= 3
            ? ALL_CATEGORIES.filter(c => msg.selectedCategories.includes(c.id))
            : ALL_CATEGORIES.slice(0, 6);
          
          room = {
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
          
          roomCode = code;
          rooms.set(code, room);
          playerToRoom.set(playerId, code);
          
          room.players.push({
            id: playerId,
            name: sessions.get(playerId).name,
            ws,
            isHost: true
          });
          
          ws.send(JSON.stringify({ 
            type: 'ROOM_CREATED', 
            code, 
            room,
            yourId: playerId
          }));
          broadcast(room, playerId)({ 
            type: 'PLAYERS_UPDATED', 
            players: room.players.map(p => ({id:p.id,name:p.name,isHost:p.isHost})) 
          });
          break;
        }

        // ─── JOIN ROOM ───
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

          // 🔑 KEY FIX: Leave old room if rejoining same/different room
          const existingRoomCode = playerToRoom.get(playerId);
          if (existingRoomCode && existingRoomCode !== targetCode) {
            cleanupPlayerFromRoom(playerId, rooms.get(existingRoomCode));
          }
          
          // Prevent duplicates in THIS room
          const existingPlayer = targetRoom.players.find(p => p.id === playerId);
          if (existingPlayer) {
            // Reconnection — update their WebSocket only
            existingPlayer.ws = ws;
            room = targetRoom;
            roomCode = targetCode;
            playerToRoom.set(playerId, targetCode);
            
            ws.send(JSON.stringify({ 
              type: 'ROOM_JOINED', 
              room,
              yourId: playerId,
              isReconnect: true
            }));
            return; // ← NO new player added! ✅
          }
          
          // Fresh join
          room = targetRoom;
          roomCode = targetCode;
          playerToRoom.set(playerId, targetCode);
          
          room.players.push({
            id: playerId,
            name: sessions.get(playerId).name,
            ws,
            isHost: false
          });
          
          ws.send(JSON.stringify({ 
            type: 'ROOM_JOINED', 
            room,
            yourId: playerId
          }));
          broadcast(room, playerId)({ 
            type: 'PLAYERS_UPDATED', 
            players: room.players.map(p => ({id:p.id,name:p.name,isHost:p.isHost})) 
          });
          break;
        }

        // ─── LIST ROOMS ───
        case 'LIST_ROOMS': {
          const list = Array.from(rooms.values())
            .filter(r => !r.isPrivate && r.status === 'waiting')
            .map(r => ({ 
              code: r.id, 
              name: r.name, 
              players: r.players.length, 
              maxPlayers: r.maxPlayers 
            }));
          ws.send(JSON.stringify({ type: 'ROOM_LIST', rooms: list }));
          break;
        }

        // ─── START GAME ───
        case 'START_GAME': {
          room = rooms.get(msg.roomCode || roomCode);
          if (!room) return;
          
          const isHost = room.players.some(p => p.id === playerId && p.isHost);
          if (!isHost) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Only host can start' }));
            return;
          }
          
          room.status = 'playing';
          room.currentRound = 1;
          room.letter = generateLetter();
          room.answers = {};
          room.votes = {};
          
          const startMsg = {
            type: 'ROUND_START',
            round: room.currentRound,
            totalRounds: room.totalRounds,
            letter: room.letter,
            categories: room.categories,
            timeLimit: room.timeLimit
          };
          
          room.players.forEach(p => {
            if (p.ws.readyState === WebSocket.OPEN) {
              p.ws.send(JSON.stringify(startMsg));
            }
          });
          break;
        }

        // ─── SUBMIT ANSWER ───
        case 'SUBMIT_ANSWER': {
          room = rooms.get(msg.roomCode || roomCode);
          if (!room) return;
          if (!room.answers[playerId]) room.answers[playerId] = {};
          room.answers[playerId][msg.categoryId] = msg.answer || '';
          break;
        }

        // ─── PRESSED STOP ───
        case 'PRESSED_STOP': {
          room = rooms.get(msg.roomCode || roomCode);
          if (!room || room.status !== 'playing') return;
          room.status = 'voting';
          const byName = room.players.find(p => p.id === playerId)?.name || 'Someone';
          
          const stopMsg = { type: 'STOP_CALLED', byName };
          room.players.forEach(p => {
            if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(stopMsg));
          });
          
          setTimeout(() => {
            const ansData = {};
            for (const pid in room.answers) {
              ansData[pid] = { ...room.answers[pid] };
            }
            const voteMsg = { type: 'VOTING_START', answers: ansData, categories: room.categories };
            room.players.forEach(p => {
              if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(voteMsg));
            });
          }, 600);
          break;
        }

        // ─── TIME UP ───
        case 'TIME_UP': {
          room = rooms.get(msg.roomCode || roomCode);
          if (!room || room.status !== 'playing') return;
          room.status = 'voting';
          
          const timeMsg = { type: 'TIME_UP' };
          room.players.forEach(p => {
            if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(timeMsg));
          });
          
          setTimeout(() => {
            const ansData = {};
            for (const pid in room.answers) {
              ansData[pid] = { ...room.answers[pid] };
            }
            const voteMsg = { type: 'VOTING_START', answers: ansData, categories: room.categories };
            room.players.forEach(p => {
              if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(voteMsg));
            });
          }, 600);
          break;
        }

        // ─── SUBMIT VOTE ───
        case 'SUBMIT_VOTE': {
          room = rooms.get(msg.roomCode || roomCode);
          if (!room) return;
          if (!room.votes[msg.targetPlayer]) room.votes[msg.targetPlayer] = {};
          room.votes[msg.targetPlayer][msg.categoryId] = msg.isValid;
          break;
        }

        // ─── FINISH VOTING ───
        case 'FINISH_VOTING': {
          room = rooms.get(msg.roomCode || roomCode);
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
          
          const scoreMsg = { type: 'SCORES', scoreboard: board };
          room.players.forEach(p => {
            if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(scoreMsg));
          });
          
          setTimeout(() => {
            if (room.currentRound >= room.totalRounds) {
              const endMsg = { type: 'GAME_END', finalRanking: board };
              room.players.forEach(p => {
                if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(endMsg));
              });
            } else {
              room.currentRound++;
              room.letter = generateLetter();
              room.answers = {};
              room.votes = {};
              room.status = 'playing';
              
              const nextMsg = {
                type: 'ROUND_START',
                round: room.currentRound,
                totalRounds: room.totalRounds,
                letter: room.letter,
                categories: room.categories,
                timeLimit: room.timeLimit
              };
              room.players.forEach(p => {
                if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(nextMsg));
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

  // ─── DISCONNECTION HANDLING ───
  ws.on('close', () => {
    if (!playerId) return;
    
    const currentRoomCode = playerToRoom.get(playerId);
    if (!currentRoomCode) return;
    
    const currentRoom = rooms.get(currentRoomCode);
    if (!currentRoom) return;
    
    // Only remove if they didn't just reconnect elsewhere
    // Brief grace period so quick refresh = reconnection, not removal
    setTimeout(() => {
      // If still not connected after grace period → remove
      if (playerToRoom.has(playerId)) {
        const stillHere = currentRoom.players.find(p => p.id === playerId && p.ws.readyState === WebSocket.OPEN);
        if (!stillHere) {
          cleanupPlayerFromRoom(playerId, currentRoom);
        }
      }
    }, 1000); // 1 second grace for reconnection
  });
});

server.listen(PORT, () => {
  console.log(`✅ Game server running on port ${PORT}`);
});
