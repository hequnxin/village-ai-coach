const express = require('express');
const { chat } = require('../services/openai');
const { addMessage, createSession, getSession } = require('../services/sessionService');
const db = require('../services/db');
const router = express.Router();

// 创建会议会话（支持议程、参与者、时间限制）
router.post('/session', async (req, res) => {
  const { topic, villagers, agenda, timeLimit } = req.body;
  const userId = req.user.userId;
  const session = await createSession(userId, { title: topic, type: 'meeting' });
  // 存储会议配置到 scenario_id 字段
  const config = {
    villagers: villagers || [],
    agenda: agenda || [{ name: '开场', completed: false }, { name: '讨论', completed: false }, { name: '总结', completed: false }],
    timeLimit: timeLimit || null,
    startTime: Date.now(),
    votes: {}, // 存储每个议题的投票结果
    resolvedItems: [],
    satisfaction: 50,
    emotions: {}
  };
  await db.run(`UPDATE sessions SET scenario_id = $1 WHERE id = $2`, [JSON.stringify(config), session.id]);
  // 发送初始系统消息
  const initialMsg = `🏛️ 会议开始！主题：${topic}\n议程：${config.agenda.map((a, i) => `${i+1}. ${a.name}`).join('；')}\n参会人员：${villagers.map(v => v.name).join('、')}\n请主持会议。`;
  await addMessage(session.id, 'system', initialMsg, Date.now());
  res.json({ sessionId: session.id, config });
});

// 获取会议状态（轮询用）
router.get('/status/:sessionId', async (req, res) => {
  const userId = req.user.userId;
  const session = await getSession(userId, req.params.sessionId);
  if (!session || session.type !== 'meeting') return res.status(404).json({ error: '会议不存在' });
  let config = {};
  if (session.scenarioId) {
    try { config = JSON.parse(session.scenarioId); } catch(e) {}
  }
  res.json({
    agenda: config.agenda || [],
    satisfaction: config.satisfaction || 50,
    emotions: config.emotions || {},
    votes: config.votes || {},
    resolvedItems: config.resolvedItems || [],
    timeRemaining: config.timeLimit ? Math.max(0, config.timeLimit - Math.floor((Date.now() - (config.startTime||Date.now())) / 1000)) : null
  });
});

