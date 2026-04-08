const express = require('express');
const { chat } = require('../services/openai');
const { addMessage, createSession, getSession } = require('../services/sessionService');
const db = require('../services/db');
const router = express.Router();

// 创建会议会话
router.post('/session', async (req, res) => {
  const { topic, villagers } = req.body;
  const userId = req.user.userId;
  const session = await createSession(userId, { title: topic, type: 'meeting' });
  await db.run(`UPDATE sessions SET scenario_id = $1 WHERE id = $2`, [JSON.stringify(villagers), session.id]);
  res.json({ sessionId: session.id });
});

// 发送会议消息
router.post('/chat', async (req, res) => {
  const { sessionId, message, villagerId } = req.body;
  const userId = req.user.userId;
  const session = await getSession(userId, sessionId);
  if (!session || session.type !== 'meeting') return res.status(404).json({ error: '会议不存在' });
  let villagers = [];
  if (session.scenarioId) {
    try { villagers = JSON.parse(session.scenarioId); } catch(e) {}
  }
  const villager = villagers.find(v => v.id === villagerId) || villagers[0];
  if (!villager) return res.status(400).json({ error: '参会者不存在' });
  await addMessage(sessionId, 'user', message, Date.now());
  const prompt = `你正在模拟${session.title}会议。当前发言者是：${villager.name}，性格：${villager.personality}。请以第一人称用中文回复村官的问题，回复内容要自然口语化，符合身份。问题：${message}`;
  const reply = await chat([{ role: 'user', content: prompt }], { temperature: 0.8, max_tokens: 200 });
  await addMessage(sessionId, 'assistant', reply, Date.now());
  res.json({ reply, villager });
});

module.exports = router;