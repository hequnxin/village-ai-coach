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

// 静态文件：优先使用构建产物，再使用 public 根目录（音效等）
app.use(express.static('public/dist'));
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

// 公开路由
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

// ★★★ SPA fallback：所有非 API 请求返回 index.html ★★★
app.get('*', (req, res) => {
  // 如果是 API 路径（理论上前面已匹配，但以防万一）
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API not found' });
  }
  const indexPath = path.join(__dirname, 'public/dist/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Frontend not built. Please run `npm run build` in frontend directory.');
  }
});

const PORT = process.env.PORT || 3001;

// 启动服务器前初始化数据库
async function startServer() {
  try {
    const initDb = require('./scripts/initDb');
    await initDb();
    console.log('数据库初始化完成');

    // 检查知识库是否有数据（可选提示）
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