const express = require('express');
const { chat } = require('../services/openai');
const { getSession, addMessage, updateSession, createSession } = require('../services/sessionService');
const db = require('../services/db');

const router = express.Router();

router.get('/scenarios', (req, res) => {
  const scenarios = db.prepare('SELECT * FROM scenarios ORDER BY created_at').all();
  scenarios.forEach(s => {
    s.evalDimensions = JSON.parse(s.eval_dimensions);
    delete s.eval_dimensions;
  });
  res.json(scenarios);
});

router.post('/session', (req, res) => {
  const { scenarioId } = req.body;
  const userId = req.user.userId;

  const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId);
  if (!scenario) return res.status(404).json({ error: '场景不存在' });

  const session = createSession(userId, { title: scenario.title, type: 'simulate' });
  // 存储场景ID（需要扩展 sessions 表，这里简化：使用一条系统消息存储场景ID）
  // 实际上应该在 sessions 表增加 scenario_id 列，这里为了代码完整，我们用一个系统消息来保存
  // 但更简单的是：我们直接操作数据库添加 scenario_id。由于表结构已经固定，我们稍后修改 initDb 增加该列。
  // 为简便，我们在这里直接使用一条消息保存场景ID，但查询时需要特殊处理。
  // 此处为了演示，我们假设已添加 scenario_id 列，并更新 session 记录。
  // 为了代码可运行，我们直接使用 addMessage 并记录一个特殊的系统消息。
  addMessage(session.id, 'system', `scenario_id:${scenarioId}`, Date.now());
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

  // 获取场景ID（从系统消息中读取）
  let scenarioId = null;
  for (const msg of session.messages) {
    if (msg.role === 'system' && msg.content.startsWith('scenario_id:')) {
      scenarioId = msg.content.split(':')[1];
      break;
    }
  }
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

  // 获取场景ID
  let scenarioId = null;
  for (const msg of session.messages) {
    if (msg.role === 'system' && msg.content.startsWith('scenario_id:')) {
      scenarioId = msg.content.split(':')[1];
      break;
    }
  }
  if (!scenarioId) return res.status(500).json({ error: '场景数据丢失' });

  const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId);
  if (!scenario) return res.status(500).json({ error: '场景数据丢失' });

  const dialogue = session.messages.filter(m => m.role !== 'system').map(m =>
    `${m.role === 'user' ? '村官' : scenario.role}: ${m.content}`
  ).join('\n');

  const evalPrompt = `你是一名乡村治理培训师，请根据以下村官与${scenario.role}的模拟对话，从多个维度评估村官的表现。维度包括：${scenario.evalDimensions.join('、')}。请为每个维度打分（1-5分，5分为最佳），并给出具体的改进建议。最后以JSON格式输出，格式如下：
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
    // 存储报告（可通过更新会话字段或单独表，这里简化：在会话消息中添加一条系统消息）
    addMessage(sessionId, 'system', `report:${JSON.stringify(report)}`, Date.now());
    res.json(report);
  } catch (err) {
    console.error('生成报告失败:', err);
    res.status(500).json({ error: '生成报告失败' });
  }
});

module.exports = router;