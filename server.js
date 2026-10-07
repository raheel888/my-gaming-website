const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');


const { PORT, DATA_DIR, USERS_FILE } = require('./lib/constants');
const { initDataDir, loadData, saveData } = require('./lib/dataStore');
const { createSessionToken, validateSessionToken } = require('./lib/auth');
const { dispatchMessage, cleanupDisconnect } = require('./lib/gameRouter');

// Register games
registerGame('categories', categoriesStop);
registerGame('tictactoe', tictactoe);

// ─── INIT ───
initDataDir();

// ─── HTTP SERVER ───
const server = http.createServer((req, res) => {
  const cookies = {};
  if (req.headers.cookie) {
    req.headers.cookie.split(';').forEach(c => {
      const [k, v] = c.trim().split('=');
      cookies[k] = decodeURIComponent(v);
    });
  }

  // ─── REGISTER ───
  if (req.url === '/api/register' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { username, email, password, displayName } = JSON.parse(body);
        if (!username || !password || username.length < 3 || password.length < 6) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Username ≥3 chars, password ≥6 chars' }));
        }
        const data = loadData();
        if (data.users[username]) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Username taken' }));
        }
        const { v4: uuidv4 } = require('uuid');
        const bcrypt = require('bcryptjs');
        data.users[username] = {
          userId: uuidv4(),
          email: email || '',
          displayName: displayName || username,
          passwordHash: bcrypt.hashSync(password, 10),
          createdAt: Date.now(),
          gamesPlayed: 0,
          totalScore: 0
        };
        if (!saveData(data)) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Storage error' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server error' }));
      }
    });
    return;
  }

  // ─── LOGIN ───
  if (req.url === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body);
        const data = loadData();
        const bcrypt = require('bcryptjs');
        const user = data.users[username];
        if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid login' }));
        }
        const token = createSessionToken(username);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `auth_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7*24*60*60}`
        });
        res.end(JSON.stringify({
          success: true,
          user: { userId: user.userId, displayName: user.displayName, username }
        }));
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server error' }));
      }
    });
    return;
  }

  // ─── LOGOUT ───
  if (req.url === '/api/logout' && req.method === 'POST') {
    const data = loadData();
    if (cookies.auth_token) delete data.sessions[cookies.auth_token];
    saveData(data);
    res.writeHead(200, {
      'Set-Cookie': 'auth_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
      'Content-Type': 'application/json'
    });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // ─── PROFILE ───
  if (req.url === '/api/me') {
    const user = validateSessionToken(cookies.auth_token);
    if (!user) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ authenticated: false }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      authenticated: true,
      user: {
        userId: user.userId,
        username: user.username,
        displayName: user.displayName,
        gamesPlayed: user.gamesPlayed || 0,
        totalScore: user.totalScore || 0
      }
    }));
    return;
  }

  // ─── STATIC FILES ───
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json'
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h1>404 Not Found</h1><a href="/">Back Home</a>');
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ─── WEBSOCKET ───
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const tokenMatch = req.url?.match(/token=([^&]+)/);
  const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;
  const authUser = validateSessionToken(token);

  const userId = authUser?.userId || `anon_${crypto.randomUUID().slice(0,8)}`;
  const displayName = authUser?.displayName || 'Guest';

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      dispatchMessage(msg, { ws, userId, displayName });
    } catch (e) {
      console.error('WS parse error:', e.message);
    }
  });

  ws.on('close', () => cleanupDisconnect(userId));
});

server.listen(PORT, () => {
  console.log(`🚀 Platform running on port ${PORT}`);
});