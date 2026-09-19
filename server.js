// server.js
// Run: npm init -y
// npm i express cors bcrypt jsonwebtoken uuid fs-extra
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'db.json');
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_prod';
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(cors()); // adjust origin in production

// --- Simple file-backed DB helpers ---
async function loadDB() {
  try {
    const exists = await fs.pathExists(DATA_FILE);
    if (!exists) {
      const init = {
        users: [],        // { username, fullname, passwordHash, role, avatar, mcion, inventory: [] }
        exams: {},        // examCode -> { examCode, timeLimit, questions: [{ id, question, options, correct }] }
        history: [],      // { id, username, fullname, examCode, correctCount, totalQuestions, score, time, earnedMcion }
        ui: { title: 'Trang Web Học Tập Của MR Minh', primaryColor: '#3498db', bgColor: '#f4f7f6', banner: '' }
      };
      await fs.writeJson(DATA_FILE, init, { spaces: 2 });
      return init;
    }
    return await fs.readJson(DATA_FILE);
  } catch (e) {
    console.error('DB load error', e);
    return null;
  }
}
async function saveDB(db) {
  await fs.writeJson(DATA_FILE, db, { spaces: 2 });
}

// --- Auth helpers ---
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ success: false, message: 'Invalid token' });
  req.user = payload;
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden: admin only' });
  next();
}

// --- Utility ---
function sanitizeUserForClient(user) {
  return {
    username: user.username,
    fullname: user.fullname,
    role: user.role,
    avatar: user.avatar || '',
    mcion: user.mcion || 0,
    inventory: user.inventory || []
  };
}
function validateQuestion(q) {
  if (!q || typeof q.question !== 'string') return false;
  if (!Array.isArray(q.options) || q.options.length < 2) return false;
  if (!q.correct) return false;
  const c = String(q.correct).toUpperCase();
  return ['A','B','C','D','0','1','2','3'].includes(c);
}

// --- Routes ---

// Health
app.get('/api/health', (req, res) => res.json({ success: true }));

// UI settings
app.get('/api/ui', async (req, res) => {
  const db = await loadDB();
  res.json(db.ui || {});
});

// Register
app.post('/api/register', async (req, res) => {
  const { fullname, username, password } = req.body;
  if (!fullname || !username || !password) return res.status(400).json({ success: false, message: 'Missing fields' });

  const db = await loadDB();
  if (db.users.find(u => u.username === username)) return res.status(409).json({ success: false, message: 'Username exists' });

  const hash = await bcrypt.hash(password, 10);
  const user = { username, fullname, passwordHash: hash, role: 'student', avatar: '', mcion: 0, inventory: [] };
  db.users.push(user);
  await saveDB(db);
  res.json({ success: true, message: 'Registered' });
});

// Login (returns user object + token)
app.post('/api/login', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Missing credentials' });

  const db = await loadDB();
  const user = db.users.find(u => u.username === username && (role ? u.role === role : true));
  if (!user) return res.status(401).json({ success: false, message: 'Invalid username or role' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ success: false, message: 'Invalid password' });

  const token = signToken({ username: user.username, role: user.role });
  const clientUser = sanitizeUserForClient(user);
  // Return both token and user object for backward compatibility with client
  res.json({ success: true, token, user: clientUser, username: user.username, fullname: user.fullname, role: user.role, avatar: user.avatar, mcion: user.mcion });
});

// Change password (authenticated)
app.post('/api/change-password', authMiddleware, async (req, res) => {
  const { username, role, oldPassword, newPassword } = req.body;
  if (!username || !oldPassword || !newPassword) return res.status(400).json({ success: false, message: 'Missing fields' });

  const db = await loadDB();
  const user = db.users.find(u => u.username === username);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  if (req.user.username !== username && req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });

  const ok = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ success: false, message: 'Old password incorrect' });

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await saveDB(db);
  res.json({ success: true, message: 'Password changed' });
});

// Exams: list codes
app.get('/api/exams', async (req, res) => {
  const db = await loadDB();
  const codes = Object.keys(db.exams || {});
  res.json(codes);
});

// Get exam by code
app.get('/api/exams/:code', async (req, res) => {
  const code = req.params.code;
  const db = await loadDB();
  const exam = db.exams[code];
  if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
  res.json(exam);
});

// Create exam (admin)
app.post('/api/exams', authMiddleware, requireAdmin, async (req, res) => {
  const { examCode, timeLimit, questions } = req.body;
  if (!examCode || !Array.isArray(questions)) return res.status(400).json({ success: false, message: 'Invalid payload' });

  // validate questions
  for (const q of questions) {
    if (!validateQuestion(q)) return res.status(400).json({ success: false, message: 'Invalid question format' });
  }

  const db = await loadDB();
  if (db.exams[examCode]) return res.status(409).json({ success: false, message: 'Exam code exists' });

  // Normalize correct to letter A/B/C/D
  const normalized = questions.map((q, idx) => {
    let correct = String(q.correct).toUpperCase();
    if (['0','1','2','3'].includes(correct)) correct = ['A','B','C','D'][Number(correct)];
    return { id: q.id || idx+1, question: q.question, options: q.options, correct };
  });

  db.exams[examCode] = { examCode, timeLimit: Number(timeLimit) || 0, questions: normalized };
  await saveDB(db);
  res.status(201).json({ success: true, message: 'Exam saved' });
});

