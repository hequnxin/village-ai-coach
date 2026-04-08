require('dotenv').config();
require('express-async-errors');
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const errorHandler = require('./middlewares/errorHandler');
const { initVectorIndex } = require('./services/vectorSearch');
const db = require('./services/db');  // 新 db 模块

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const simulateRoutes = require('./routes/simulate');
const knowledgeRoutes = require('./routes/knowledge');
const userRoutes = require('./routes/user');
const sessionRoutes = require('./routes/session');
const quizRoutes = require('./routes/quiz');
const meetingRoutes = require('./routes/meeting');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 确保数据目录存在（仅用于可能的上传文件，数据库已迁移到 PostgreSQL）
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

// 挂载路由
app.use('/api', authRoutes);
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

// 启动前等待数据库初始化完成
async function startServer() {
  try {
    // 初始化数据库表（如果尚未创建）
    const initDb = require('./scripts/initDb');
    await initDb();   // initDb 内部会执行建表和插入默认数据
    console.log('数据库初始化完成');

    // 初始化向量索引（异步，不阻塞启动）
    initVectorIndex().catch(console.error);

    app.listen(PORT, () => {
      console.log(`村官AI伙伴服务运行在 http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('启动失败:', err);
    process.exit(1);
  }
}

startServer();