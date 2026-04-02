const express = require('express');
const sessionService = require('../services/sessionService');

const router = express.Router();

// 获取所有会话
router.get('/sessions', (req, res) => {
  try {
    const sessions = sessionService.getUserSessions(req.user.userId);
    res.json(sessions);
  } catch (err) {
    console.error('获取会话失败:', err);
    res.status(500).json({ error: '获取会话失败' });
  }
});

// 创建新会话
router.post('/session', (req, res) => {
  try {
    const { title } = req.body;
    const session = sessionService.createSession(req.user.userId, { title: title || '新会话' });
    res.json({ session, sessionId: session.id });
  } catch (err) {
    console.error('创建会话失败:', err);
    // 针对外键约束给出明确提示
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return res.status(400).json({ error: '用户不存在，请重新登录' });
    }
    res.status(500).json({ error: '创建会话失败', details: err.message });
  }
});

// 获取单个会话详情
router.get('/session/:sessionId', (req, res) => {
  try {
    const session = sessionService.getSession(req.user.userId, req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }
    res.json(session);
  } catch (err) {
    console.error('获取会话详情失败:', err);
    res.status(500).json({ error: '获取会话详情失败' });
  }
});

// 更新会话
router.put('/session/:sessionId', (req, res) => {
  try {
    sessionService.updateSession(req.user.userId, req.params.sessionId, req.body);
    res.json({ success: true });
  } catch (err) {
    console.error('更新会话失败:', err);
    res.status(500).json({ error: '更新会话失败' });
  }
});

// 删除会话
router.delete('/session/:sessionId', (req, res) => {
  try {
    sessionService.deleteSession(req.user.userId, req.params.sessionId);
    res.json({ success: true });
  } catch (err) {
    console.error('删除会话失败:', err);
    res.status(500).json({ error: '删除会话失败' });
  }
});

// 设置会话收藏状态
router.post('/session/:sessionId/favorite', (req, res) => {
  try {
    const { favorite } = req.body;
    sessionService.setSessionFavorite(req.user.userId, req.params.sessionId, favorite);
    res.json({ success: true });
  } catch (err) {
    console.error('设置收藏失败:', err);
    res.status(500).json({ error: '操作失败' });
  }
});

module.exports = router;