const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Cơ sở dữ liệu lưu trữ tạm thời trên bộ nhớ RAM
let db = {
    users: {},      // Thông tin tài khoản học sinh
    exams: {},      // Dữ liệu bộ đề thi
    history: [],    // Lịch sử làm bài
    mcion: {},      // Số dư Mcion của từng học sinh
    admin: { username: "admin", password: "admin123" },
    ui: {
        title: "Hệ Thống Trắc Nghiệm Online",
        banner: "",
        primaryColor: "#3498db",
        bgColor: "#f4f7f6"
    }
};

// --- API XÁC THỰC (AUTH) ---
app.post('/api/register', (req, res) => {
    const { username, password, fullname } = req.body;
    if (db.users[username]) {
        return res.status(400).json({ success: false, message: "Tên đăng nhập đã tồn tại!" });
    }
    db.users[username] = { password, fullname, role: "student" };
    res.json({ success: true, message: "Đăng ký thành công!" });
});

app.post('/api/login', (req, res) => {
    const { username, password, role } = req.body;

    if (role === 'admin') {
        if (username === db.admin.username && password === db.admin.password) {
            return res.json({ success: true, role: 'admin', username });
        }
        return res.status(401).json({ success: false, message: "Tài khoản Admin không đúng!" });
    }

    const user = db.users[username];
    if (user && user.password === password) {
        return res.json({ success: true, role: 'student', username, fullname: user.fullname });
    }
    res.status(401).json({ success: false, message: "Mật khẩu hoặc tên đăng nhập không đúng!" });
});

// --- API MCION ---
app.get('/api/mcion/:username', (req, res) => {
    const balance = db.mcion[req.params.username] || 0;
    res.json({ balance });
});

app.post('/api/mcion/grant', (req, res) => {
    const { username, amount } = req.body;
    db.mcion[username] = (db.mcion[username] || 0) + parseInt(amount, 10);
    res.json({ success: true, balance: db.mcion[username] });
});

app.post('/api/mcion/buy', (req, res) => {
    const { username, cost, itemName } = req.body;
    const current = db.mcion[username] || 0;
    if (current < cost) {
        return res.status(400).json({ success: false, message: "Không đủ Mcion!" });
    }
    db.mcion[username] = current - cost;
    res.json({ success: true, balance: db.mcion[username] });
});

// --- API QUẢN LÝ ĐỀ THI ---
app.post('/api/exams', (req, res) => {
    const { examCode, questions } = req.body;
    db.exams[examCode] = questions;
    res.json({ success: true, message: `Lưu thành công đề ${examCode}` });
});

app.get('/api/exams', (req, res) => {
    res.json(Object.keys(db.exams));
});

app.get('/api/exams/:code', (req, res) => {
    const questions = db.exams[req.params.code];
    if (!questions) return res.status(404).json({ message: "Không tìm thấy đề!" });
    res.json(questions);
});

// --- API NỘP BÀI & LỊCH SỬ ---
app.post('/api/submit', (req, res) => {
    const record = req.body;
    db.history.unshift(record);
    db.mcion[record.username] = (db.mcion[record.username] || 0) + record.earnedMcion;
    res.json({ success: true, balance: db.mcion[record.username] });
});

app.get('/api/history', (req, res) => {
    res.json(db.history);
});

// --- API CẤU HÌNH GIAO DIỆN & ADMIN ---
app.get('/api/ui', (req, res) => {
    res.json(db.ui);
});

app.post('/api/ui', (req, res) => {
    db.ui = { ...db.ui, ...req.body };
    res.json({ success: true });
});

app.post('/api/admin/change', (req, res) => {
    const { newAdminUser, newAdminPass } = req.body;
    db.admin = { username: newAdminUser, password: newAdminPass };
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server đang chạy tại cổng http://localhost:${PORT}`));