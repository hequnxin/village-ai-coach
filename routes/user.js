const express = require('express');
const { getUserSessions, getUserFavoriteMessages } = require('../services/sessionService');
const db = require('../services/db');

const router = express.Router();

router.get('/growth', (req, res) => {
  const userId = req.user.userId;
  const sessions = getUserSessions(userId);
  const sessionCount = sessions.length;

  const favorites = getUserFavoriteMessages(userId);
  const favoriteCount = favorites.length;

  const favoriteSessionCount = sessions.filter(s => s.favorite).length;

  const allKnowledge = db.prepare('SELECT * FROM knowledge WHERE submitted_by = ?').all(req.user.username);
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
    points,
    level,
    nextLevelPoints,
    badges,
    stats: {
      sessionCount,
      favoriteCount,
      favoriteSessionCount,
      approvedUploads,
      pendingUploads
    }
  });
});

router.get('/favorites', (req, res) => {
  const favorites = getUserFavoriteMessages(req.user.userId);
  res.json(favorites);
});

router.post('/favorite', (req, res) => {
  const { messageId, action } = req.body;
  const userId = req.user.userId;

  // 查找消息所属会话和内容
  const msg = db.prepare(`
    SELECT m.id, m.content, m.role, m.session_id, s.title as sessionTitle
    FROM messages m
    JOIN sessions s ON m.session_id = s.id
    WHERE m.id = ? AND s.user_id = ?
  `).get(messageId, userId);
  if (!msg) return res.status(404).json({ error: '消息不存在' });

  const { toggleFavorite } = require('../services/sessionService');
  toggleFavorite(
    userId,
    messageId,
    msg.session_id,
    msg.sessionTitle,
    msg.content,
    msg.role,
    action
  );
  res.json({ success: true });
});

module.exports = router;