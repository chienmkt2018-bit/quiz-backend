require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAI } = require('@google/generative-ai');

let bcrypt;
try {
  bcrypt = require('bcryptjs');
} catch (e) {
  bcrypt = require('bcrypt');
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AQ.Ab8RN6JC0dRzi4DLXrOLKsLWEw9ilCpek3XIxozeXvxQVM8uwQ';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_prod';
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// --- DANH SÁCH AVATAR TRONG SHOP ---
const AVATAR_SHOP = [
  { id: '🎓', name: 'Mũ Cử Nhân', price: 0 },
  { id: '🧙‍♂️', name: 'Pháp Sư Tri Thức', price: 50 },
  { id: '🚀', name: 'Phi Hành Gia', price: 100 },
  { id: '👑', name: 'Vua Bài Thi', price: 200 },
  { id: '🦊', name: 'Cáo Thông Thái', price: 150 }
];

// --- SCHEMAS & MODELS ---
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  fullname: { type: String, default: '' },
  passwordHash: { type: String, required: true },
  role: { type: String, default: 'student' },
  avatar: { type: String, default: '🎓' },
  mcion: { type: Number, default: 0 },
  inventory: { type: [String], default: ['🎓'] }
}, { timestamps: true });

const ExamSchema = new mongoose.Schema({
  examCode: { type: String, required: true, unique: true },
  subject: { type: String, default: 'Tổng hợp' },
  grade: { type: String, default: 'Tất cả' },
  timeLimit: { type: Number, default: 15 },
  questions: { type: Array, default: [] }
}, { timestamps: true });

const HistorySchema = new mongoose.Schema({
  id: { type: String, default: () => uuidv4() },
  username: { type: String, required: true },
  fullname: { type: String, default: '' },
  examCode: { type: String, required: true },
  correctCount: { type: Number, default: 0 },
  totalQuestions: { type: Number, default: 0 },
  score: { type: Number, default: 0 },
  essayDetails: { type: Array, default: [] },
  regradeRequested: { type: Boolean, default: false },
  regradeStatus: { type: String, default: 'none' },
  time: { type: String, default: '' },
  earnedMcion: { type: Number, default: 0 }
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);
const Exam = mongoose.model('Exam', ExamSchema);
const History = mongoose.model('History', HistorySchema);

// --- MIDDLEWARES ---
function checkDbConnection(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ success: false, message: 'Chưa kết nối cơ sở dữ liệu MongoDB!' });
  }
  next();
}

function verifyToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Yêu cầu Token xác thực!' });
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ success: false, message: 'Token hết hạn hoặc không hợp lệ!' });
    req.user = decoded;
    next();
  });
}

function verifyAdmin(req, res, next) {
  if (req.user?.role === 'admin') next();
  else res.status(403).json({ success: false, message: 'Chỉ Admin mới có quyền thực hiện!' });
}

function sanitizeUserForClient(user) {
  return {
    username: user.username,
    fullname: user.fullname,
    role: user.role,
    avatar: user.avatar || '🎓',
    mcion: user.mcion || 0,
    inventory: user.inventory || ['🎓']
  };
}

