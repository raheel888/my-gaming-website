const crypto = require('crypto');
const { loadData, saveData } = require('./dataStore');

function createSessionToken(username) {
  const token = crypto.randomBytes(32).toString('hex');
  const data = loadData();
  data.sessions[token] = { username, createdAt: Date.now() };
  saveData(data);
  return token;
}

function validateSessionToken(token) {
  if (!token) return null;
  const data = loadData();
  const session = data.sessions?.[token];
  if (!session) return null;
  if (Date.now() - session.createdAt > 7 * 24 * 60 * 60 * 1000) {
    delete data.sessions[token];
    saveData(data);
    return null;
  }
  return data.users[session.username] ? { username: session.username, ...data.users[session.username] } : null;
}

module.exports = { createSessionToken, validateSessionToken };