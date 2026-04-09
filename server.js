require('dotenv').config();
require('express-async-errors');
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const errorHandler = require('./middlewares/errorHandler');
const db = require('./services/db');

// 路由导入
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const simulateRoutes = require('./routes/simulate');
const knowledgeRoutes = require('./routes/knowledge');
const userRoutes = require('./routes/user');
const sessionRoutes = require('./routes/session');
const quizRoutes = require('./routes/quiz');
const meetingRoutes = require('./routes/meeting');

const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// 静态文件服务：指向前端构建产物（Vite 输出到 public/dist）
app.use(express.static('public/dist'));
// 音效等静态资源仍然从 public 根目录提供
app.use(express.static('public'));

// 确保数据目录存在
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

// JWT 认证中间件
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: '未提供认证令牌' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: '令牌无效或已过期' });
  }
};

// 挂载路由（公开路由）
app.use('/api', authRoutes);

// 需要认证的路由
app.use('/api', authenticate, sessionRoutes);
app.use('/api/chat', authenticate, chatRoutes);
app.use('/api/simulate', authenticate, simulateRoutes);
app.use('/api/knowledge', authenticate, knowledgeRoutes);
app.use('/api/user', authenticate, userRoutes);
app.use('/api/quiz', authenticate, quizRoutes);
app.use('/api/meeting', authenticate, meetingRoutes);

// 错误处理中间件
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

// 启动服务器（不再自动初始化数据库，因为构建阶段已完成）
async function startServer() {
  try {
    // 仅检查数据库是否已初始化，不执行建表（避免重复）
    const tableCheck = await db.get("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users')");
    if (!tableCheck.exists) {
      console.error('❌ 数据库未初始化，请确保构建阶段已运行 initDb.js');
      process.exit(1);
    }
    app.listen(PORT, () => {
      console.log(`村官AI伙伴服务运行在 http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('启动失败:', err);
    process.exit(1);
  }
}

startServer();