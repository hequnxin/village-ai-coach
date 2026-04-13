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

// 场景多人配置（与前端的 scenarioMultiConfig 保持一致）
const scenarioMultiConfig = {
  'scenario_001': {
    title: '调解邻里土地纠纷',
    description: '村民张三和李四因宅基地边界发生争执，双方情绪激动，需要你作为村干部进行调解。',
    villagers: [
      { id: 'v1', name: '张三', avatar: '👨', personality: '暴躁、固执', coreDemand: '必须让对方退让，否则不罢休', initialStance: '反对', stanceValue: 0.1 },
      { id: 'v2', name: '李四', avatar: '👨', personality: '倔强、爱面子', coreDemand: '寸土不让，要求对方道歉', initialStance: '反对', stanceValue: 0.1 },
      { id: 'v3', name: '王婶', avatar: '👵', personality: '热心、和事佬', coreDemand: '希望双方和解，村里安宁', initialStance: '中立', stanceValue: 0.5 }
    ]
  },
  'scenario_002': {
    title: '推动垃圾分类',
    description: '村里推行垃圾分类，但很多村民不配合，甚至乱扔垃圾。你需要入户宣传，说服村民参与。',
    villagers: [
      { id: 'v1', name: '张大爷', avatar: '👴', personality: '固执、嫌麻烦', coreDemand: '不想多走路倒垃圾', initialStance: '反对', stanceValue: 0.2 },
      { id: 'v2', name: '李大妈', avatar: '👵', personality: '爱干净、支持', coreDemand: '希望村里统一规划', initialStance: '支持', stanceValue: 0.8 },
      { id: 'v3', name: '王叔', avatar: '👨', personality: '理性、观望', coreDemand: '担心费用和公平性', initialStance: '中立', stanceValue: 0.5 }
    ]
  },
  'scenario_003': {
    title: '人居环境整治（乱堆乱放）',
    description: '村民老赵在自家院外长期堆放柴草和废品，影响村容村貌，邻居投诉。你需上门劝导，动员清理。',
    villagers: [
      { id: 'v1', name: '老赵', avatar: '👨', personality: '倔强、爱占便宜', coreDemand: '不想花钱清理，觉得碍不着别人', initialStance: '反对', stanceValue: 0.2 },
      { id: 'v2', name: '刘婶', avatar: '👩', personality: '爱干净、爱管闲事', coreDemand: '要求村里强制清理', initialStance: '支持', stanceValue: 0.9 },
      { id: 'v3', name: '周会计', avatar: '🧑‍💼', personality: '理性、讲道理', coreDemand: '希望有公平的清理方案', initialStance: '中立', stanceValue: 0.5 }
    ]
  },
  'scenario_004': {
    title: '产业发展项目申报动员会',
    description: '村里想申请乡村振兴衔接资金发展特色农产品加工，但部分村民担心失败不愿配合。',
    villagers: [
      { id: 'v1', name: '李大叔', avatar: '👨', personality: '保守、担心', coreDemand: '怕投资打水漂', initialStance: '反对', stanceValue: 0.2 },
      { id: 'v2', name: '孙婶', avatar: '👩', personality: '积极、愿意尝试', coreDemand: '想多赚钱', initialStance: '支持', stanceValue: 0.9 },
      { id: 'v3', name: '周会计', avatar: '🧑‍💼', personality: '精明、算得清', coreDemand: '要看到详细财务预测', initialStance: '中立', stanceValue: 0.5 }
    ]
  },
  'scenario_005': {
    title: '邻里噪音纠纷调解',
    description: '村民小陈家晚上经常聚会打牌，邻居老刘多次投诉，双方产生口角。你前往调解。',
    villagers: [
      { id: 'v1', name: '小陈', avatar: '🧑', personality: '年轻、爱热闹', coreDemand: '不想被管太多', initialStance: '反对', stanceValue: 0.2 },
      { id: 'v2', name: '老刘', avatar: '👨', personality: '急躁、敏感', coreDemand: '要求立即停止噪音', initialStance: '反对', stanceValue: 0.1 },
      { id: 'v3', name: '王阿姨', avatar: '👵', personality: '热心、爱调解', coreDemand: '希望双方各退一步', initialStance: '中立', stanceValue: 0.5 }
    ]
  }
};

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

// 创建模拟会话（不再添加 initial_message）
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
  // ❌ 不再自动添加初始消息，由前端自动发言负责
  res.json({ sessionId: session.id, initialMessage: scenario.initial_message });
});

