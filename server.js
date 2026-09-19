// server.js - Đã nâng cấp hoàn toàn sang MongoDB Atlas (Mongoose)
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
let bcrypt;

try {
  bcrypt = require('bcryptjs');
} catch (e) {
  try {
    bcrypt = require('bcrypt');
  } catch (err) {
    console.error('Thiếu thư viện bcryptjs hoặc bcrypt.');
    process.exit(1);
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_prod';
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// --- 1. KẾT NỐI MONGODB ATLAS ---
if (!MONGODB_URI) {
  console.error('❌ Thiếu biến môi trường MONGODB_URI trên Render!');
}

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ Đã kết nối thành công tới MongoDB Atlas!');
    initDefaultAdmin(); // Tạo tài khoản admin mặc định nếu chưa có
  })
  .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));


// --- 2. ĐỊNH NGHĨA SCHEMAS & MODELS ---
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  fullname: { type: String, default: '' },
  passwordHash: { type: String, required: true },
  role: { type: String, default: 'student' },
  avatar: { type: String, default: '' },
  mcion: { type: Number, default: 0 },
  inventory: { type: [String], default: [] }
}, { timestamps: true });

const ExamSchema = new mongoose.Schema({
  examCode: { type: String, required: true, unique: true },
  timeLimit: { type: Number, default: 0 },
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
  time: { type: String, default: '' },
  earnedMcion: { type: Number, default: 0 }
}, { timestamps: true });

const UISchema = new mongoose.Schema({
  title: { type: String, default: 'Trang Web Học Tập Của MR Minh' },
  primaryColor: { type: String, default: '#3498db' },
  bgColor: { type: String, default: '#f4f7f6' },
  banner: { type: String, default: '' }
});

const User = mongoose.model('User', UserSchema);
const Exam = mongoose.model('Exam', ExamSchema);
const History = mongoose.model('History', HistorySchema);
const UI = mongoose.model('UI', UISchema);


// --- 3. KHỞI TẠO TÀI KHOẢN ADMIN MẶC ĐỊNH ---
async function initDefaultAdmin() {
  try {
    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
      const hash = await bcrypt.hash('admin123', 10);
      await User.create({
        username: 'admin',
        fullname: 'Administrator',
        passwordHash: hash,
        role: 'admin',
        avatar: '',
        mcion: 0,
        inventory: []
      });
      console.log('👑 Đã tạo tài khoản Admin mặc định (user: admin / pass: admin123)');
    }
  } catch (e) {
    console.error('Lỗi khi khởi tạo Admin mặc định:', e);
  }
}

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


// --- 4. CÁC API ENDPOINTS ---

// Health Check
app.get('/api/health', (req, res) => res.json({ success: true }));

