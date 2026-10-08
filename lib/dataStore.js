const fs = require('fs');
const path = require('path');
const { DATA_DIR, USERS_FILE } = require('./constants');

// ─── PERMANENT SEED ACCOUNTS ───
const SEED_USERS = {
  admin: {
    userId: 'usr_admin_001',
    email: 'admin@example.com',
    displayName: 'Admin',
    passwordHash: '$2a$10$E9zRjTtqzWqHnqKb9zG9oPq8Y7x6W5v4U3t2S1r0Qp9O8N7M6L5',
    createdAt: 1728339900000,
    gamesPlayed: 0,
    totalScore: 0
  },
  player1: {
    userId: 'usr_player1_002',
    email: 'player1@example.com',
    displayName: 'Player One',
    passwordHash: '$2a$10$W7x6V5u4T3s2R1q0P9o8N7m6L5k4J3i2H1g0F9e8D7c6B5A4z3Y',
    createdAt: 1728339900000,
    gamesPlayed: 0,
    totalScore: 0
  }
};

function initDataDir() {
  console.log('🔍 DATA_DIR:', DATA_DIR);
  console.log('🔍 USERS_FILE:', USERS_FILE);

  // Ensure folder exists
  if (!fs.existsSync(DATA_DIR)) {
    console.log('📁 Creating data folder...');
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  let data = { users: {}, sessions: {} };

  // Load existing file if present
  if (fs.existsSync(USERS_FILE)) {
    try {
      const raw = fs.readFileSync(USERS_FILE, 'utf8');
      data = raw ? JSON.parse(raw) : data;
      console.log(`📂 Loaded ${Object.keys(data.users).length} existing users`);
    } catch (e) {
      console.log('⚠️ Corrupted or empty file — starting fresh');
    }
  } else {
    console.log('📄 No users.json found — will create with seed accounts');
  }

  // Add seed accounts ONLY if missing — NEVER overwrite existing ones
  let added = 0;
  for (const [username, account] of Object.entries(SEED_USERS)) {
    if (!data.users[username]) {
      data.users[username] = account;
      added++;
      console.log(`➕ Added account: ${username}`);
    } else {
      console.log(`✅ Account already exists: ${username}`);
    }
  }

  // Save if changed
  if (added > 0 || !fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
    console.log(`💾 Saved — total users: ${Object.keys(data.users).length}`);
  } else {
    console.log('✅ All seed accounts already present');
  }
}

function loadData() {
  try {
    if (!fs.existsSync(USERS_FILE)) initDataDir();
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    console.error('❌ Load error:', e.message);
    return { users: {}, sessions: {} };
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error('❌ Save error:', e.message);
    return false;
  }
}

module.exports = { initDataDir, loadData, saveData };
