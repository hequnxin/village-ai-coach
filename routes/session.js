const express = require('express');
const sessionService = require('../services/sessionService');

const router = express.Router();

router.get('/sessions', async (req, res) => {
    try {
        const sessions = await sessionService.getUserSessions(req.user.userId);
        res.json(sessions);
    } catch (err) {
        console.error('获取会话失败:', err);
        res.status(500).json({ error: '获取会话失败' });
    }
});

router.post('/session', async (req, res) => {
    try {
        const { title } = req.body;
        const session = await sessionService.createSession(req.user.userId, { title: title || '新会话' });
        res.json({ session, sessionId: session.id });
    } catch (err) {
        console.error('创建会话失败:', err);
        if (err.code === '23503') { // PostgreSQL 外键约束错误码
            return res.status(400).json({ error: '用户不存在，请重新登录' });
        }
        res.status(500).json({ error: '创建会话失败', details: err.message });
    }
});

router.get('/session/:sessionId', async (req, res) => {
    try {
        const session = await sessionService.getSession(req.user.userId, req.params.sessionId);
        if (!session) return res.status(404).json({ error: '会话不存在' });
        res.json(session);
    } catch (err) {
        console.error('获取会话详情失败:', err);
        res.status(500).json({ error: '获取会话详情失败' });
    }
});

router.put('/session/:sessionId', async (req, res) => {
    try {
        await sessionService.updateSession(req.user.userId, req.params.sessionId, req.body);
        res.json({ success: true });
    } catch (err) {
        console.error('更新会话失败:', err);
        res.status(500).json({ error: '更新会话失败' });
    }
});

router.delete('/session/:sessionId', async (req, res) => {
    try {
        await sessionService.deleteSession(req.user.userId, req.params.sessionId);
        res.json({ success: true });
    } catch (err) {
        console.error('删除会话失败:', err);
        res.status(500).json({ error: '删除会话失败' });
    }
});

router.post('/session/:sessionId/favorite', async (req, res) => {
    try {
        const { favorite } = req.body;
        await sessionService.setSessionFavorite(req.user.userId, req.params.sessionId, favorite);
        res.json({ success: true });
    } catch (err) {
        console.error('设置收藏失败:', err);
        res.status(500).json({ error: '操作失败' });
    }
});

module.exports = router;