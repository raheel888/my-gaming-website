const WS_PROTO = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTO}//${location.host}`;

const PLAYER_COLOURS = ['p0', 'p1', 'p2', 'p3'];
const PLAYER_SYMBOLS = ['●', '✖', '▲', '◆'];

let ws = null;
let playerId = null;
let playerIndex = null;
let currentRoom = null;
let currentRoomCode = null;
let lastRoomCode = null;
let reconnectAttempts = 0;
let board = [];
let boardSize = 3;
let winLength = 3;

// ─── Connection ───
async function connect() {
  document.getElementById('connection-status').textContent = '🔄 Connecting...';
  
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    const token = document.cookie.split('; ').find(r => r.startsWith('auth_token='))?.split('=')[1] || '';
    ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
  } catch {
    ws = new WebSocket(WS_URL);
  }

  ws.onopen = () => {
    document.getElementById('connection-status').textContent = '✅ Connected';
    reconnectAttempts = 0;
    refreshRoomList();
    if (lastRoomCode && !currentRoomCode) {
      setTimeout(() => {
        document.getElementById('join-code').value = lastRoomCode;
        send({ type: 'JOIN_ROOM', code: lastRoomCode, gameType: 'tictactoe' });
      }, 600);
    }
  };

  ws.onclose = () => {
    document.getElementById('connection-status').textContent = '🔄 Disconnected';
    if (reconnectAttempts < 10) {
      reconnectAttempts++;
      setTimeout(connect, Math.min(1000 * reconnectAttempts, 8000));
    }
  };

  ws.onmessage = e => handleMessage(JSON.parse(e.data));
}

function send(msg) {
  msg.gameType = 'tictactoe';
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else showError('Reconnecting...');
}

// ─── Message Handler ───
function handleMessage(msg) {
  switch (msg.type) {
    case 'ROOM_CREATED':
      saveRoomCode(msg.code);
      currentRoom = msg.room;
      currentRoomCode = msg.code;
      playerId = msg.yourId;
      document.getElementById('show-code').textContent = msg.code;
      showScreen('room');
      renderPlayers(msg.room.players);
      showSuccess('Room created!');
      break;

    case 'ROOM_JOINED':
      saveRoomCode(msg.code);
      currentRoom = msg.room;
      currentRoomCode = msg.code;
      playerId = msg.yourId;
      document.getElementById('show-code').textContent = msg.code;
      showScreen('room');
      renderPlayers(msg.room.players);
      if (msg.isReconnect) showSuccess('✅ Reconnected!');
      break;

    case 'PLAYERS_UPDATED':
      if (currentRoom) currentRoom.players = msg.players;
      renderPlayers(msg.players);
      break;

    case 'ROOM_LIST':
      renderRoomList(msg.rooms);
      break;

    case 'ERROR':
      showError(msg.message);
      break;

    case 'GAME_START':
      board = [...msg.board];
      boardSize = msg.n;
      winLength = msg.k;
      playerIndex = msg.yourIndex;
      renderBoard();
      updateTurnIndicator(0);
      showScreen('playing');
      break;

    case 'STATE_SYNC':
      board = [...msg.board];
      renderBoard();
      updateTurnIndicator(msg.turn, msg.gameOver);
      break;

    case 'MOVE_MADE':
      board = [...msg.board];
      renderBoard(msg.winningCells);
      updateTurnIndicator(msg.turn, msg.gameOver);
      if (msg.gameOver) handleGameOver(msg);
      break;
  }
}

// ─── UI Helpers ───
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
  hideMessages();
}

function saveRoomCode(code) {
  lastRoomCode = code; currentRoomCode = code;
  try { localStorage.setItem('ttt_last_room', code); } catch {}
}

function renderPlayers(players) {
  const list = document.getElementById('player-list');
  list.innerHTML = players.map((p, i) => `
    <div class="player-row ${p.userId === playerId ? 'you' : ''}">
      <span class="${PLAYER_COLOURS[i]}">${PLAYER_SYMBOLS[i]} ${p.displayName}${p.userId === playerId ? ' (You)' : ''}</span>
      ${p.isHost ? '<span class="host-badge">HOST</span>' : ''}
    </div>`).join('');

  const startBtn = document.getElementById('start-btn');
  if (startBtn) {
    const amHost = players.some(p => p.userId === playerId && p.isHost);
    startBtn.style.display = amHost ? 'inline-block' : 'none';
  }
}

function renderRoomList(rooms) {
  const filtered = rooms?.filter(r => r.gameType === 'tictactoe') || [];
  const container = document.getElementById('room-list');
  if (!filtered.length) {
    container.innerHTML = '<p style="color:var(--muted);">No rooms found. Create one below!</p>';
    return;
  }
  container.innerHTML = filtered.map(r => `
    <div class="room-item" onclick="joinCodeDirect('${r.code}')">
      <div style="font-weight:600;">${r.name}</div>
      <div style="color:var(--muted);font-size:0.9rem;">${r.players}/${r.maxPlayers} players</div>
    </div>`).join('');
}

