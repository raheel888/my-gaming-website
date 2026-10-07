const WS_PROTO = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTO}//${location.host}`;

let ws = null;
let playerId = null;
let currentRoom = null;
let currentRoomCode = null;
let lastRoomCode = null;
let reconnectAttempts = 0;
let timerInterval = null;
let myAnswers = {};

const ALL_CATEGORIES = [
  { id: 'country', name: 'Country' }, { id: 'city', name: 'City' },
  { id: 'animal', name: 'Animal' }, { id: 'food', name: 'Food' },
  { id: 'color', name: 'Colour' }, { id: 'name', name: 'Name' },
  { id: 'object', name: 'Object' }, { id: 'plant', name: 'Plant' },
  { id: 'brand', name: 'Brand' }, { id: 'movie', name: 'Movie' },
  { id: 'book', name: 'Book' }, { id: 'river', name: 'River' }
];

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
        send({ type: 'JOIN_ROOM', code: lastRoomCode, gameType: 'categories' });
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
  msg.gameType = 'categories';
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else showError('Reconnecting...');
}

// ─── Messages ───
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

    case 'ROUND_START':
      currentRoom.currentRound = msg.round;
      currentRoom.totalRounds = msg.totalRounds;
      currentRoom.letter = msg.letter;
      currentRoom.categories = msg.categories;
      currentRoom.timeLimit = msg.timeLimit;
      myAnswers = {};
      
      document.getElementById('round-num').textContent = msg.round;
      document.getElementById('total-rounds').textContent = msg.totalRounds;
      document.getElementById('current-letter').textContent = msg.letter;
      
      renderAnswerForm(msg.categories);
      showScreen('playing');
      
      const amHost = currentRoom.players.some(p => p.userId === playerId && p.isHost);
      document.getElementById('stop-btn').style.display = 'block';
      document.getElementById('stop-note').textContent = amHost 
        ? '🛑 As host: stops the round for EVERYONE' 
        : '🔒 Locks YOUR answers — others can keep playing';
      
      startTimer(msg.timeLimit);
      break;

    case 'SELF_LOCKED':
      showSuccess(msg.message);
      document.getElementById('stop-btn').disabled = true;
      document.getElementById('stop-btn').textContent = '🔒 Answers Locked';
      break;

    case 'STOP_CALLED':
      if (timerInterval) clearInterval(timerInterval);
      const scope = msg.scope === 'all' ? ' — voting starts now!' : '';
      document.getElementById('stop-announce').textContent = 
        msg.byId === playerId ? `You pressed STOP!${scope}` : `${msg.byName} pressed STOP!${scope}`;
      break;

    case 'TIME_UP':
      if (timerInterval) clearInterval(timerInterval);
      showInfo('⏰ Time is up!');
      break;

    case 'VOTING_START':
      renderVotingScreen(msg.answers, msg.categories);
      showScreen('voting');
      break;

    case 'SCORES':
      renderRoundScores(msg.scoreboard);
      showScreen('round-scores');
      break;

    case 'GAME_END':
      renderFinalScores(msg.finalRanking);
      showScreen('final');
      break;
  }
}

