let currentUser = null;

// ─── Auth State ───
async function checkAuth() {
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    if (data.authenticated) {
      currentUser = data.user;
      showGameHub();
    } else {
      showAuth();
    }
  } catch {
    showAuth();
  }
}

function showAuth() {
  document.getElementById('auth-container').style.display = 'block';
  document.getElementById('game-hub').style.display = 'none';
}

function showGameHub() {
  document.getElementById('auth-container').style.display = 'none';
  document.getElementById('game-hub').style.display = 'block';
  document.getElementById('user-display').textContent = `👤 ${currentUser.displayName}`;
  document.getElementById('logout-btn').style.display = 'inline-block';
  document.getElementById('stat-games').textContent = currentUser.gamesPlayed || 0;
  document.getElementById('stat-score').textContent = currentUser.totalScore || 0;
}

// ─── Tabs ───
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`${btn.dataset.tab}-form`).classList.add('active');
  });
});

// ─── Login ───
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    currentUser = data.user;
    showGameHub();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ─── Register ───
document.getElementById('register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('reg-username').value.trim();
  const displayName = document.getElementById('reg-displayname').value.trim() || username;
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl = document.getElementById('register-error');

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName, email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    // Auto-login after register
    await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    currentUser = { userId: data.userId, username, displayName };
    showGameHub();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ─── Logout ───
document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  currentUser = null;
  showAuth();
});

// ─── Init ───
checkAuth();