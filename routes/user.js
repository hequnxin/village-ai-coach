const express = require('express');
const { getUserSessions, getUserFavoriteMessages } = require('../services/sessionService');
const db = require('../services/db');

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
    const points = sessionCount * 10 + favoriteCount * 2 + favoriteSessionCount * 5 + approvedUploads * 20;
    const level = Math.floor(points / 100) + 1;
    const nextLevelPoints = level * 100;
    const badges = [];
    if (sessionCount >= 10) badges.push({ name: '勤学好问', icon: '📚' });
    if (approvedUploads >= 3) badges.push({ name: '知识贡献者', icon: '🏅' });
    if (favoriteCount >= 20) badges.push({ name: '收藏达人', icon: '⭐' });
    if (favoriteSessionCount >= 5) badges.push({ name: '会话收藏家', icon: '💬' });
    res.json({
        points, level, nextLevelPoints, badges,
        stats: { sessionCount, favoriteCount, favoriteSessionCount, approvedUploads, pendingUploads }
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
    const { toggleFavorite } = require('../services/sessionService');
    await toggleFavorite(userId, messageId, msg.session_id, msg.sessionTitle, msg.content, msg.role, action);
    res.json({ success: true });
});
// 获取用户积分历史（最近7天）
router.get('/points-history', async (req, res) => {
  const userId = req.user.userId;
  try {
    // 查询最近7天的每日积分变化（从 user_points 表按日期聚合）
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const startStr = sevenDaysAgo.toISOString().slice(0, 10);

    // 查询 user_points 表中每天的积分总和（注意：user_points 记录的是每次加分的明细）
    const dailyPoints = await db.all(`
      SELECT 
        DATE(created_at) as date,
        SUM(points) as daily_total
      FROM user_points
      WHERE user_id = $1 AND created_at >= $2
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [userId, startStr]);

    // 生成最近7天的日期列表和对应的累计积分
    const dates = [];
    const pointsMap = new Map();
    for (const row of dailyPoints) {
      pointsMap.set(row.date, row.daily_total);
    }
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dateStr = d.toISOString().slice(0, 10);
      dates.push(dateStr);
    }
    // 计算累计积分（从第一天开始累加）
    let cumulative = 0;
    const cumulativePoints = [];
    for (const date of dates) {
      const daily = pointsMap.get(date) || 0;
      cumulative += daily;
      cumulativePoints.push(cumulative);
    }
    // 格式化日期显示为 MM-DD
    const labels = dates.map(d => d.slice(5));
    res.json({ labels, points: cumulativePoints });
  } catch (err) {
    console.error('获取积分历史失败:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;