// Lấy UI Cấu hình
app.get('/api/ui', async (req, res) => {
  try {
    let ui = await UI.findOne();
    if (!ui) ui = await UI.create({});
    res.json(ui);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Đăng ký tài khoản Học viên
app.post('/api/register', async (req, res) => {
  try {
    const { fullname, username, password } = req.body;
    if (!fullname || !username || !password) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin đăng ký!' });
    }

    const exists = await User.findOne({ username });
    if (exists) {
      return res.status(409).json({ success: false, message: 'Tên đăng nhập đã tồn tại!' });
    }

    const hash = await bcrypt.hash(password, 10);
    await User.create({
      username,
      fullname,
      passwordHash: hash,
      role: 'student',
      avatar: '',
      mcion: 0,
      inventory: []
    });

    res.json({ success: true, message: 'Đăng ký thành công!' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Đăng nhập (Học sinh / Admin)
app.post('/api/login', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Vui lòng điền đủ thông tin!' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Tài khoản không tồn tại!' });
    }

    if (role && user.role !== role) {
      return res.status(401).json({ success: false, message: 'Sai vai trò đăng nhập!' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ success: false, message: 'Mật khẩu không chính xác!' });
    }

    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    const clientUser = sanitizeUserForClient(user);

    res.json({ success: true, token, ...clientUser });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Đổi mật khẩu
app.post('/api/change-password', async (req, res) => {
  try {
    const { username, oldPassword, newPassword } = req.body;
    if (!username || !oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin mật khẩu!' });
    }

    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Người dùng không tồn tại!' });

    const ok = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ success: false, message: 'Mật khẩu cũ không đúng!' });

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// --- API QUẢN LÝ ĐỀ THI ---
// Lấy danh sách mã đề thi
app.get('/api/exams', async (req, res) => {
  try {
    const exams = await Exam.find({}, 'examCode');
    res.json(exams.map(e => e.examCode));
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Lấy chi tiết câu hỏi theo mã đề
app.get('/api/exams/:code', async (req, res) => {
  try {
    const exam = await Exam.findOne({ examCode: req.params.code });
    if (!exam) return res.status(404).json({ success: false, message: 'Không tìm thấy đề thi' });
    res.json(exam);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Lưu bộ đề thi mới (Admin)
app.post('/api/exams', async (req, res) => {
  try {
    const { examCode, timeLimit, questions } = req.body;
    if (!examCode || !Array.isArray(questions)) {
      return res.status(400).json({ success: false, message: 'Dữ liệu đề thi không hợp lệ!' });
    }

    await Exam.findOneAndUpdate(
      { examCode },
      { timeLimit: Number(timeLimit) || 0, questions },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: 'Lưu bộ đề thi thành công!' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Xóa đề thi (Admin)
app.delete('/api/exams/:code', async (req, res) => {
  try {
    const result = await Exam.deleteOne({ examCode: req.params.code });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đề thi để xóa!' });
    }
    res.json({ success: true, message: 'Xóa thành công!' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// --- API NỘP BÀI THI & LỊCH SỬ ---
app.post('/api/submit', async (req, res) => {
  try {
    const { username, fullname, examCode, correctCount, totalQuestions, score, time, earnedMcion } = req.body;

    const hist = await History.create({
      username,
      fullname: fullname || username,
      examCode,
      correctCount: Number(correctCount) || 0,
      totalQuestions: Number(totalQuestions) || 0,
      score: Number(score) || 0,
      time: time || new Date().toLocaleString('vi-VN'),
      earnedMcion: Number(earnedMcion) || 0
    });

    // Tự động cộng Mcion thưởng cho học sinh
    if (earnedMcion) {
      await User.findOneAndUpdate(
        { username },
        { $inc: { mcion: Number(earnedMcion) } }
      );
    }

    res.json({ success: true, history: hist });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Lấy lịch sử tất cả lượt làm bài
app.get('/api/history', async (req, res) => {
  try {
    const history = await History.find().sort({ createdAt: -1 });
    res.json(history);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// --- API QUẢN LÝ MCION & CỬA HÀNG ---
// Lấy số dư Mcion và kho Avatar đã mua
app.get('/api/mcion/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh' });
    res.json({ balance: user.mcion || 0, inventory: user.inventory || [] });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Cấp/Trừ Mcion cho học sinh (Admin)
app.post('/api/mcion/grant', async (req, res) => {
  try {
    const { username, amount } = req.body;
    const user = await User.findOneAndUpdate(
      { username },
      { $inc: { mcion: Number(amount) } },
      { new: true }
    );

    if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy học sinh!' });
    res.json({ success: true, message: `Đã cấp ${amount} Mcion cho ${username}`, balance: user.mcion });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Mua item/Avatar bằng Mcion
app.post('/api/mcion/buy', async (req, res) => {
  try {
    const { username, itemName, cost, avatarUrl } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản!' });

    const price = Number(cost);
    if ((user.mcion || 0) < price) {
      return res.status(400).json({ success: false, message: 'Số dư Mcion không đủ để mua!' });
    }

    user.mcion -= price;
    user.inventory = user.inventory || [];
    if (!user.inventory.includes(itemName)) {
      user.inventory.push(itemName);
    }
    if (avatarUrl) user.avatar = avatarUrl;

    await user.save();
    res.json({ success: true, balance: user.mcion, user: sanitizeUserForClient(user) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Đổi Avatar từ kho đã mua
app.post('/api/update-avatar', async (req, res) => {
  try {
    const { username, avatar, avatarUrl } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản!' });

    user.avatar = avatar || avatarUrl;
    await user.save();

    res.json({ success: true, user: sanitizeUserForClient(user) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Fallback Route
app.use((req, res) => res.status(404).json({ success: false, message: 'API Route không tồn tại' }));

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy trên cổng ${PORT}`);
});
