const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// Kết nối Database
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Đã kết nối MongoDB!'))
  .catch(err => console.error('❌ Lỗi kết nối DB:', err));

// ================= CẤU TRÚC DATABASE ================= //
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    fullname: String,
    role: { type: String, default: 'student' },
    mcion: { type: Number, default: 0 },
    avatar: { type: String, default: "https://api.dicebear.com/7.x/bottts/svg?seed=Default" },
    inventory: { type: [String], default: [] }
}));

const AdminAuth = mongoose.model('AdminAuth', new mongoose.Schema({
    username: { type: String, default: 'hangmoon' },
    password: { type: String, default: '041194' }
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

// 1. Quản lý Tài khoản & Đăng nhập
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
    try {
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
        if (user) {
            return res.json({ 
                success: true, 
                username: user.username, 
                fullname: user.fullname, 
                role: 'student',
                avatar: user.avatar,
                mcion: user.mcion
            });
        }
        res.json({ success: false, message: 'Sai thông tin học sinh!' });
    } catch (e) {
        res.json({ success: false, message: 'Lỗi server: ' + e.message });
    }
});

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

// API Cập nhật Avatar
app.post('/api/update-avatar', async (req, res) => {
    try {
        const { username, avatarUrl, itemName } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.json({ success: false, message: 'Không tìm thấy học viên!' });

        if (itemName === 'Mặc định' || avatarUrl.includes('seed=Default')) {
            user.avatar = "https://api.dicebear.com/7.x/bottts/svg?seed=Default";
            await user.save();
            return res.json({ success: true, message: 'Đã chuyển về avatar mặc định!', user });
        }

        if (!user.inventory.includes(itemName)) {
            return res.json({ success: false, message: 'Bạn chưa sở hữu vật phẩm này!' });
        }

        user.avatar = avatarUrl;
        await user.save();
        res.json({ success: true, message: 'Đổi avatar thành công!', user });
    } catch (e) {
        res.json({ success: false, message: 'Lỗi: ' + e.message });
    }
});

// 2. Quản lý Đề Thi
app.get('/api/exams', async (req, res) => {
    try {
        const exams = await Exam.find({}, 'examCode');
        res.json(exams.map(e => e.examCode));
    } catch (e) { res.json([]); }
});

app.get('/api/exams/:code', async (req, res) => {
    try {
        const exam = await Exam.findOne({ examCode: req.params.code });
        res.json(exam || { timeLimit: 0, questions: [] });
    } catch (e) { res.json({ timeLimit: 0, questions: [] }); }
});

app.post('/api/exams', async (req, res) => {
    try {
        const { examCode, timeLimit, questions } = req.body;
        if (!examCode || !questions) {
            return res.json({ success: false, message: 'Thiếu mã đề hoặc câu hỏi!' });
        }
        await Exam.findOneAndUpdate(
            { examCode }, 
            { timeLimit: timeLimit || 0, questions }, 
            { upsert: true, new: true }
        );
        res.json({ success: true, message: 'Lưu bộ đề thành công!' });
    } catch (e) {
        res.json({ success: false, message: 'Lỗi lưu đề: ' + e.message });
    }
});

app.put('/api/exams/:code', async (req, res) => {
    try {
        const { timeLimit, questions } = req.body;
        await Exam.findOneAndUpdate({ examCode: req.params.code }, { timeLimit, questions });
        res.json({ success: true });
    } catch (e) { res.json({ success: false, message: e.message }); }
});

// API Xóa đề thi (Đã khắc phục lỗi crash server)
app.delete('/api/exams/:code', async (req, res) => {
    try {
        const result = await Exam.deleteOne({ examCode: req.params.code });
        if (result.deletedCount > 0) {
            res.json({ success: true, message: `Đã xóa đề ${req.params.code} thành công!` });
        } else {
            res.json({ success: false, message: 'Không tìm thấy đề thi cần xóa!' });
        }
    } catch (e) { 
        res.json({ success: false, message: 'Lỗi server: ' + e.message }); 
    }
});

// 3. Lịch sử & Mcion
app.get('/api/history', async (req, res) => {
    try {
        const history = await History.find().sort({ _id: -1 });
        res.json(history);
    } catch (e) { res.json([]); }
});

// Bổ sung API nộp bài thi & lưu lịch sử làm bài
app.post('/api/history', async (req, res) => {
    try {
        const { username, fullname, examCode, correctCount, totalQuestions, score, time, earnedMcion } = req.body;
        await History.create({ username, fullname, examCode, correctCount, totalQuestions, score, time, earnedMcion });
        
        if (earnedMcion && earnedMcion > 0) {
            await User.findOneAndUpdate({ username }, { $inc: { mcion: earnedMcion } });
        }
        res.json({ success: true, message: 'Đã lưu lịch sử làm bài!' });
    } catch (e) {
        res.json({ success: false, message: 'Lỗi lưu lịch sử: ' + e.message });
    }
});

app.get('/api/mcion/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        res.json({ balance: user ? user.mcion : 0, inventory: user ? user.inventory : [] });
    } catch (e) { res.json({ balance: 0, inventory: [] }); }
});

app.post('/api/mcion/grant', async (req, res) => {
    try {
        const { username, amount } = req.body;
        const numAmount = parseInt(amount, 10);
        if (!username || isNaN(numAmount)) {
            return res.json({ success: false, message: 'Vui lòng nhập đúng username và số lượng Mcion!' });
        }
        const user = await User.findOneAndUpdate(
            { username }, 
            { $inc: { mcion: numAmount } }, 
            { new: true }
        );
        if (user) {
            res.json({ success: true, message: `Đã cập nhật ${numAmount} Mcion cho học sinh ${username}!`, balance: user.mcion });
        } else {
            res.json({ success: false, message: 'Không tìm thấy tài khoản học sinh này!' });
        }
    } catch (e) {
        res.json({ success: false, message: 'Lỗi server: ' + e.message });
    }
});

app.post('/api/mcion/buy', async (req, res) => {
    try {
        const { username, cost, itemName, avatarUrl } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.json({ success: false, message: 'Người dùng không tồn tại!' });

        if (user.inventory.includes(itemName)) {
            return res.json({ success: false, message: 'Bạn đã sở hữu vật phẩm này rồi!' });
        }

        if (user.mcion < cost) {
            return res.json({ success: false, message: 'Không đủ Mcion để mua vật phẩm!' });
        }

        user.mcion -= cost;
        user.inventory.push(itemName);
        if (avatarUrl) user.avatar = avatarUrl;
        
        await user.save();
        res.json({ success: true, balance: user.mcion, user });
    } catch (e) { res.json({ success: false, message: e.message }); }
});

// 4. UI & Admin Settings
app.get('/api/ui', async (req, res) => {
    try {
        let ui = await UI.findOne();
        if (!ui) ui = await UI.create({ title: "Hệ Thống Trắc Nghiệm Online", banner: "", primaryColor: "#3498db", bgColor: "#f4f7f6" });
        res.json(ui);
    } catch (e) { res.json({}); }
});

app.post('/api/ui', async (req, res) => {
    try {
        let ui = await UI.findOne();
        if (ui) await UI.updateOne({}, req.body);
        else await UI.create(req.body);
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server đang chạy tại PORT ${PORT}`));
