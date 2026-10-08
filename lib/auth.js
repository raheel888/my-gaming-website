const crypto = require('crypto');
const { loadData, saveData } = require('./dataStore');

function createSessionToken(username) {
  const token = crypto.randomBytes(32).toString('hex');
  const data = loadData();
  if (!data.sessions) data.sessions = {};
  data.sessions[token] = { username, createdAt: Date.now() };
  saveData(data);
  return token;
}

function validateSessionToken(token) {
  if (!token) return null;
  const data = loadData();
  if (!data.sessions) return null;
  const session = data.sessions[token];
  if (!session) return null;
  // Expire after 7 days
  if (Date.now() - session.createdAt > 7 * 24 * 60 * 60 * 1000) {
    delete data.sessions[token];
    saveData(data);
    return null;
  }
  const user = data.users?.[session.username];
  if (!user) return null;
  return {
    username: session.username,
    userId: user.userId,
    displayName: user.displayName,
    gamesPlayed: user.gamesPlayed || 0,
    totalScore: user.totalScore || 0
  };
}

module.exports = { createSessionToken, validateSessionToken };
