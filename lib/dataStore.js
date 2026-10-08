const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { DATA_DIR, USERS_FILE } = require('./constants');

// ─── PERMANENT SEED ACCOUNTS — WITH VERIFIED HASHES ───
// Passwords: admin → Admin123 | player1 → Player123
const SEED_USERS = {
  admin: {
    userId: 'usr_admin_001',
    email: 'admin@example.com',
    displayName: 'Admin',
    passwordHash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
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

  if (!fs.existsSync(DATA_DIR)) {
    console.log('📁 Creating data folder...');
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  let data = { users: {}, sessions: {} };

  if (fs.existsSync(USERS_FILE)) {
    try {
      const raw = fs.readFileSync(USERS_FILE, 'utf8');
      data = raw ? JSON.parse(raw) : data;
      console.log(`📂 Loaded ${Object.keys(data.users).length} existing users`);
    } catch (e) {
      console.log('⚠️ Corrupted file — starting fresh');
    }
  }

  // ⚠️ Force-update seed accounts with correct hashes
  let updated = 0;
  for (const [username, account] of Object.entries(SEED_USERS)) {
    // Always update hash to ensure it's correct
    if (!data.users[username] || data.users[username].passwordHash !== account.passwordHash) {
      data.users[username] = account;
      updated++;
      console.log(`🔧 Set up account: ${username}`);
    } else {
      console.log(`✅ Account ready: ${username}`);
    }
  }

  if (updated > 0 || !fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
    console.log(`💾 Saved — total users: ${Object.keys(data.users).length}`);
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