// ─── Board Rendering ───
function renderBoard(winningCells = []) {
  const container = document.getElementById('game-board');
  container.style.gridTemplateColumns = `repeat(${boardSize}, 1fr)`;
  container.innerHTML = '';
  
  for (let i = 0; i < boardSize * boardSize; i++) {
    const cell = document.createElement('div');
    cell.className = 'board-cell';
    if (board[i] !== null) {
      cell.classList.add('taken', PLAYER_COLOURS[board[i]]);
      cell.textContent = PLAYER_SYMBOLS[board[i]];
    }
    if (winningCells?.includes(i)) {
      cell.classList.add('winning');
    }
    if (board[i] === null) {
      cell.addEventListener('click', () => makeMove(i));
    }
    container.appendChild(cell);
  }
}

function updateTurnIndicator(turnIndex, gameOver = false) {
  const indicator = document.getElementById('turn-indicator');
  if (gameOver) {
    indicator.textContent = 'Game Over';
    indicator.className = 'announce';
    return;
  }
  const isMyTurn = turnIndex === playerIndex;
  const playerName = currentRoom?.players[turnIndex]?.displayName || 'Player';
  indicator.textContent = isMyTurn ? '✅ Your turn!' : `⏳ ${playerName}'s turn...`;
  indicator.className = `announce ${isMyTurn ? 'your-turn' : 'their-turn'}`;
  
  updateScoreChips(turnIndex);
}

function updateScoreChips(turnIndex) {
  const container = document.getElementById('player-scores');
  if (!currentRoom?.players) return;
  container.innerHTML = currentRoom.players.map((p, i) => `
    <div class="score-chip ${PLAYER_COLOURS[i]} ${turnIndex === i ? 'turn-indicator' : ''}">
      ${PLAYER_SYMBOLS[i]} ${p.displayName}: ${currentRoom.scores?.[i] || 0}
    </div>`).join('');
}

function handleGameOver(msg) {
  setTimeout(() => {
    const title = document.getElementById('result-title');
    const tableBody = document.querySelector('#final-score-table tbody');
    
    if (msg.winningCells) {
      const winner = currentRoom.players[msg.turn];
      title.textContent = `🏆 ${winner.displayName} Wins!`;
    } else {
      title.textContent = '🤝 It\'s a Draw!';
    }
    
    const ranked = currentRoom.players.map((p, i) => ({
      ...p,
      score: currentRoom.scores?.[i] || 0
    })).sort((a, b) => b.score - a.score);
    
    tableBody.innerHTML = ranked.map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="${PLAYER_COLOURS[currentRoom.players.indexOf(p)]}">
          ${PLAYER_SYMBOLS[currentRoom.players.indexOf(p)]} ${p.displayName}
        </td>
        <td>${p.score}</td>
      </tr>`).join('');
    
    const amHost = currentRoom.players.some(p => p.userId === playerId && p.isHost);
    document.getElementById('play-again-btn').style.display = amHost ? 'block' : 'none';
    
    showScreen('final');
  }, 1200);
}

// ─── Actions ───
function createRoom() {
  send({
    type: 'CREATE_ROOM',
    roomName: document.getElementById('new-room-name').value.trim() || null,
    maxPlayers: parseInt(document.getElementById('new-max-players').value)
  });
}

function joinRoom() {
  const code = document.getElementById('join-code').value.trim();
  if (!code) return showError('Enter a room code');
  send({ type: 'JOIN_ROOM', code });
}

function joinCodeDirect(code) {
  send({ type: 'JOIN_ROOM', code });
}

function leaveRoom() {
  lastRoomCode = null; currentRoomCode = null; currentRoom = null; playerId = null; playerIndex = null;
  try { localStorage.removeItem('ttt_last_room'); } catch {}
  showScreen('lobby');
}

function backToLobby() {
  showScreen('lobby');
  refreshRoomList();
}

function startGame() { send({ type: 'START_GAME' }); }
function refreshRoomList() { send({ type: 'LIST_ROOMS' }); }
function makeMove(index) { send({ type: 'MAKE_MOVE', index }); }
function playAgain() { send({ type: 'START_GAME' }); }

// ─── Messages ───
function showError(t) { document.getElementById('msg-container').innerHTML = `<div class="message error">⚠️ ${t}</div>`; }
function showSuccess(t) { document.getElementById('msg-container').innerHTML = `<div class="message success">✅ ${t}</div>`; }
function hideMessages() { document.getElementById('msg-container').innerHTML = ''; }

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
  try { lastRoomCode = localStorage.getItem('ttt_last_room'); } catch {}
  connect();
});