// 发送会议消息（支持点名、自由发言、举手、投票等）
router.post('/chat', async (req, res) => {
  const { sessionId, message, villagerId, action, voteFor } = req.body;
  const userId = req.user.userId;
  const session = await getSession(userId, sessionId);
  if (!session || session.type !== 'meeting') return res.status(404).json({ error: '会议不存在' });
  let config = {};
  if (session.scenarioId) {
    try { config = JSON.parse(session.scenarioId); } catch(e) { config = { villagers: [], agenda: [], satisfaction: 50 }; }
  }
  const villagers = config.villagers || [];
  const agenda = config.agenda || [];
  let satisfaction = config.satisfaction || 50;
  let emotions = config.emotions || {};
  let votes = config.votes || {};
  let resolvedItems = config.resolvedItems || [];

  // 处理特殊动作
  if (action === 'vote') {
    if (!voteFor) return res.status(400).json({ error: '缺少投票选项' });
    const currentAgenda = agenda.find(a => !a.completed);
    if (!currentAgenda) return res.status(400).json({ error: '无进行中的议题' });
    votes[currentAgenda.name] = votes[currentAgenda.name] || { for: 0, against: 0, abstain: 0 };
    votes[currentAgenda.name][voteFor]++;
    // 简单判断：如果支持票超过半数（按村民数），则通过
    const totalVotes = Object.values(votes[currentAgenda.name]).reduce((a,b)=>a+b,0);
    if (totalVotes >= villagers.length) {
      const passed = votes[currentAgenda.name].for > votes[currentAgenda.name].against;
      const resultMsg = passed ? `✅ 议题“${currentAgenda.name}”通过！` : `❌ 议题“${currentAgenda.name}”未通过。`;
      await addMessage(sessionId, 'system', resultMsg, Date.now());
      currentAgenda.completed = true;
      if (passed) resolvedItems.push(currentAgenda.name);
      // 满意度变化
      satisfaction += passed ? 10 : -5;
      satisfaction = Math.min(100, Math.max(0, satisfaction));
    }
    await db.run(`UPDATE sessions SET scenario_id = $1 WHERE id = $2`, [JSON.stringify({ ...config, agenda, satisfaction, votes }), sessionId]);
    return res.json({ success: true, satisfaction, agendaCompleted: currentAgenda.completed, votes: votes[currentAgenda.name] });
  }

  if (action === 'requestSpeak') {
    // 村民举手请求发言
    const villager = villagers.find(v => v.id === villagerId);
    if (!villager) return res.status(404).json({ error: '村民不存在' });
    // 添加系统消息提示主持人
    await addMessage(sessionId, 'system', `💬 ${villager.name} 请求发言。`, Date.now());
    return res.json({ success: true, message: `${villager.name} 请求发言` });
  }

  // 普通发言
  const activeVillager = villagers.find(v => v.id === villagerId) || (villagers.length ? villagers[0] : null);
  if (!activeVillager) return res.status(400).json({ error: '无效的发言者' });

  await addMessage(sessionId, 'user', message, Date.now());

  // 构建 prompt 让 AI 生成村民回复，并分析满意度变化、情绪、是否推进议程
  const prompt = `你正在模拟一场乡村会议。会议主题：${session.title}。当前议程：${agenda.map(a => `${a.name}${a.completed ? '✅' : '⏳'}`).join(' → ')}。
当前会议满意度：${satisfaction}（0-100）。
请扮演村民“${activeVillager.name}”，性格：${activeVillager.personality || '普通'}。针对村官的话“${message}”做出自然回应。
同时分析村官的表现，返回JSON格式：
{
  "reply": "你的回复内容",
  "satisfactionDelta": 整数(-20到20),
  "emotion": "happy/sad/angry/neutral",
  "agendaProgress": 0或1（是否推进当前议程）
}`;

  try {
    const response = await chat([{ role: 'user', content: prompt }], { temperature: 0.8, max_tokens: 300 });
    let parsed;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch(e) {}
    if (!parsed) {
      parsed = { reply: response, satisfactionDelta: 0, emotion: 'neutral', agendaProgress: 0 };
    }
    const reply = parsed.reply;
    const delta = parsed.satisfactionDelta || 0;
    let newSatisfaction = satisfaction + delta;
    newSatisfaction = Math.min(100, Math.max(0, newSatisfaction));
    emotions[activeVillager.id] = parsed.emotion || 'neutral';

    let agendaUpdated = false;
    if (parsed.agendaProgress === 1 && agenda.length) {
      const current = agenda.find(a => !a.completed);
      if (current) {
        current.completed = true;
        agendaUpdated = true;
        await addMessage(sessionId, 'system', `📌 议程“${current.name}”已完成。`, Date.now());
      }
    }

    // 更新配置
    const newConfig = { ...config, agenda, satisfaction: newSatisfaction, emotions };
    await db.run(`UPDATE sessions SET scenario_id = $1 WHERE id = $2`, [JSON.stringify(newConfig), sessionId]);
    await addMessage(sessionId, 'assistant', reply, Date.now());

    res.json({
      reply,
      villager: activeVillager,
      satisfaction: newSatisfaction,
      emotion: parsed.emotion,
      agendaProgress: agendaUpdated,
      timeRemaining: config.timeLimit ? Math.max(0, config.timeLimit - Math.floor((Date.now() - config.startTime) / 1000)) : null
    });
  } catch (err) {
    console.error('会议消息失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 结束会议并生成会议纪要
router.post('/finish', async (req, res) => {
  const { sessionId } = req.body;
  const userId = req.user.userId;
  const session = await getSession(userId, sessionId);
  if (!session || session.type !== 'meeting') return res.status(404).json({ error: '会议不存在' });
  let config = {};
  if (session.scenarioId) {
    try { config = JSON.parse(session.scenarioId); } catch(e) {}
  }
  const agenda = config.agenda || [];
  const resolvedItems = config.resolvedItems || [];
  const satisfaction = config.satisfaction || 50;
  const votes = config.votes || {};

  // 提取对话记录
  const dialogue = session.messages.map(m => `${m.role === 'user' ? '村官' : (m.role === 'assistant' ? '村民' : '系统')}: ${m.content}`).join('\n');

  const summaryPrompt = `你是一名乡村会议记录员。请根据以下会议对话，生成一份结构化的会议纪要，包含：
- 会议主题
- 议程完成情况
- 决议事项（通过的议题）
- 争议点
- 待办事项
- 总体评价（满意度：${satisfaction}/100）

对话内容：
${dialogue}

输出格式（纯JSON）：
{
  "minutes": "会议纪要文本",
  "resolutions": ["决议1", "决议2"],
  "disputes": ["争议点1"],
  "actionItems": ["待办1"],
  "overallScore": 满意度分数
}`;

  try {
    const resultText = await chat([{ role: 'user', content: summaryPrompt }], { temperature: 0.3, max_tokens: 800 });
    let summary;
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (jsonMatch) summary = JSON.parse(jsonMatch[0]);
    else summary = { minutes: resultText, resolutions: [], disputes: [], actionItems: [], overallScore: satisfaction };
    await addMessage(sessionId, 'system', `meeting_minutes:${JSON.stringify(summary)}`, Date.now());
    // 计算得分（根据满意度、议程完成率、决议数量等）
    const completedAgenda = agenda.filter(a => a.completed).length;
    const agendaScore = (completedAgenda / agenda.length) * 50;
    const finalScore = Math.min(100, Math.floor(satisfaction * 0.5 + agendaScore));
    res.json({ summary, finalScore, completedAgenda, totalAgenda: agenda.length, satisfaction });
  } catch (err) {
    console.error('生成会议纪要失败:', err);
    res.status(500).json({ error: '生成会议纪要失败' });
  }
});

module.exports = router;