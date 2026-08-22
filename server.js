const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Khởi tạo thư mục lưu dữ liệu Database (JSON)
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Hàm đọc và ghi file JSON
const getFile = (filename, defaultData) => {
    const filepath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filepath)) fs.writeFileSync(filepath, JSON.stringify(defaultData, null, 2));
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
};
const saveFile = (filename, data) => fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));

// ================= API ENDPOINTS ================= //

// 1. Quản lý Tài khoản (Login / Register)
app.post('/api/register', (req, res) => {
    const { fullname, username, password } = req.body;
    let users = getFile('users.json', []);
    if (users.find(u => u.username === username)) {
        return res.json({ success: false, message: 'Tên đăng nhập đã tồn tại!' });
    }
    users.push({ fullname, username, password, role: 'student', mcion: 0 });
    saveFile('users.json', users);
    res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { username, password, role } = req.body;
    
    // Mặc định tài khoản admin
    if (role === 'admin') {
        const adminData = getFile('admin.json', { username: 'admin', password: '123' });
        if (username === adminData.username && password === adminData.password) {
            return res.json({ success: true, username, role: 'admin' });
        }
        return res.json({ success: false, message: 'Sai tài khoản hoặc mật khẩu Admin!' });
    }

    // Tài khoản học sinh
    let users = getFile('users.json', []);
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        res.json({ success: true, username: user.username, fullname: user.fullname, role: 'student' });
    } else {
        res.json({ success: false, message: 'Sai tài khoản hoặc mật khẩu Học sinh!' });
    }
});

// 2. Quản lý Đề Thi (Thêm, Sửa, Xóa, Lấy danh sách)
app.get('/api/exams', (req, res) => {
    const exams = getFile('exams.json', {});
    res.json(Object.keys(exams)); // Trả về danh sách mã đề
});

app.get('/api/exams/:code', (req, res) => {
    const exams = getFile('exams.json', {});
    const examData = exams[req.params.code] || { timeLimit: 0, questions: [] };
    res.json(examData);
});

app.post('/api/exams', (req, res) => {
    const { examCode, timeLimit, questions } = req.body;
    let exams = getFile('exams.json', {});
    exams[examCode] = { timeLimit: timeLimit || 0, questions: questions || [] };
    saveFile('exams.json', exams);
    res.json({ success: true });
});

app.put('/api/exams/:code', (req, res) => {
    const { timeLimit, questions } = req.body;
    let exams = getFile('exams.json', {});
    if (exams[req.params.code]) {
        exams[req.params.code] = { timeLimit: timeLimit || 0, questions: questions || [] };
        saveFile('exams.json', exams);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: 'Không tìm thấy mã đề!' });
    }
});

app.delete('/api/exams/:code', (req, res) => {
    let exams = getFile('exams.json', {});
    if (exams[req.params.code]) {
        delete exams[req.params.code];
        saveFile('exams.json', exams);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: 'Không tìm thấy mã đề!' });
    }
});

// 3. Quản lý Điểm số / Lịch sử / Mcion
app.post('/api/submit', (req, res) => {
    let history = getFile('history.json', []);
    history.push(req.body); // req.body chứa thông tin bài thi
    saveFile('history.json', history);

    // Cộng Mcion
    let users = getFile('users.json', []);
    const userIndex = users.findIndex(u => u.username === req.body.username);
    if (userIndex !== -1) {
        users[userIndex].mcion = (users[userIndex].mcion || 0) + req.body.earnedMcion;
        saveFile('users.json', users);
    }
    res.json({ success: true });
});

app.get('/api/history', (req, res) => {
    const history = getFile('history.json', []);
    // Đảo ngược để lịch sử mới nhất lên đầu
    res.json(history.reverse());
});

app.get('/api/mcion/:username', (req, res) => {
    const users = getFile('users.json', []);
    const user = users.find(u => u.username === req.params.username);
    res.json({ balance: user ? (user.mcion || 0) : 0 });
});

app.post('/api/mcion/grant', (req, res) => {
    const { username, amount } = req.body;
    let users = getFile('users.json', []);
    const user = users.find(u => u.username === username);
    if (user) {
        user.mcion = (user.mcion || 0) + amount;
        saveFile('users.json', users);
        res.json({ success: true, balance: user.mcion });
    } else {
        res.json({ success: false, message: 'Không tìm thấy học sinh!' });
    }
});

app.post('/api/mcion/buy', (req, res) => {
    const { username, cost } = req.body;
    let users = getFile('users.json', []);
    const user = users.find(u => u.username === username);
    if (user && user.mcion >= cost) {
        user.mcion -= cost;
        saveFile('users.json', users);
        res.json({ success: true, balance: user.mcion });
    } else {
        res.json({ success: false, message: 'Không đủ Mcion để đổi!' });
    }
});

// 4. Cấu hình UI & Admin
app.get('/api/ui', (req, res) => {
    const uiData = getFile('ui.json', { 
        title: "Hệ Thống Trắc Nghiệm Online", 
        banner: "", 
        primaryColor: "#3498db", 
        bgColor: "#f4f7f6" 
    });
    res.json(uiData);
});

app.post('/api/ui', (req, res) => {
    saveFile('ui.json', req.body);
    res.json({ success: true });
});

app.post('/api/admin/change', (req, res) => {
    const { newAdminUser, newAdminPass } = req.body;
    saveFile('admin.json', { username: newAdminUser, password: newAdminPass });
    res.json({ success: true });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`✅ Backend Server đang chạy tại http://localhost:${PORT}`);
});