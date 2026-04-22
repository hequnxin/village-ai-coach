// routes/meeting.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { chat } = require('../services/openai');
const { addMessage, createSession, getSession } = require('../services/sessionService');
const db = require('../services/db');

const router = express.Router();

// ==================== 创建会议会话 ====================
router.post('/session', async (req, res) => {
  const { topic, villagers, agenda, timeLimit } = req.body;
  const userId = req.user.userId;

  const session = await createSession(userId, { title: topic, type: 'meeting' });

  const config = {
    villagers: villagers || [],
    agenda: agenda || [{ name: '开场', completed: false }, { name: '讨论', completed: false }, { name: '总结', completed: false }],
    timeLimit: timeLimit || null,
    startTime: Date.now(),
    votes: {},
    resolvedItems: [],
    satisfaction: 50,
    emotions: {},
    currentAgendaIndex: 0,
    meetingType: req.body.meetingType || 'villager' // 新增：存储会议类型
  };

  await db.run(`UPDATE sessions SET scenario_id = $1 WHERE id = $2`, [JSON.stringify(config), session.id]);

  const initialMsg = `🏛️ 会议开始！主题：${topic}\n议程：${config.agenda.map((a, i) => `${i+1}. ${a.name}`).join('；')}\n参会人员：${villagers.map(v => v.name).join('、')}\n请主持会议。`;
  await addMessage(session.id, 'system', initialMsg, Date.now());

  res.json({ sessionId: session.id, config });
});

// ==================== 获取会议状态 ====================
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
    currentAgendaIndex: config.currentAgendaIndex || 0,
    meetingStatus: config.meetingStatus || 'active'
  });
});