// 智能提示分析接口
router.post('/analyze-input', async (req, res) => {
  const { text, scenarioId } = req.body;
  if (!text) return res.json({ tips: [] });
  const scenario = await db.get(`SELECT goal, role FROM scenarios WHERE id = $1`, [scenarioId]);
  if (!scenario) return res.json({ tips: [] });
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

  let extra = {};
  if (session.scenarioId) {
    try { extra = JSON.parse(session.scenarioId); } catch(e) { extra = { scenarioId: session.scenarioId, stages: [], timeLimit: null, startTime: Date.now() }; }
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

  // 保存用户消息
  await addMessage(sessionId, 'user', message, Date.now());

  // 处理村民记忆（如果是多人模式）
  if (villager) {
    const newFacts = extractKeyFacts(message);
    const memoryKey = `${sessionId}_${villager.name}`;
    const memories = villagerMemory.get(memoryKey) || [];
    memories.push(...newFacts);
    villagerMemory.set(memoryKey, memories.slice(-5));
  }

  // 获取完整对话历史（最近20条），用于构建上下文
  const updatedSession = await getSession(userId, sessionId);
  const dialogueHistory = updatedSession.messages.slice(-20).map(msg => {
    if (msg.role === 'user') return `村官：${msg.content}`;
    if (msg.role === 'assistant') {
      // 提取发言者名称（格式为 "张三：内容"）
      const colonIndex = msg.content.indexOf('：');
      if (colonIndex > 0 && colonIndex < 30) {
        const name = msg.content.substring(0, colonIndex);
        const content = msg.content.substring(colonIndex + 1);
        return `${name}：${content}`;
      }
      return `村民：${msg.content}`;
    }
    return '';
  }).filter(Boolean).join('\n');

  // 确定当前回复的村民信息
  let roleName = scenario.role;
  let personality = '';
  let satisfaction = extra.satisfaction || 50;
  let currentEmotion = extra.emotion || 'neutral';
  const difficulty = session.difficulty || 'medium';

  if (villager) {
    // 多人模式：使用指定村民
    roleName = villager.name;
    const villagersState = extra.villagersState || {};
    const state = villagersState[roleName] || { satisfaction: 50, emotion: 'neutral' };
    satisfaction = state.satisfaction;
    currentEmotion = state.emotion;
    // 从配置中获取该村民的性格（如果有）
    const multiConfig = scenarioMultiConfig[scenario.id];
    const configVillager = multiConfig?.villagers.find(v => v.name === roleName);
    personality = configVillager?.personality || villager.personality || '普通村民';
  } else {
    // 单人模式根据难度生成性格
    switch (difficulty) {
      case 'easy':
        personality = '你的性格温和、有耐心，即使面对质疑也愿意耐心解释。你说话客气，容易沟通。';
        break;
      case 'medium':
        personality = '你的性格普通，有时会表现出一些固执和不耐烦，但整体还能理性沟通。';
        break;
      case 'hard':
        personality = '你的性格急躁、说话难听，容易发火，对村干部的提议非常抵触，喜欢用反问和指责的语气。你会故意刁难对方，说话夹枪带棒。';
        break;
      default:
        personality = '你的性格普通，有时会表现出一些固执和不耐烦。';
    }
  }

  // 构建提示词，强调必须针对最后一条用户消息回复，不能提及无关村民
  const prompt = `你正在模拟一场乡村工作场景。你的角色是：${roleName}。
${personality}
当前对话目标：${scenario.goal}
当前满意度：${satisfaction}（0-100），情绪：${currentEmotion}。

请严格根据以下对话历史，以 ${roleName} 的身份自然回应 **最新一条村官的消息**。
- 不要提及与你无关的其他村民（除非村官在消息中提到了他们）。
- 你的回复应该紧扣村官刚才说的话，表达你的立场和诉求。
- 保持你的性格特征。
- 直接输出你的回复内容，不要输出任何额外说明或JSON格式。

对话历史：
${dialogueHistory}

${roleName}：`;

  try {
    const reply = await chat([{ role: 'user', content: prompt }], { temperature: 0.8, max_tokens: 350 });
    // 简单随机满意度变化（-5 到 +5）
    const satisfactionDelta = Math.floor(Math.random() * 11) - 5;
    let newSatisfaction = satisfaction + satisfactionDelta;
    newSatisfaction = Math.min(100, Math.max(0, newSatisfaction));
    let newEmotion = currentEmotion;
    if (satisfactionDelta > 5) newEmotion = 'happy';
    else if (satisfactionDelta < -5) newEmotion = 'angry';
    else newEmotion = 'neutral';

    // 更新状态
    if (villager) {
      const villagersState = extra.villagersState || {};
      villagersState[roleName] = { satisfaction: newSatisfaction, emotion: newEmotion };
      extra.villagersState = villagersState;
    } else {
      extra.satisfaction = newSatisfaction;
      extra.emotion = newEmotion;
    }
    // 更新 stages 进度（简单规则：如果满意度提升且未完成，则推进阶段）
    if (stages.length && !stages[0].completed && newSatisfaction > satisfaction) {
      stages[0].completed = true;
    }
    extra.stages = stages;
    await db.run(`UPDATE sessions SET scenario_id = $1 WHERE id = $2`, [JSON.stringify(extra), sessionId]);

    const fullReply = `${roleName}：${reply}`;
    const msgId = (await addMessage(sessionId, 'assistant', fullReply, Date.now())).messageId;
    res.json({
      reply,
      messageId: msgId,
      satisfaction: newSatisfaction,
      emotion: newEmotion,
      stageProgress: stages[0]?.completed ? 1 : 0,
      strategyTip: ''
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
      await db.run(`INSERT INTO simulate_mistakes (id, user_id, mistake_text, scenario_id, created_at) VALUES ($1, $2, $3, $4, $5)`, [uuidv4(), userId, mistake, scenarioId, new Date().toISOString()]);
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