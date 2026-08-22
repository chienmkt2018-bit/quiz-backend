const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// Kết nối Database. URI lấy từ biến môi trường của Render
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Đã kết nối MongoDB!'))
  .catch(err => console.error('❌ Lỗi kết nối DB:', err));

// ================= CẤU TRÚC DATABASE ================= //
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    fullname: String,
    role: { type: String, default: 'student' },
    mcion: { type: Number, default: 0 }
}));

const AdminAuth = mongoose.model('AdminAuth', new mongoose.Schema({
    username: { type: String, default: 'admin' },
    password: { type: String, default: '123' }
}));

const Exam = mongoose.model('Exam', new mongoose.Schema({
    examCode: { type: String, required: true, unique: true },
    timeLimit: { type: Number, default: 0 },
    questions: Array
}));

const History = mongoose.model('History', new mongoose.Schema({
    username: String, fullname: String, examCode: String,
    correctCount: Number, totalQuestions: Number, score: String,
    time: String, earnedMcion: Number
}));

const UI = mongoose.model('UI', new mongoose.Schema({
    title: String, banner: String, primaryColor: String, bgColor: String
}));

// ================= API ENDPOINTS ================= //

// 1. Quản lý Tài khoản
app.post('/api/register', async (req, res) => {
    try {
        const { fullname, username, password } = req.body;
        const exists = await User.findOne({ username });
        if (exists) return res.json({ success: false, message: 'Tên đăng nhập đã tồn tại!' });
        await User.create({ fullname, username, password });
        res.json({ success: true });
    } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/login', async (req, res) => {
    const { username, password, role } = req.body;
    if (role === 'admin') {
        let admin = await AdminAuth.findOne();
        if (!admin) admin = await AdminAuth.create({ username: 'hangmoon', password: '041194' });
        if (username === admin.username && password === admin.password) {
            return res.json({ success: true, username, role: 'admin' });
        }
        return res.json({ success: false, message: 'Sai tài khoản hoặc mật khẩu Admin!' });
    }
    const user = await User.findOne({ username, password });
    if (user) res.json({ success: true, username: user.username, fullname: user.fullname, role: 'student' });
    else res.json({ success: false, message: 'Sai thông tin học sinh!' });
// API Đổi Mật Khẩu
app.post('/api/change-password', async (req, res) => {
    try {
        const { username, role, oldPassword, newPassword } = req.body;
        if (role === 'admin') {
            const admin = await AdminAuth.findOne();
            if (admin && admin.username === username && admin.password === oldPassword) {
                admin.password = newPassword;
                await admin.save();
                return res.json({ success: true, message: 'Đổi mật khẩu Admin thành công!' });
            }
            return res.json({ success: false, message: 'Mật khẩu cũ không chính xác!' });
        } else {
            const user = await User.findOne({ username, password: oldPassword });
            if (user) {
                user.password = newPassword;
                await user.save();
                return res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
            }
            return res.json({ success: false, message: 'Mật khẩu cũ không chính xác!' });
        }
    } catch (e) { 
        res.json({ success: false, message: 'Lỗi hệ thống: ' + e.message }); 
    }
});

// API Cập nhật Avatar (Kiểm tra xem học viên đã sở hữu vật phẩm/khung/avatar đó chưa)
app.post('/api/update-avatar', async (req, res) => {
    try {
        const { username, avatarUrl, itemName } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.json({ success: false, message: 'Không tìm thấy học viên!' });

        // Nếu chọn dùng ảnh mặc định thì cho phép luôn
        if (avatarUrl === "default") {
            user.avatar = "https://i.imgur.com/6VBx3io.png";
            await user.save();
            return res.json({ success: true, message: 'Đã chuyển về avatar mặc định!', user });
        }

        // Kiểm tra xem học viên đã mua vật phẩm này trong kho chưa
        if (!user.inventory.includes(itemName)) {
            return res.json({ success: false, message: 'Bạn chưa sở hữu vật phẩm này trong cửa hàng!' });
        }

        user.avatar = avatarUrl;
        await user.save();
        res.json({ success: true, message: 'Đổi avatar thành công!', user });
    } catch (e) {
        res.json({ success: false, message: 'Lỗi: ' + e.message });
    }
});
});
  

// 2. Quản lý Đề Thi
app.get('/api/exams', async (req, res) => {
    const exams = await Exam.find({}, 'examCode');
    res.json(exams.map(e => e.examCode));
});

app.get('/api/exams/:code', async (req, res) => {
    const exam = await Exam.findOne({ examCode: req.params.code });
    res.json(exam || { timeLimit: 0, questions: [] });
});

app.post('/api/exams', async (req, res) => {
    const { examCode, timeLimit, questions } = req.body;
    await Exam.findOneAndUpdate({ examCode }, { timeLimit, questions }, { upsert: true });
    res.json({ success: true });
});

app.put('/api/exams/:code', async (req, res) => {
    const { timeLimit, questions } = req.body;
    await Exam.findOneAndUpdate({ examCode: req.params.code }, { timeLimit, questions });
    res.json({ success: true });
});

app.delete('/api/exams/:code', async (req, res) => {
    await Exam.deleteOne({ examCode: req.params.code });
    res.json({ success: true });
});

// 3. Lịch Sử & Mcion
app.post('/api/submit', async (req, res) => {
    await History.create(req.body);
    await User.findOneAndUpdate({ username: req.body.username }, { $inc: { mcion: req.body.earnedMcion } });
    res.json({ success: true });
});

app.get('/api/history', async (req, res) => {
    const history = await History.find().sort({ _id: -1 }); // Lịch sử mới nhất lên đầu
    res.json(history);
});

app.get('/api/mcion/:username', async (req, res) => {
    const user = await User.findOne({ username: req.params.username });
    res.json({ balance: user ? user.mcion : 0 });
});

app.post('/api/mcion/grant', async (req, res) => {
    const user = await User.findOneAndUpdate({ username: req.body.username }, { $inc: { mcion: req.body.amount } }, { new: true });
    if (user) res.json({ success: true, balance: user.mcion });
    else res.json({ success: false, message: 'Không tìm thấy!' });
});

app.post('/api/mcion/buy', async (req, res) => {
    const user = await User.findOne({ username: req.body.username });
    if (user && user.mcion >= req.body.cost) {
        user.mcion -= req.body.cost;
        await user.save();
        res.json({ success: true, balance: user.mcion });
    } else res.json({ success: false, message: 'Không đủ Mcion!' });
});

// 4. UI & Admin Settings
app.get('/api/ui', async (req, res) => {
    let ui = await UI.findOne();
    if (!ui) ui = await UI.create({ title: "Hệ Thống Trắc Nghiệm Online", banner: "", primaryColor: "#3498db", bgColor: "#f4f7f6" });
    res.json(ui);
});

app.post('/api/ui', async (req, res) => {
    let ui = await UI.findOne();
    if (ui) await UI.updateOne({}, req.body);
    else await UI.create(req.body);
    res.json({ success: true });
});

app.post('/api/admin/change', async (req, res) => {
    let admin = await AdminAuth.findOne();
    if (admin) {
        admin.username = req.body.newAdminUser;
        admin.password = req.body.newAdminPass;
        await admin.save();
    }
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server đang chạy tại PORT ${PORT}`));