// ─── UI Helpers ───
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
  hideMessages();
  if (timerInterval && name !== 'playing') {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function saveRoomCode(code) {
  lastRoomCode = code; currentRoomCode = code;
  try { localStorage.setItem('cs_last_room', code); } catch {}
}

function renderCategoryChecks(selectedIds = []) {
  const tbody = document.getElementById('category-checks');
  tbody.innerHTML = '';
  for (let i = 0; i < ALL_CATEGORIES.length; i += 2) {
    const row = document.createElement('tr');
    for (let col = 0; col < 2; col++) {
      const cat = ALL_CATEGORIES[i + col];
      if (!cat) { row.innerHTML += '<td></td>'; continue; }
      row.innerHTML += `
        <td>
          <input type="checkbox" id="cat-${cat.id}" value="${cat.id}" ${selectedIds.includes(cat.id)?'checked':''}>
          <label for="cat-${cat.id}">${cat.name}</label>
        </td>`;
    }
    tbody.appendChild(row);
  }
}

function getSelectedCategories() {
  return ALL_CATEGORIES.filter(cat => document.getElementById(`cat-${cat.id}`)?.checked).map(c => c.id);
}

function renderPlayers(players) {
  const list = document.getElementById('player-list');
  list.innerHTML = players.map(p => `
    <div class="player-row ${p.userId === playerId ? 'you' : ''}">
      <span>${p.displayName}${p.userId === playerId ? ' (You)' : ''}</span>
      ${p.isHost ? '<span class="host-badge">HOST</span>' : ''}
    </div>`).join('');

  const startBtn = document.getElementById('start-btn');
  if (startBtn) {
    const amHost = players.some(p => p.userId === playerId && p.isHost);
    startBtn.style.display = amHost ? 'inline-block' : 'none';
  }
}

function renderRoomList(rooms) {
  const filtered = rooms?.filter(r => r.gameType === 'categories') || [];
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

// ─── Actions ───
function createRoom() {
  send({
    type: 'CREATE_ROOM',
    roomName: document.getElementById('new-room-name').value.trim() || null,
    totalRounds: parseInt(document.getElementById('new-total-rounds').value),
    timeLimit: parseInt(document.getElementById('new-time-limit').value),
    maxPlayers: parseInt(document.getElementById('new-max-players').value),
    selectedCategories: getSelectedCategories()
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
  lastRoomCode = null; currentRoomCode = null; currentRoom = null; playerId = null;
  try { localStorage.removeItem('cs_last_room'); } catch {}
  showScreen('lobby');
}

function backToLobby() {
  showScreen('lobby');
  refreshRoomList();
}

function startGame() { send({ type: 'START_GAME' }); }
function refreshRoomList() { send({ type: 'LIST_ROOMS' }); }
function pressStop() { send({ type: 'PRESSED_STOP' }); }

// ─── Answers & Timer ───
function renderAnswerForm(categories) {
  const form = document.getElementById('answers-form');
  form.innerHTML = categories.map(cat => `
    <div class="answer-row">
      <label for="ans-${cat.id}">${cat.name}:</label>
      <input type="text" id="ans-${cat.id}" 
             placeholder="Enter ${cat.name.toLowerCase()} starting with ${currentRoom.letter}"
             oninput="saveAnswer('${cat.id}', this.value)">
    </div>`).join('');
  document.getElementById('stop-btn').disabled = false;
  document.getElementById('stop-btn').textContent = '🛑 STOP';
}

function saveAnswer(categoryId, value) {
  myAnswers[categoryId] = value;
  send({ type: 'SUBMIT_ANSWER', categoryId, answer: value });
}

function startTimer(seconds) {
  let t = seconds;
  const fill = document.getElementById('timer-fill');
  const text = document.getElementById('timer-text');
  fill.style.width = '100%';
  
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    t--;
    fill.style.width = `${(t/seconds)*100}%`;
    text.textContent = `${t}s remaining`;
    if (t <= 0) { clearInterval(timerInterval); send({ type: 'TIME_UP' }); }
  }, 1000);
}

// ─── Voting ───
function renderVotingScreen(answers, categories) {
  const container = document.getElementById('voting-container');
  container.innerHTML = '';
  for (const targetId in answers) {
    if (targetId === playerId) continue;
    const playerName = currentRoom.players.find(p => p.userId === targetId)?.displayName || 'Player';
    const group = document.createElement('div');
    group.className = 'vote-group';
    group.innerHTML = `<h4>${playerName}'s Answers</h4>`;
    categories.forEach(cat => {
      const ans = answers[targetId]?.[cat.id] || '';
      group.innerHTML += `
        <div class="vote-row">
          <span>${cat.name}:</span>
          <span class="answer-text">${ans || '(empty)'}</span>
          <div class="vote-buttons">
            <button class="vote-btn valid" data-target="${targetId}" data-cat="${cat.id}" data-val="true" onclick="castVote(this)">✓</button>
            <button class="vote-btn invalid" data-target="${targetId}" data-cat="${cat.id}" data-val="false" onclick="castVote(this)">✗</button>
          </div>
        </div>`;
    });
    container.appendChild(group);
  }
}

function castVote(btn) {
  const siblings = btn.parentElement.querySelectorAll('.vote-btn');
  siblings.forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  send({
    type: 'SUBMIT_VOTE',
    targetPlayer: btn.dataset.target,
    categoryId: btn.dataset.cat,
    isValid: btn.dataset.val === 'true'
  });
}

function finishVoting() {
  send({ type: 'FINISH_VOTING' });
  document.getElementById('finish-voting-btn').disabled = true;
  setTimeout(() => { document.getElementById('finish-voting-btn').disabled = false; }, 3000);
}

// ─── Scores ───
function renderRoundScores(scoreboard) {
  document.querySelector('#round-score-table tbody').innerHTML = scoreboard.map((p, i) =>
    `<tr><td>${i+1}</td><td>${p.displayName}</td><td>${p.roundScore}</td></tr>`
  ).join('');
  document.querySelector('#total-score-table tbody').innerHTML = scoreboard.map((p, i) =>
    `<tr><td>${i+1}</td><td>${p.displayName}</td><td>${p.totalScore}</td></tr>`
  ).join('');

  const amHost = currentRoom.players.some(p => p.userId === playerId && p.isHost);
  const isLast = currentRoom.currentRound >= currentRoom.totalRounds;
  document.getElementById('next-round-btn').style.display = (!isLast && amHost) ? 'block' : 'none';
  document.getElementById('end-game-btn').style.display = (isLast && amHost) ? 'block' : 'none';
}

function nextRound() { send({ type: 'START_GAME' }); }
function showFinalScores() { showScreen('final'); }

function renderFinalScores(ranking) {
  document.querySelector('#final-score-table tbody').innerHTML = ranking.map((p, i) =>
    `<tr><td>${i+1}</td><td>${i===0?'🏆 ':''}${p.displayName}</td><td>${p.totalScore}</td></tr>`
  ).join('');
}

// ─── Messages ───
function showError(t) { document.getElementById('msg-container').innerHTML = `<div class="message error">⚠️ ${t}</div>`; }
function showSuccess(t) { document.getElementById('msg-container').innerHTML = `<div class="message success">✅ ${t}</div>`; }
function showInfo(t) { document.getElementById('msg-container').innerHTML = `<div class="message info">ℹ️ ${t}</div>`; }
function hideMessages() { document.getElementById('msg-container').innerHTML = ''; }

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
  try { lastRoomCode = localStorage.getItem('cs_last_room'); } catch {}
  renderCategoryChecks();
  connect();
});