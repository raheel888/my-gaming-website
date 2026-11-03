let ws;
let myId;
let currentRoomCode = null;

function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    console.log('Connected');
    document.getElementById('connection-status').textContent = '✅ Connected';
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'ROOM_CREATED':
    case 'ROOM_JOINED':
      currentRoomCode = msg.code;
      showScreen('screen-room');
      renderPlayers(msg.room.players);
      break;
  }
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function renderPlayers(players) {
  const list = document.getElementById('players-list');
  list.innerHTML = players.map(p => `
    <div class="player-card">
      ${p.name} ${p.isHost ? '👑' : ''}
    </div>
  `).join('');
}

// Initialize
connect();
