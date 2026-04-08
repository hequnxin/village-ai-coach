const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../services/db');

const router = express.Router();

router.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
    const existing = await db.get('SELECT id FROM users WHERE username = $1', [username]);
    if (existing) return res.status(400).json({ error: '用户名已存在' });
    const hashed = await bcrypt.hash(password, 10);
    const id = uuidv4();
    await db.run('INSERT INTO users (id, username, password, role, created_at) VALUES ($1, $2, $3, $4, $5)',
                 [id, username, hashed, 'user', new Date().toISOString()]);
    res.json({ success: true });
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await db.get('SELECT * FROM users WHERE username = $1', [username]);
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: '用户名或密码错误' });
    }
    const token = jwt.sign(
        { userId: user.id, username: user.username, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
    res.json({ token, username: user.username, role: user.role });
});

router.post('/refresh', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: '未提供认证令牌' });
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
        const newToken = jwt.sign(
            { userId: decoded.userId, username: decoded.username, role: decoded.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        res.json({ token: newToken });
    } catch (err) {
        res.status(401).json({ error: '无效令牌' });
    }
});

module.exports = router;