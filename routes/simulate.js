// routes/simulate.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { chat } = require('../services/openai');
const { getSession, addMessage, updateSession, createSession } = require('../services/sessionService');
const db = require('../services/db');

const router = express.Router();

// 内存存储村民记忆（生产环境应使用数据库）
const villagerMemory = new Map();

// 辅助：提取用户发言中的承诺/关键事实
function extractKeyFacts(text) {
  const promises = text.match(/[^。]*?(?:保证|承诺|会|一定|尽快|解决|处理)[^。]*。/g);
  return promises || [];
}

// 获取场景列表
router.get('/scenarios', async (req, res) => {
  const scenarios = await db.all('SELECT * FROM scenarios ORDER BY created_at');
  scenarios.forEach(s => {
    if (s.eval_dimensions) s.evalDimensions = JSON.parse(s.eval_dimensions);
    else s.evalDimensions = [];
    delete s.eval_dimensions;
  });
  res.json(scenarios);
});

// 创建模拟会话
router.post('/session', async (req, res) => {
  const { scenarioId, difficulty = 'medium', timeLimit = null } = req.body;
  const userId = req.user.userId;
  const scenario = await db.get('SELECT * FROM scenarios WHERE id = $1', [scenarioId]);
  if (!scenario) return res.status(404).json({ error: '场景不存在' });
  if (scenario.eval_dimensions) scenario.evalDimensions = JSON.parse(scenario.eval_dimensions);
  else scenario.evalDimensions = [];
  let stages = [];
  if (scenario.stages) stages = JSON.parse(scenario.stages);
  else stages = [
    { name: '安抚情绪', description: '让村民情绪稳定下来', completed: false },
    { name: '讲清政策', description: '解释相关政策和法规', completed: false },
    { name: '达成共识', description: '双方达成初步协议', completed: false }
  ];
  const session = await createSession(userId, { title: scenario.title, type: 'simulate', scenarioId, difficulty });
  await db.run(`UPDATE sessions SET scenario_id = $1 WHERE id = $2`, [
    JSON.stringify({ scenarioId, stages, timeLimit, startTime: Date.now() }),
    session.id
  ]);
  await addMessage(session.id, 'assistant', scenario.initial_message, Date.now());
  res.json({ sessionId: session.id, initialMessage: scenario.initial_message });
});

// 智能提示分析接口
router.post('/analyze-input', async (req, res) => {
  const { text, scenarioId } = req.body;
  if (!text) return res.json({ tips: [] });
  const scenario = await db.get(`SELECT goal, role FROM scenarios WHERE id = $1`, [scenarioId]);
  if (!scenario) return res.json({ tips: [] });
  // 关键词库（可从知识库动态提取，简化版）
  const policyKeywords = ['土地管理法', '宅基地', '流转', '承包', '医保', '低保', '垃圾分类', '人居环境', '乡村振兴'];
  const found = policyKeywords.filter(kw => text.includes(kw));
  const missing = policyKeywords.filter(kw => !text.includes(kw));
  const tips = [];
  if (missing.length > 0) {
    tips.push(`💡 建议提及：${missing.slice(0, 3).join('、')} 等相关政策。`);
  }
  if (text.includes('？') && text.length < 10) {
    tips.push('💬 语气建议：多使用陈述句表达解决方案，避免仅反问。');
  }
  if (text.includes('不行') || text.includes('不能')) {
    tips.push('🤝 建议先共情，再解释原因。');
  }
  if (text.length > 200) {
    tips.push('📝 发言尽量简洁，分点陈述。');
  }
  res.json({ tips });
});

