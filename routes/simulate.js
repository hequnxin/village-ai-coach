const express = require('express');
const { chat } = require('../services/openai');
const { getSession, addMessage, updateSession, createSession } = require('../services/sessionService');
const db = require('../services/db');

const router = express.Router();

router.get('/scenarios', (req, res) => {
  const scenarios = db.prepare('SELECT * FROM scenarios ORDER BY created_at').all();
  scenarios.forEach(s => {
    // 解析 eval_dimensions JSON 字符串
    if (s.eval_dimensions) {
      s.evalDimensions = JSON.parse(s.eval_dimensions);
    } else {
      s.evalDimensions = [];
    }
    delete s.eval_dimensions; // 删除原始字段，保持输出一致
  });
  res.json(scenarios);
});

router.post('/session', (req, res) => {
  const { scenarioId } = req.body;
  const userId = req.user.userId;

  const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId);
  if (!scenario) return res.status(404).json({ error: '场景不存在' });

  // 解析场景的维度（供后续评估使用）
  if (scenario.eval_dimensions) {
    scenario.evalDimensions = JSON.parse(scenario.eval_dimensions);
  } else {
    scenario.evalDimensions = [];
  }

  const session = createSession(userId, { title: scenario.title, type: 'simulate', scenarioId });
  addMessage(session.id, 'assistant', scenario.initial_message, Date.now());

  res.json({ sessionId: session.id, initialMessage: scenario.initial_message });
});

router.post('/chat', async (req, res) => {
  const { sessionId, message } = req.body;
  const userId = req.user.userId;

  const session = getSession(userId, sessionId);
  if (!session || session.type !== 'simulate') {
    return res.status(404).json({ error: '对练会话不存在' });
  }

  const scenarioId = session.scenarioId;
  if (!scenarioId) return res.status(500).json({ error: '场景数据丢失' });

  const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId);
  if (!scenario) return res.status(500).json({ error: '场景数据丢失' });

  addMessage(sessionId, 'user', message, Date.now());

  // 重新获取会话（包含新消息）
  const updatedSession = getSession(userId, sessionId);
  const dialogueHistory = updatedSession.messages.filter(m => m.role !== 'system').map(m =>
    `${m.role === 'user' ? '村官' : scenario.role}: ${m.content}`
  ).join('\n');

  const prompt = `你正在模拟乡村工作场景。你的角色是：${scenario.role}。当前对话目标：${scenario.goal}。请根据以下对话历史，以角色的身份自然回应。注意语气要符合角色设定，可以适当推进对话。\n\n${dialogueHistory}\n${scenario.role}：`;

  try {
    const reply = await chat([{ role: 'user', content: prompt }], { temperature: 0.7, max_tokens: 200 });
    const msgId = addMessage(sessionId, 'assistant', reply, Date.now()).messageId;
    res.json({ reply, messageId: msgId });
  } catch (err) {
    console.error('对练消息失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/finish', async (req, res) => {
  const { sessionId } = req.body;
  const userId = req.user.userId;

  const session = getSession(userId, sessionId);
  if (!session || session.type !== 'simulate') return res.status(404).json({ error: '对练会话不存在' });

  const scenarioId = session.scenarioId;
  if (!scenarioId) return res.status(500).json({ error: '场景数据丢失' });

  const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId);
  if (!scenario) return res.status(500).json({ error: '场景数据丢失' });

  // 解析评估维度（若未解析则先解析）
  let evalDimensions = [];
  if (scenario.eval_dimensions) {
    try {
      evalDimensions = JSON.parse(scenario.eval_dimensions);
    } catch (e) {
      evalDimensions = [];
    }
  }

  // 过滤掉系统消息
  const dialogue = session.messages.filter(m => m.role !== 'system').map(m =>
    `${m.role === 'user' ? '村官' : scenario.role}: ${m.content}`
  ).join('\n');

  const evalPrompt = `你是一名乡村治理培训师，请根据以下村官与${scenario.role}的模拟对话，从多个维度评估村官的表现。维度包括：${evalDimensions.join('、')}。请为每个维度打分（1-5分，5分为最佳），并给出具体的改进建议。最后以JSON格式输出，格式如下：
{
  "scores": { "沟通技巧": 4, "政策熟悉度": 3, ... },
  "suggestions": "整体表现...建议..."
}

对话内容：
${dialogue}`;

  try {
    const resultText = await chat([{ role: 'user', content: evalPrompt }], { temperature: 0.3, max_tokens: 800 });
    let report;
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      report = JSON.parse(jsonMatch[0]);
    } else {
      report = { scores: {}, suggestions: resultText };
    }
    // 将报告存储为系统消息
    addMessage(sessionId, 'system', `report:${JSON.stringify(report)}`, Date.now());
    res.json(report);
  } catch (err) {
    console.error('生成报告失败:', err);
    res.status(500).json({ error: '生成报告失败' });
  }
});

module.exports = router;