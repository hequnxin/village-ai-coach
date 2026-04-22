// routes/user.js

const express = require('express');
const { getUserSessions, getUserFavoriteMessages, toggleFavorite } = require('../services/sessionService');
const db = require('../services/db');
const pointsService = require('../services/pointsService');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

router.get('/growth', async (req, res) => {
  const userId = req.user.userId;
  const sessions = await getUserSessions(userId);
  const sessionCount = sessions.length;
  const favorites = await getUserFavoriteMessages(userId);
  const favoriteCount = favorites.length;
  const favoriteSessionCount = sessions.filter(s => s.favorite).length;
  const allKnowledge = await db.all('SELECT * FROM knowledge WHERE submitted_by = $1', [req.user.username]);
  const approvedUploads = allKnowledge.filter(k => k.status === 'approved').length;
  const pendingUploads = allKnowledge.filter(k => k.status === 'pending').length;

  // 统计用户已完成的趣味闯关主题数量
  const funCompletedRes = await db.get(
    `SELECT COUNT(*) as count FROM user_theme_progress WHERE user_id = $1 AND completed = 1`,
    [userId]
  );
  const funCompleted = funCompletedRes ? funCompletedRes.count : 0;

  // 积分从 user_points 汇总
  const pointsRes = await db.get(`SELECT COALESCE(SUM(points), 0) as total FROM user_points WHERE user_id = $1`, [userId]);
  const points = pointsRes.total;
  const level = Math.floor(points / 100) + 1;
  const nextLevelPoints = level * 100;

  const badges = [];
  if (sessionCount >= 10) badges.push({ name: '勤学好问', icon: '📚' });
  if (approvedUploads >= 3) badges.push({ name: '知识贡献者', icon: '🏅' });
  if (favoriteCount >= 20) badges.push({ name: '收藏达人', icon: '⭐' });
  if (favoriteSessionCount >= 5) badges.push({ name: '会话收藏家', icon: '💬' });
  if (funCompleted >= 3) badges.push({ name: '挑战王者', icon: '👑' });

  res.json({
    points,
    level,
    nextLevelPoints,
    badges,
    stats: {
      sessionCount,
      favoriteCount,
      favoriteSessionCount,
      approvedUploads,
      pendingUploads,
      funCompleted
    }
  });
});

router.get('/favorites', async (req, res) => {
  const favorites = await getUserFavoriteMessages(req.user.userId);
  res.json(favorites);
});

router.post('/favorite', async (req, res) => {
  const { messageId, action } = req.body;
  const userId = req.user.userId;
  const msg = await db.get(
    `SELECT m.id, m.content, m.role, m.session_id, s.title as "sessionTitle"
     FROM messages m
     JOIN sessions s ON m.session_id = s.id
     WHERE m.id = $1 AND s.user_id = $2`,
    [messageId, userId]
  );
  if (!msg) return res.status(404).json({ error: '消息不存在' });
  await toggleFavorite(userId, messageId, msg.session_id, msg.sessionTitle, msg.content, msg.role, action);
  if (action === 'add') {
    await pointsService.addPoints(userId, pointsService.FAVORITE_MESSAGE, '收藏消息');
  }
  res.json({ success: true });
});

// ==================== 修复后的积分历史接口（支持东八区时区、累计积分） ====================
router.get('/points-history', async (req, res) => {
  const userId = req.user.userId;
  try {
    // 生成最近7天的日期（东八区，格式 YYYY-MM-DD）
    const today = new Date();
    const dates = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
    }

    // 按东八区日期分组查询每日积分总和
    const dailyPoints = await db.all(`
      SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date as date,
             COALESCE(SUM(points), 0) as daily_total
      FROM user_points
      WHERE user_id = $1
      GROUP BY date
      ORDER BY date ASC
    `, [userId]);

    // 构建日期 -> 积分的映射
    const pointsMap = new Map();
    for (const row of dailyPoints) {
      pointsMap.set(row.date, row.daily_total);
    }

    // 计算累计积分
    let cumulative = 0;
    const cumulativePoints = [];
    for (const date of dates) {
      const daily = pointsMap.get(date) || 0;
      cumulative += daily;
      cumulativePoints.push(cumulative);
    }

    // 返回格式：["04-16", "04-17", ...] 和对应的累计积分
    const labels = dates.map(d => d.slice(5));
    res.json({ labels, points: cumulativePoints });
  } catch (err) {
    console.error('获取积分历史失败:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 修改密码接口
router.post('/change-password', async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const userId = req.user.userId;
  const user = await db.get(`SELECT password FROM users WHERE id = $1`, [userId]);
  const bcrypt = require('bcrypt');
  const valid = await bcrypt.compare(oldPassword, user.password);
  if (!valid) return res.status(401).json({ error: '原密码错误' });
  const hashed = await bcrypt.hash(newPassword, 10);
  await db.run(`UPDATE users SET password = $1 WHERE id = $2`, [hashed, userId]);
  res.json({ success: true });
});

module.exports = router;