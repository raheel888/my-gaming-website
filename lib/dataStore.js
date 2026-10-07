const fs = require('fs');
const { DATA_DIR, USERS_FILE } = require('./constants');

function initDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      console.log('📁 Creating data folder...');
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(USERS_FILE)) {
      fs.writeFileSync(USERS_FILE, JSON.stringify({ users: {}, sessions: {} }, null, 2));
      console.log('✅ users.json created');
    }
  } catch (err) {
    console.error('❌ Data setup failed:', err.message);
  }
}

function loadData() {
  try {
    if (!fs.existsSync(USERS_FILE)) return { users: {}, sessions: {} };
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8') || '{"users":{},"sessions":{}}');
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