// ==================== 发送会议消息（核心） ====================
router.post('/chat', async (req, res) => {
  const { sessionId, message, villagerId, action, option, isSystem, autoSpeak } = req.body;
  const userId = req.user.userId;

  const session = await getSession(userId, sessionId);
  if (!session || session.type !== 'meeting') return res.status(404).json({ error: '会议不存在' });

  let config = {};
  if (session.scenarioId) {
    try { config = JSON.parse(session.scenarioId); } catch(e) { config = { villagers: [], agenda: [], satisfaction: 50, currentAgendaIndex: 0, meetingType: 'villager' }; }
  }

  const villagers = config.villagers || [];
  let agenda = config.agenda || [];
  let satisfaction = config.satisfaction || 50;
  let emotions = config.emotions || {};
  let votes = config.votes || {};
  let resolvedItems = config.resolvedItems || [];
  let currentAgendaIndex = config.currentAgendaIndex || 0;
  const meetingType = config.meetingType || 'villager'; // 获取会议类型

  // ===== 系统消息（直接保存，不调用AI） =====
  if (isSystem) {
    await addMessage(sessionId, 'system', message, Date.now());
    return res.json({ reply: null, system: true });
  }

  // ===== 自动发言（简短，用于轮流发言） =====
  if (autoSpeak) {
    const villager = villagers.find(v => v.id === villagerId);
    if (!villager) return res.status(400).json({ error: '村民不存在' });

    // 根据会议类型添加角色提示
    let roleHint = '';
    if (meetingType === 'cadre') {
      roleHint = '你是一名村干部，要以村干部的身份和立场发言，考虑村集体利益和上级政策要求，发言要体现责任感和决策意识。';
    } else {
      roleHint = '你是一名普通村民，要从村民个人利益和感受出发，表达真实想法。';
    }

    const prompt = `你正在模拟${meetingType === 'cadre' ? '村干部' : '村民'}"${villager.name}"。${roleHint}性格：${villager.personality}，立场：${villager.initialStance}，核心诉求：${villager.coreDemand || '无'}。请用1-2句话针对下面的话发表看法：${message}`;
    const reply = await chat([{ role: 'user', content: prompt }], { temperature: 0.7, max_tokens: 100 });
    await addMessage(sessionId, 'assistant', reply, Date.now());
    return res.json({ reply });
  }

  // ===== 投票动作 =====
  if (action === 'vote') {
    if (!option) return res.status(400).json({ error: '缺少投票选项' });
    const currentAgenda = agenda[currentAgendaIndex];
    if (!currentAgenda || currentAgenda.completed) return res.status(400).json({ error: '无进行中的议题' });

    if (!votes[currentAgendaIndex]) votes[currentAgendaIndex] = {};
    if (votes[currentAgendaIndex][villagerId]) {
      return res.status(400).json({ error: '该村民已投票' });
    }
    votes[currentAgendaIndex][villagerId] = option;

    const totalVillagers = villagers.length;
    const votedCount = Object.keys(votes[currentAgendaIndex] || {}).length;

    // 如果所有人都已投票，自动统计结果
    if (votedCount === totalVillagers) {
      const support = Object.values(votes[currentAgendaIndex]).filter(v => v === '支持').length;
      const oppose = Object.values(votes[currentAgendaIndex]).filter(v => v === '反对').length;
      const passed = support / totalVillagers >= 0.6;
      const resultMsg = passed ? `✅ 投票通过！支持率 ${support}/${totalVillagers}` : `❌ 投票未通过。支持率 ${support}/${totalVillagers}`;
      await addMessage(sessionId, 'system', resultMsg, Date.now());

      if (passed) {
        agenda[currentAgendaIndex].completed = true;
        satisfaction = Math.min(100, satisfaction + 10);
        if (currentAgendaIndex + 1 < agenda.length) {
          currentAgendaIndex++;
          await addMessage(sessionId, 'system', `📌 进入下一议程：${agenda[currentAgendaIndex].name}`, Date.now());
        } else {
          await addMessage(sessionId, 'system', `🎉 所有议程已完成！会议即将结束。`, Date.now());
          config.meetingStatus = 'finished';
        }
      } else {
        satisfaction = Math.max(0, satisfaction - 5);
        await addMessage(sessionId, 'system', `💬 投票未通过，请继续讨论修改方案，然后再次投票。`, Date.now());
      }
    }

    const newConfig = { ...config, agenda, satisfaction, votes, currentAgendaIndex };
    await db.run(`UPDATE sessions SET scenario_id = $1 WHERE id = $2`, [JSON.stringify(newConfig), sessionId]);
    return res.json({ success: true, satisfaction, agendaCompleted: agenda[currentAgendaIndex]?.completed || false, votes: votes[currentAgendaIndex] || {} });
  }

  // ===== 手动推进议程 =====
  if (action === 'nextAgenda') {
    if (currentAgendaIndex + 1 < agenda.length) {
      if (!agenda[currentAgendaIndex].completed) {
        return res.status(400).json({ error: '当前议程未完成，无法进入下一议程' });
      }
      currentAgendaIndex++;
      await addMessage(sessionId, 'system', `📌 主持人手动推进到下一议程：${agenda[currentAgendaIndex].name}`, Date.now());
    } else {
      return res.json({ success: false, message: '已是最后一个议程' });
    }
    const newConfig = { ...config, currentAgendaIndex };
    await db.run(`UPDATE sessions SET scenario_id = $1 WHERE id = $2`, [JSON.stringify(newConfig), sessionId]);
    return res.json({ success: true, currentAgendaIndex });
  }

  // ===== 普通发言（用户消息） =====
  if (!message) return res.status(400).json({ error: '消息内容不能为空' });

  const activeVillager = villagers.find(v => v.id === villagerId) || (villagers.length ? villagers[0] : null);
  if (!activeVillager) return res.status(400).json({ error: '无效的发言者' });

  await addMessage(sessionId, 'user', message, Date.now());

  // 获取最近几条消息用于讨论上下文
  const updatedSession = await getSession(userId, sessionId);
  const recentMessages = updatedSession.messages.slice(-5);
  const lastVillagerReply = recentMessages.filter(m => m.role === 'assistant' && m.content !== config.initial_message).pop();

  let discussionHint = '';
  if (lastVillagerReply) {
    const lastSpeaker = villagers.find(v => lastVillagerReply.content.includes(v.name))?.name || '某位村民';
    discussionHint = `\n刚刚 ${lastSpeaker} 发表了观点："${lastVillagerReply.content.substring(0, 100)}"。请你针对他/她的发言表达你的看法（例如：我同意/不同意，因为...）。你的性格是：${activeVillager.personality || '普通'}，请充分体现这一性格，避免使用与其他村民相同的句式。`;
  }

  // 根据会议类型添加角色提示
  let roleHint = '';
  if (meetingType === 'cadre') {
    roleHint = '你是一名村干部，要以村干部的身份和立场发言，考虑村集体利益和上级政策要求，发言要体现责任感和决策意识。';
  } else {
    roleHint = '你是一名普通村民，要从村民个人利益和感受出发，表达真实想法。';
  }

  const prompt = `你正在模拟一场${meetingType === 'cadre' ? '村干部会议' : '村民大会'}。会议主题：${session.title}。当前议程：${agenda.map((a, i) => `${a.name}${a.completed ? '✅' : (i === currentAgendaIndex ? '⏳' : '')}`).join(' → ')}。

当前会议满意度：${satisfaction}（0-100）。

请扮演${meetingType === 'cadre' ? '村干部' : '村民'}"${activeVillager.name}"。${roleHint}性格：${activeVillager.personality || '普通'}。针对村官的话"${message}"做出自然回应。${discussionHint}

同时分析村官的表现，返回JSON格式：
{
  "reply": "你的回复内容",
  "satisfactionDelta": 整数(-20到20),
  "satisfactionReason": "满意度变化的原因（简短）",
  "emotion": "happy/sad/angry/neutral",
  "agendaProgress": 0或1（是否推进当前议程）
}`;

  try {
    const response = await chat([{ role: 'user', content: prompt }], { temperature: 0.8, max_tokens: 350 });
    let parsed;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch(e) {}

    if (!parsed) parsed = { reply: response, satisfactionDelta: 0, satisfactionReason: '', emotion: 'neutral', agendaProgress: 0 };

    const reply = parsed.reply;
    const delta = parsed.satisfactionDelta || 0;
    const reason = parsed.satisfactionReason || '';
    let newSatisfaction = satisfaction + delta;
    newSatisfaction = Math.min(100, Math.max(0, newSatisfaction));

    emotions[activeVillager.id] = parsed.emotion || 'neutral';

    let agendaUpdated = false;
    if (parsed.agendaProgress === 1 && agenda.length && !agenda[currentAgendaIndex].completed) {
      agenda[currentAgendaIndex].completed = true;
      agendaUpdated = true;
      await addMessage(sessionId, 'system', `📌 议程"${agenda[currentAgendaIndex].name}"已完成。`, Date.now());
      if (currentAgendaIndex + 1 < agenda.length) {
        currentAgendaIndex++;
        await addMessage(sessionId, 'system', `📌 进入下一议程：${agenda[currentAgendaIndex].name}`, Date.now());
      } else {
        await addMessage(sessionId, 'system', `🎉 所有议程已完成！会议即将结束。`, Date.now());
        config.meetingStatus = 'finished';
      }
    }

    const newConfig = { ...config, agenda, satisfaction: newSatisfaction, emotions, currentAgendaIndex };
    await db.run(`UPDATE sessions SET scenario_id = $1 WHERE id = $2`, [JSON.stringify(newConfig), sessionId]);
    await addMessage(sessionId, 'assistant', reply, Date.now());

    res.json({
      reply,
      villager: activeVillager,
      satisfaction: newSatisfaction,
      satisfactionReason: reason,
      emotion: parsed.emotion,
      agendaProgress: agendaUpdated,
      timeRemaining: config.timeLimit ? Math.max(0, config.timeLimit - Math.floor((Date.now() - config.startTime) / 1000)) : null
    });
  } catch (err) {
    console.error('会议消息失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ==================== 投票专用接口 ====================
router.post('/vote', async (req, res) => {
  const { sessionId, villagerId, option } = req.body;
  const userId = req.user.userId;
  const session = await getSession(userId, sessionId);
  if (!session || session.type !== 'meeting') return res.status(404).json({ error: '会议不存在' });

  let config = {};
  if (session.scenarioId) {
    try { config = JSON.parse(session.scenarioId); } catch(e) {}
  }
  const currentAgendaIndex = config.currentAgendaIndex || 0;
  if (!config.votes) config.votes = {};
  if (!config.votes[currentAgendaIndex]) config.votes[currentAgendaIndex] = {};
  if (config.votes[currentAgendaIndex][villagerId]) {
    return res.status(400).json({ error: '该村民已投票' });
  }
  config.votes[currentAgendaIndex][villagerId] = option;

  // 检查是否所有村民都已投票
  const villagers = config.villagers || [];
  const total = villagers.length;
  const votedCount = Object.keys(config.votes[currentAgendaIndex]).length;
  let passed = false;
  if (votedCount === total) {
    const support = Object.values(config.votes[currentAgendaIndex]).filter(v => v === '支持').length;
    passed = support / total >= 0.6;
    const resultMsg = passed ? `✅ 投票通过！支持率 ${support}/${total}` : `❌ 投票未通过。支持率 ${support}/${total}`;
    await addMessage(sessionId, 'system', resultMsg, Date.now());
    if (passed) {
      config.agenda[currentAgendaIndex].completed = true;
      config.satisfaction = Math.min(100, (config.satisfaction || 50) + 10);
      if (currentAgendaIndex + 1 < config.agenda.length) {
        config.currentAgendaIndex = currentAgendaIndex + 1;
        await addMessage(sessionId, 'system', `📌 进入下一议程：${config.agenda[config.currentAgendaIndex].name}`, Date.now());
      } else {
        config.meetingStatus = 'finished';
        await addMessage(sessionId, 'system', `🎉 所有议程已完成！会议即将结束。`, Date.now());
      }
    } else {
      config.satisfaction = Math.max(0, (config.satisfaction || 50) - 5);
      await addMessage(sessionId, 'system', `💬 投票未通过，请继续讨论修改方案，然后再次投票。`, Date.now());
    }
  }

  await db.run(`UPDATE sessions SET scenario_id = $1 WHERE id = $2`, [JSON.stringify(config), sessionId]);
  res.json({ success: true, passed: passed && votedCount === total });
});

// ==================== 结束会议并生成纪要 ====================
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

  const dialogue = session.messages.map(m => `${m.role === 'user' ? '村官' : (m.role === 'assistant' ? '村民' : '系统')}: ${m.content}`).join('\n');
  const completedAgenda = agenda.filter(a => a.completed).length;
  const agendaScore = (completedAgenda / agenda.length) * 50;
  const satisfactionScore = satisfaction * 0.5;
  const totalScore = Math.min(100, Math.floor(agendaScore + satisfactionScore));

  const summaryPrompt = `你是一名乡村会议记录员。请根据以下会议对话，生成一份结构化的会议纪要，包含：

- 会议主题
- 议程完成情况
- 决议事项（通过的议题）
- 争议点
- 待办事项
- 总体评价（满意度：${satisfaction}/100，议程完成率：${completedAgenda}/${agenda.length}）
- 改进建议（针对村官的主持表现）

对话内容：
${dialogue}

输出格式（纯JSON）：
{
  "minutes": "会议纪要文本",
  "resolutions": ["决议1", "决议2"],
  "disputes": ["争议点1"],
  "actionItems": ["待办1"],
  "overallScore": ${totalScore},
  "suggestions": "改进建议"
}`;

  try {
    const resultText = await chat([{ role: 'user', content: summaryPrompt }], { temperature: 0.3, max_tokens: 800 });
    let summary;
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (jsonMatch) summary = JSON.parse(jsonMatch[0]);
    else summary = { minutes: resultText, resolutions: [], disputes: [], actionItems: [], overallScore: totalScore, suggestions: '' };

    await addMessage(sessionId, 'system', `meeting_minutes:${JSON.stringify(summary)}`, Date.now());
    res.json({ summary, finalScore: totalScore, completedAgenda, totalAgenda: agenda.length, satisfaction });
  } catch (err) {
    console.error('生成会议纪要失败:', err);
    res.status(500).json({ error: '生成会议纪要失败' });
  }
});

module.exports = router;