// 随机事件处理接口
router.post('/event/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const { satisfactionDelta, stageRollback } = req.body;
  const userId = req.user.userId;
  const session = await getSession(userId, sessionId);
  if (!session) return res.status(404).json({ error: '会话不存在' });
  let extra = {};
  if (session.scenarioId) { try { extra = JSON.parse(session.scenarioId); } catch(e) {} }
  let newSatisfaction = (extra.satisfaction || 50) + (satisfactionDelta || 0);
  newSatisfaction = Math.min(100, Math.max(0, newSatisfaction));
  extra.satisfaction = newSatisfaction;
  if (stageRollback && extra.stages) {
    const lastCompleted = [...extra.stages].reverse().find(s => s.completed);
    if (lastCompleted) lastCompleted.completed = false;
  }
  await db.run(`UPDATE sessions SET scenario_id = $1 WHERE id = $2`, [JSON.stringify(extra), sessionId]);
  res.json({ success: true });
});

// 模拟对话（支持单人/多人、难度、记忆、讨论）
router.post('/chat', async (req, res) => {
  const { sessionId, message, villager } = req.body;
  const userId = req.user.userId;
  const session = await getSession(userId, sessionId);
  if (!session || session.type !== 'simulate') return res.status(404).json({ error: '对练会话不存在' });

  let extra = { stages: [], timeLimit: null, startTime: Date.now() };
  if (session.scenarioId) {
    try { extra = JSON.parse(session.scenarioId); } catch(e) { extra = { scenarioId: session.scenarioId, stages: [], timeLimit: null }; }
  }
  const scenarioId = extra.scenarioId || session.scenarioId;
  const stages = extra.stages || [];
  const timeLimit = extra.timeLimit;
  const startTime = extra.startTime || Date.now();
  if (timeLimit && (Date.now() - startTime) > timeLimit * 1000) {
    return res.json({ reply: '⏰ 时间到！本次模拟结束。', timeExpired: true });
  }
  const scenario = await db.get('SELECT * FROM scenarios WHERE id = $1', [scenarioId]);
  if (!scenario) return res.status(500).json({ error: '场景数据丢失' });

  await addMessage(sessionId, 'user', message, Date.now());

  // 处理村民记忆（如果是多人模式）
  if (villager) {
    const newFacts = extractKeyFacts(message);
    const memoryKey = `${sessionId}_${villager.name}`;
    const memories = villagerMemory.get(memoryKey) || [];
    memories.push(...newFacts);
    villagerMemory.set(memoryKey, memories.slice(-5));
  }

  const updatedSession = await getSession(userId, sessionId);
  const dialogueHistory = updatedSession.messages.filter(m => m.role !== 'system').map(m => {
    const roleName = m.role === 'user' ? '村官' : (villager ? villager.name : scenario.role);
    return `${roleName}: ${m.content}`;
  }).join('\n');

  let roleName = scenario.role;
  let personality = '';
  let satisfaction = 50;
  let currentEmotion = 'neutral';
  const difficulty = session.difficulty || 'medium';

  if (villager) {
    roleName = villager.name;
    personality = villager.personality || '性格普通';
    const villagersState = extra.villagersState || {};
    const state = villagersState[roleName] || { satisfaction: 50, emotion: 'neutral' };
    satisfaction = state.satisfaction;
    currentEmotion = state.emotion;
  } else {
    satisfaction = extra.satisfaction || 50;
    currentEmotion = extra.emotion || 'neutral';
    switch (difficulty) {
      case 'easy': personality = '你的性格温和、有耐心，即使面对质疑也愿意耐心解释。你说话客气，容易沟通。'; break;
      case 'medium': personality = '你的性格普通，有时会表现出一些固执和不耐烦，但整体还能理性沟通。'; break;
      case 'hard': personality = '你的性格急躁、说话难听，容易发火，对村干部的提议非常抵触，喜欢用反问和指责的语气。你会故意刁难对方，说话夹枪带棒。'; break;
      default: personality = '你的性格普通，有时会表现出一些固执和不耐烦。';
    }
  }

  // 构建记忆提示
  let memoryHint = '';
  if (villager) {
    const memoryKey = `${sessionId}_${villager.name}`;
    const memories = villagerMemory.get(memoryKey) || [];
    if (memories.length > 0) {
      memoryHint = `\n该村民记得你之前说过：${memories.join('；')}。如果合适，可以在对话中提及这些承诺的履行情况。`;
    }
  }

  // 构建讨论提示（多人模式下，如果有其他村民刚刚发言）
  let discussionHint = '';
  if (villager && updatedSession.messages.length >= 2) {
    const lastAssistantMsg = [...updatedSession.messages].reverse().find(m => m.role === 'assistant' && m.content !== scenario.initial_message);
    if (lastAssistantMsg) {
      discussionHint = `\n刚刚其他村民或村官发表了观点，请你针对他/她的发言表达你的看法（可以同意、反对、补充或质疑），要体现你的性格特点。`;
    }
  }

  const strategyTipInstruction = `请分析用户刚才的发言，判断其使用的策略（安抚、强硬、讲道理、回避等），并给出一个简短的实时提示（不超过20字）帮助用户改进。同时判断对话是否推动了阶段目标。返回JSON格式：{"reply":"你的回复","satisfactionDelta":整数(-20到20),"emotion":"happy/sad/angry/neutral","stageProgress":0或1,"strategyTip":"提示内容"}`;

  const prompt = `你正在模拟一场乡村工作场景。你的角色是：${roleName}。当前对话目标：${scenario.goal}。
${personality}
当前村民满意度：${satisfaction}（0-100），情绪：${currentEmotion}。
请根据以下对话历史，以角色的身份自然回应。注意语气要符合角色设定。
${memoryHint}
${discussionHint}
${strategyTipInstruction}

对话历史：
${dialogueHistory}

${roleName}：`;

  try {
    const response = await chat([{ role: 'user', content: prompt }], { temperature: 0.8, max_tokens: 350 });
    let parsed;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch(e) {}
    if (!parsed) parsed = { reply: response, satisfactionDelta: 0, emotion: 'neutral', stageProgress: 0, strategyTip: '' };

    const reply = parsed.reply;
    const satisfactionDelta = parsed.satisfactionDelta || 0;
    const newEmotion = parsed.emotion || 'neutral';
    const stageProgress = parsed.stageProgress || 0;
    const strategyTip = parsed.strategyTip || '';
    let newSatisfaction = satisfaction + satisfactionDelta;
    newSatisfaction = Math.min(100, Math.max(0, newSatisfaction));

    let updatedStages = [...stages];
    if (stageProgress === 1 && updatedStages.length > 0) {
      const firstIncomplete = updatedStages.find(s => !s.completed);
      if (firstIncomplete) firstIncomplete.completed = true;
    }

    let newExtra = { ...extra };
    if (villager) {
      newExtra.villagersState = newExtra.villagersState || {};
      newExtra.villagersState[roleName] = { satisfaction: newSatisfaction, emotion: newEmotion };
    } else {
      newExtra.satisfaction = newSatisfaction;
      newExtra.emotion = newEmotion;
    }
    newExtra.stages = updatedStages;
    await db.run(`UPDATE sessions SET scenario_id = $1 WHERE id = $2`, [JSON.stringify(newExtra), sessionId]);
    const msgId = (await addMessage(sessionId, 'assistant', reply, Date.now())).messageId;
    res.json({
      reply,
      messageId: msgId,
      satisfaction: newSatisfaction,
      emotion: newEmotion,
      stageProgress: updatedStages,
      strategyTip,
      timeRemaining: timeLimit ? Math.max(0, timeLimit - Math.floor((Date.now() - startTime) / 1000)) : null
    });
  } catch (err) {
    console.error('对练消息失败:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 结束对练并生成报告
router.post('/finish', async (req, res) => {
  const { sessionId } = req.body;
  const userId = req.user.userId;
  const session = await getSession(userId, sessionId);
  if (!session || session.type !== 'simulate') return res.status(404).json({ error: '对练会话不存在' });

  let extra = { scenarioId: session.scenarioId, stages: [], satisfaction: 50 };
  if (session.scenarioId) { try { extra = JSON.parse(session.scenarioId); } catch(e) {} }
  const scenarioId = extra.scenarioId || session.scenarioId;
  const stages = extra.stages || [];
  const finalSatisfaction = extra.satisfaction || 50;
  const scenario = await db.get('SELECT * FROM scenarios WHERE id = $1', [scenarioId]);
  if (!scenario) return res.status(500).json({ error: '场景数据丢失' });

  let evalDimensions = [];
  if (scenario.eval_dimensions) { try { evalDimensions = JSON.parse(scenario.eval_dimensions); } catch(e) {} }
  const dialogue = session.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp }));
  const reportPrompt = `你是一名乡村治理培训师。请根据以下村官与${scenario.role}的模拟对话，生成一份详细评估报告。
评估维度：${evalDimensions.join('、')}。
要求：
1. 对每个维度打分（1-5分），并给出具体改进建议。
2. 从对话中摘录村官的2-3句典型发言，分别标注"优点"或"需改进"。
3. 提供2-3条该场景下的优秀话术参考。
4. 总结用户在本模拟中的关键失误点，并归类（如"情绪控制不足""政策解释不清"），这些将存入错题本。
对话内容（JSON格式）：${JSON.stringify(dialogue)}
输出格式（纯JSON，不要有其他文字）：
{"scores": {"沟通技巧": 4, ...}, "suggestions": "整体建议...", "examples": [{"quote": "用户原话", "verdict": "优点/需改进", "comment": "具体点评"}], "bestPractices": ["优秀话术1", "优秀话术2"], "mistakes": ["失误点1", "失误点2"]}`;
  try {
    const resultText = await chat([{ role: 'user', content: reportPrompt }], { temperature: 0.3, max_tokens: 1200 });
    let report;
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (jsonMatch) report = JSON.parse(jsonMatch[0]);
    else report = { scores: {}, suggestions: resultText, examples: [], bestPractices: [], mistakes: [] };
    await addMessage(sessionId, 'system', `report:${JSON.stringify(report)}`, Date.now());
    for (let mistake of (report.mistakes || [])) {
      await db.run(`INSERT INTO simulate_mistakes (id, user_id, mistake_text, scenario_id, created_at) VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), userId, mistake, scenarioId, new Date().toISOString()]);
    }
    let totalScore = 0;
    const dims = Object.values(report.scores);
    if (dims.length) totalScore = dims.reduce((a,b)=>a+b,0) / dims.length;
    const satisfactionBonus = Math.floor(finalSatisfaction / 10);
    const finalScore = Math.min(5, totalScore + satisfactionBonus/10);
    res.json({ report, finalScore, satisfaction: finalSatisfaction, stagesCompleted: stages.filter(s => s.completed).length, totalStages: stages.length });
  } catch (err) {
    console.error('生成报告失败:', err);
    res.status(500).json({ error: '生成报告失败' });
  }
});

// 获取模拟会话状态
router.get('/status/:sessionId', async (req, res) => {
  const userId = req.user.userId;
  const session = await getSession(userId, req.params.sessionId);
  if (!session || session.type !== 'simulate') return res.status(404).json({ error: '会话不存在' });
  let extra = {};
  if (session.scenarioId) { try { extra = JSON.parse(session.scenarioId); } catch(e) {} }
  res.json({
    satisfaction: extra.satisfaction || 50,
    emotion: extra.emotion || 'neutral',
    stages: extra.stages || [],
    timeRemaining: extra.timeLimit ? Math.max(0, extra.timeLimit - Math.floor((Date.now() - (extra.startTime||Date.now())) / 1000)) : null,
    villagersState: extra.villagersState || {}
  });
});

module.exports = router;