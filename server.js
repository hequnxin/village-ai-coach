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
// 音效等静态资源仍然从 public 根目录提供（如有需要）
app.use(express.static('public'));

// 确保数据目录存在（用于可能的上传文件等）
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

// 错误处理中间件（必须放在所有路由之后）
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

// 启动服务器前初始化数据库（建表、默认数据、全文索引）
async function startServer() {
  try {
    // 导入初始化脚本（注意：initDb 需要导出为函数）
    const initDb = require('./scripts/initDb');
    await initDb();
    console.log('数据库初始化完成');

    // 注意：知识库数据导入（knowledge.json）需要单独执行一次脚本
    const countResult = await db.get('SELECT COUNT(*) as count FROM knowledge');
    if (countResult.count === 0) {
      console.warn('⚠️ 知识库表为空，请运行 node scripts/importKnowledge.js 导入初始数据');
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