// --- AUTH APIs ---
app.post('/api/register', checkDbConnection, async (req, res) => {
  try {
    const { fullname, username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Thiếu thông tin đăng ký!' });
    const safeUsername = username.trim().toLowerCase();
    const exists = await User.findOne({ username: safeUsername });
    if (exists) return res.status(409).json({ success: false, message: 'Tên đăng nhập đã tồn tại!' });
    
    const hash = await bcrypt.hash(password, 10);
    await User.create({ username: safeUsername, fullname: fullname || safeUsername, passwordHash: hash, role: 'student', avatar: '🎓', inventory: ['🎓'] });
    res.json({ success: true, message: 'Đăng ký tài khoản thành công!' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/login', checkDbConnection, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Vui lòng nhập tên đăng nhập và mật khẩu!' });
    const safeUsername = username.trim().toLowerCase();
    const user = await User.findOne({ username: safeUsername });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu!' });
    }
    if (role && role === 'admin' && user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Tài khoản của bạn không có quyền Admin!' });
    }
    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, ...sanitizeUserForClient(user) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// --- API PHÂN LOẠI & LỌC ĐỀ THI ---
app.get('/api/exams', checkDbConnection, async (req, res) => {
  try {
    const { subject, grade } = req.query;
    let filter = {};
    if (subject && subject !== 'Tất cả') filter.subject = subject;
    if (grade && grade !== 'Tất cả') filter.grade = grade;

    const exams = await Exam.find(filter, 'examCode subject grade timeLimit questions');
    res.json(exams);
  } catch (e) {
    res.status(500).json([]);
  }
});

app.get('/api/exams/:code', checkDbConnection, async (req, res) => {
  try {
    const exam = await Exam.findOne({ examCode: req.params.code });
    if (!exam) return res.status(404).json({ success: false, message: 'Không tìm thấy đề thi!' });
    res.json(exam);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/exams', checkDbConnection, verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { examCode, subject, grade, timeLimit, questions } = req.body;
    if (!examCode || !questions || !questions.length) {
      return res.status(400).json({ success: false, message: 'Mã đề thi và danh sách câu hỏi không được để trống!' });
    }
    await Exam.findOneAndUpdate(
      { examCode },
      { subject: subject || 'Tổng hợp', grade: grade || 'Tất cả', timeLimit: Number(timeLimit) || 15, questions },
      { upsert: true, new: true }
    );
    res.json({ success: true, message: 'Đã lưu đề thi thành công!' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// --- API SHOP AVATAR & THAY ĐỔI AVATAR ---
app.get('/api/shop/avatars', (req, res) => {
  res.json(AVATAR_SHOP);
});

app.post('/api/shop/buy-avatar', checkDbConnection, verifyToken, async (req, res) => {
  try {
    const { avatarId } = req.body;
    const item = AVATAR_SHOP.find(a => a.id === avatarId);
    if (!item) return res.status(404).json({ success: false, message: 'Sản phẩm không tồn tại!' });

    const user = await User.findOne({ username: req.user.username });
    if (user.inventory.includes(avatarId)) {
      return res.status(400).json({ success: false, message: 'Bạn đã sở hữu Avatar này rồi!' });
    }
    if (user.mcion < item.price) {
      return res.status(400).json({ success: false, message: 'Số dư Mcion không đủ để mua Avatar này!' });
    }

    user.mcion -= item.price;
    user.inventory.push(avatarId);
    user.avatar = avatarId; // Tự động mặc sau khi mua
    await user.save();

    res.json({ success: true, message: `Mua thành công Avatar ${item.name}!`, ...sanitizeUserForClient(user) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/user/change-avatar', checkDbConnection, verifyToken, async (req, res) => {
  try {
    const { avatarId } = req.body;
    const user = await User.findOne({ username: req.user.username });
    if (!user.inventory.includes(avatarId)) {
      return res.status(403).json({ success: false, message: 'Bạn chưa sở hữu Avatar này!' });
    }
    user.avatar = avatarId;
    await user.save();
    res.json({ success: true, message: 'Đã thay đổi Avatar!', ...sanitizeUserForClient(user) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// --- API SUBMIT BÀI THI & CHẤM AI ---
app.post('/api/submit', checkDbConnection, verifyToken, async (req, res) => {
  try {
    const { examCode, answers, time } = req.body;
    const username = req.user.username;
    const user = await User.findOne({ username });
    const exam = await Exam.findOne({ examCode });
    if (!exam) return res.status(404).json({ success: false, message: 'Không tìm thấy đề thi!' });

    let correctCount = 0, mcTotal = 0, essayTotalScore = 0, essayMaxTotal = 0;
    const essayDetails = [];
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    for (let i = 0; i < exam.questions.length; i++) {
      const q = exam.questions[i];
      const userAns = answers[i] || '';

      if (q.type === 'essay') {
        const maxScore = Number(q.maxScore) || 10;
        essayMaxTotal += maxScore;
        if (!userAns.trim()) {
           essayDetails.push({ questionIndex: i, questionText: q.question, score: 0, feedback: "Bỏ trống câu hỏi tự luận.", confidence: 100, answer: "" });
           continue;
        }

        const prompt = `Bạn là giám thị chấm thi. Chấm bài ngắn gọn trả về JSON:
Đề bài: ${q.question}
Dàn ý: ${q.sampleAnswer || 'Tự đánh giá'}
Bài làm: ${userAns}
Thang điểm: ${maxScore}
JSON format: {"score": number, "feedback": "string", "confidence": number}`;
        try {
            const result = await model.generateContent(prompt);
            const parsed = JSON.parse(result.response.text().replace(/```json/gi, '').replace(/```/gi, '').trim());
            essayTotalScore += Number(parsed.score) || 0;
            essayDetails.push({ questionIndex: i, questionText: q.question, score: parsed.score, feedback: parsed.feedback, confidence: parsed.confidence, answer: userAns });
        } catch (err) {
            essayDetails.push({ questionIndex: i, questionText: q.question, score: 0, feedback: "Lỗi kết nối AI.", confidence: 0, answer: userAns });
        }
      } else {
        mcTotal++;
        if (userAns.trim().toUpperCase() === String(q.correct).trim().toUpperCase()) correctCount++;
      }
    }

    const maxTotalPoints = mcTotal + essayMaxTotal;
    const earnedPoints = correctCount + essayTotalScore;
    const calculatedScore = maxTotalPoints > 0 ? Number(((earnedPoints / maxTotalPoints) * 10).toFixed(1)) : 0;
    const earnedMcion = (correctCount * 10) + Math.floor(essayTotalScore * 5);

    const hist = await History.create({
      username, fullname: user ? user.fullname : username,
      examCode, correctCount, totalQuestions: exam.questions.length,
      score: calculatedScore, essayDetails, time: time || new Date().toLocaleString('vi-VN'),
      earnedMcion
    });

    if (earnedMcion > 0 && user) {
      await User.findOneAndUpdate({ username }, { $inc: { mcion: earnedMcion } });
    }

    res.json({ success: true, history: hist, examQuestions: exam.questions });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Lịch sử & Admin APIs
app.get('/api/history', checkDbConnection, verifyToken, async (req, res) => {
  try {
    let filter = req.user.role !== 'admin' ? { username: req.user.username } : {};
    const histories = await History.find(filter).sort({ createdAt: -1 });
    res.json(histories);
  } catch (e) { res.status(500).json([]); }
});

if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI).then(() => console.log('✅ MongoDB Connected'));
}
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