// Delete exam (admin)
app.delete('/api/exams/:code', authMiddleware, requireAdmin, async (req, res) => {
  const code = req.params.code;
  const db = await loadDB();
  if (!db.exams[code]) return res.status(404).json({ success: false, message: 'Not found' });
  delete db.exams[code];
  await saveDB(db);
  res.json({ success: true, message: 'Deleted' });
});

// Submit exam (student) - server recomputes score
// Expected body: { username, answers: [{ qIndex, choice }], examCode }
// For backward compatibility, if client sends correctCount/score, server will ignore and recompute.
app.post('/api/submit', authMiddleware, async (req, res) => {
  const { username, examCode, answers } = req.body;
  if (!username || !examCode) return res.status(400).json({ success: false, message: 'Missing fields' });

  // Only the user themselves or admin can submit on behalf
  if (req.user.username !== username && req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });

  const db = await loadDB();
  const exam = db.exams[examCode];
  if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });

  // Build answers map
  const ansMap = new Map();
  if (Array.isArray(answers)) {
    answers.forEach(a => {
      if (typeof a.qIndex !== 'undefined' && a.choice) ansMap.set(Number(a.qIndex), String(a.choice).toUpperCase());
    });
  } else {
    // fallback: try to accept client-sent correctCount (not recommended)
  }

  let correctCount = 0;
  exam.questions.forEach((q, idx) => {
    const expected = String(q.correct).toUpperCase();
    const given = ansMap.has(idx) ? ansMap.get(idx) : null;
    if (given && given === expected) correctCount++;
  });

  const total = exam.questions.length;
  const score = Number(((correctCount / total) * 10).toFixed(1));
  const earnedMcion = correctCount * 10;

  // Save history and update mcion atomically (simple approach)
  const hist = {
    id: uuidv4(),
    username,
    fullname: (db.users.find(u => u.username === username) || {}).fullname || username,
    examCode,
    correctCount,
    totalQuestions: total,
    score,
    time: new Date().toLocaleString('vi-VN'),
    earnedMcion
  };
  db.history.push(hist);

  // Update user mcion
  const user = db.users.find(u => u.username === username);
  if (user) {
    user.mcion = (user.mcion || 0) + earnedMcion;
  }
  await saveDB(db);

  res.json({ success: true, correctCount, total, score, earnedMcion });
});

// History (all)
app.get('/api/history', authMiddleware, async (req, res) => {
  const db = await loadDB();
  // students can see all but client filters by username; admin sees all
  res.json(db.history || []);
});

// Mcion balance & inventory
app.get('/api/mcion/:username', authMiddleware, async (req, res) => {
  const username = req.params.username;
  // allow user or admin
  if (req.user.username !== username && req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });

  const db = await loadDB();
  const user = db.users.find(u => u.username === username);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  res.json({ balance: user.mcion || 0, inventory: user.inventory || [] });
});

// Grant Mcion (admin)
app.post('/api/mcion/grant', authMiddleware, requireAdmin, async (req, res) => {
  const { username, amount } = req.body;
  if (!username || typeof amount === 'undefined') return res.status(400).json({ success: false, message: 'Missing fields' });

  const db = await loadDB();
  const user = db.users.find(u => u.username === username);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  user.mcion = (user.mcion || 0) + Number(amount);
  await saveDB(db);
  res.json({ success: true, message: `Granted ${amount} Mcion to ${username}` });
});

// Buy item (student)
app.post('/api/mcion/buy', authMiddleware, async (req, res) => {
  const { username, itemName, cost, avatarUrl } = req.body;
  if (!username || !itemName || typeof cost === 'undefined') return res.status(400).json({ success: false, message: 'Missing fields' });

  // only user or admin can perform
  if (req.user.username !== username && req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });

  const db = await loadDB();
  const user = db.users.find(u => u.username === username);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  const price = Number(cost);
  if ((user.mcion || 0) < price) return res.status(400).json({ success: false, message: 'Insufficient Mcion' });

  // atomic-ish update
  user.mcion = (user.mcion || 0) - price;
  user.inventory = user.inventory || [];
  if (!user.inventory.includes(itemName)) user.inventory.push(itemName);
  if (avatarUrl) user.avatar = avatarUrl;

  await saveDB(db);
  res.json({ success: true, balance: user.mcion, user: sanitizeUserForClient(user) });
});

// Update avatar (student)
app.post('/api/update-avatar', authMiddleware, async (req, res) => {
  const { username, avatar, avatarUrl, itemName } = req.body;
  if (!username || !(avatar || avatarUrl)) return res.status(400).json({ success: false, message: 'Missing fields' });

  if (req.user.username !== username && req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });

  const db = await loadDB();
  const user = db.users.find(u => u.username === username);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  // ensure user owns the item (if itemName provided)
  if (itemName && (!user.inventory || !user.inventory.includes(itemName))) {
    return res.status(400).json({ success: false, message: 'You do not own this avatar' });
  }

  user.avatar = avatar || avatarUrl;
  await saveDB(db);
  res.json({ success: true, user: sanitizeUserForClient(user) });
});

// Fallback
app.use((req, res) => res.status(404).json({ success: false, message: 'Not found' }));

// Start
app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
