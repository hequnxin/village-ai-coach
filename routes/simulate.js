// routes/simulate.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { chat } = require('../services/openai');
const { getSession, addMessage, updateSession, createSession } = require('../services/sessionService');
const db = require('../services/db');

const router = express.Router();

// 内存存储村民记忆（生产环境应使用数据库）
const villagerMemory = new Map();

function extractKeyFacts(text) {
  const promises = text.match(/[^。]*?(?:保证|承诺|会|一定|尽快|解决|处理)[^。]*。/g);
  return promises || [];
}

// ========== 场景化阶段关键词配置 ==========
const SCENE_STAGE_KEYWORDS = {
  'scenario_001': {
    '安抚情绪': ['委屈', '理解', '别生气', '消消气', '我懂', '道歉', '对不起', '态度不好', '祖辈', '不容易', '别急', '慢慢说'],
    '讲清政策': ['土地管理法', '宅基地', '确权', '档案', '四至', '权属', '政府处理', '仲裁', '法律', '凭证', '土地证', '登记'],
    '达成共识': ['测量', '皮尺', '土管所', '老党员', '现场', '重新量', '划界', '协议', '签字', '拆篱笆', '赔菜苗', '各让一步', '老界石', '和解']
  },
  'scenario_002': {
    '安抚情绪': ['嫌麻烦', '搞不懂', '年纪大', '太复杂', '不想分', '理解', '不容易', '体谅', '辛苦', '别着急'],
    '讲清政策': ['垃圾分类条例', '补贴', '奖励', '示范户', '红黑榜', '积分兑换', '回收', '政策', '好处', '环保', '分类标准'],
    '达成共识': ['试点', '发放垃圾桶', '专人指导', '年底奖励', '参与', '同意', '行', '就这么办', '愿意分', '配合']
  },
  'scenario_003': {
    '安抚情绪': ['堆门口', '碍谁的事', '管得宽', '花钱', '不愿意', '理解', '不容易', '别激动', '消消气', '体谅'],
    '讲清政策': ['门前三包', '村规民约', '人居环境整治', '罚款', '奖励', '卫生文明户', '清理标准'],
    '达成共识': ['志愿者帮忙', '统一回收', '清理时间', '评比', '承诺', '清理', '行', '同意', '搬走', '整理']
  },
  'scenario_004': {
    '安抚情绪': ['怕亏', '担心', '祖祖辈辈种地', '投资打水漂', '理解', '顾虑', '风险', '别怕', '理解你'],
    '讲清政策': ['乡村振兴资金', '项目申报', '可行性报告', '风险控制', '收益预期', '补贴', '贷款', '衔接资金', '产业扶持'],
    '达成共识': ['小范围试点', '参观成功案例', '专家讲解', '参与意向', '同意', '签字', '愿意参加', '支持']
  },
  'scenario_005': {
    '安抚情绪': ['吵死了', '高血压', '不管', '天天吵', '理解', '道歉', '别上火', '不容易', '别生气', '消消气'],
    '讲清政策': ['噪音扰民', '治安管理处罚法', '村规民约', '约定时间', '法律', '扰民标准'],
    '达成共识': ['晚上10点后停止', '加装隔音垫', '邻里公约', '签字', '同意', '各退一步', '约定', '保证']
  }
};

function shouldForceStageProgress(scenarioId, userMessage, currentStageName) {
  if (!scenarioId || !currentStageName) return false;
  const sceneConfig = SCENE_STAGE_KEYWORDS[scenarioId];
  if (!sceneConfig) return false;
  const keywords = sceneConfig[currentStageName];
  if (!keywords || keywords.length === 0) return false;
  return keywords.some(kw => userMessage.includes(kw));
}

// ========== 获取场景列表 ==========
router.get('/scenarios', async (req, res) => {
  const scenarios = await db.all('SELECT * FROM scenarios ORDER BY created_at');
  scenarios.forEach(s => {
    if (s.eval_dimensions) s.evalDimensions = JSON.parse(s.eval_dimensions);
    else s.evalDimensions = [];
    if (s.single_roles) s.singleRoles = JSON.parse(s.single_roles);
    else s.singleRoles = [];
    delete s.eval_dimensions;
    delete s.single_roles;
  });
  res.json(scenarios);
});

// ========== 创建模拟会话 ==========
router.post('/session', async (req, res) => {
  const { scenarioId, difficulty = 'medium', timeLimit = null, roleId = null } = req.body;
  const userId = req.user.userId;

  const scenario = await db.get('SELECT * FROM scenarios WHERE id = $1', [scenarioId]);
  if (!scenario) return res.status(404).json({ error: '场景不存在' });

  let singleRoles = [];
  if (scenario.single_roles) {
    try { singleRoles = JSON.parse(scenario.single_roles); } catch(e) {}
  }

  let selectedRole = null;
  if (roleId && singleRoles.length) {
    selectedRole = singleRoles.find(r => r.id === roleId);
  }
  if (!selectedRole && singleRoles.length) {
    selectedRole = singleRoles[0];
  }
  if (!selectedRole) {
    selectedRole = {
      name: scenario.role,
      avatar: '👤',
      personality: '普通',
      coreDemand: '',
      initialStance: '中立'
    };
  }

  let stages = [];
  if (scenario.stages) {
    try { stages = JSON.parse(scenario.stages); } catch(e) {}
  }
  if (!stages.length) {
    stages = [
      { name: '安抚情绪', description: '让村民情绪稳定下来', completed: false },
      { name: '讲清政策', description: '解释相关政策和法规', completed: false },
      { name: '达成共识', description: '双方达成初步协议', completed: false }
    ];
  }

  const session = await createSession(userId, { title: scenario.title, type: 'simulate', scenarioId, difficulty });

  const extra = {
    scenarioId,
    stages,
    timeLimit,
    startTime: Date.now(),
    satisfaction: 50,
    emotion: 'neutral',
    singleRole: selectedRole
  };
  await db.run(`UPDATE sessions SET scenario_id = $1 WHERE id = $2`, [JSON.stringify(extra), session.id]);

  await addMessage(session.id, 'assistant', scenario.initial_message, Date.now());
  res.json({ sessionId: session.id, initialMessage: scenario.initial_message });
});

// ========== 智能提示 ==========
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

// ========== 随机事件 ==========
router.post('/event/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const { satisfactionDelta, stageRollback } = req.body;
  const userId = req.user.userId;

  const session = await getSession(userId, sessionId);
  if (!session) return res.status(404).json({ error: '会话不存在' });

  let extra = {};
  if (session.scenarioId) {
    try { extra = JSON.parse(session.scenarioId); } catch(e) {}
  }

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

// ========== 模拟对话 ==========
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
    const singleRole = extra.singleRole || {
      name: scenario.role,
      personality: '普通',
      coreDemand: '',
      initialStance: '中立'
    };
    roleName = singleRole.name;
    personality = `你的性格：${singleRole.personality}。你的核心诉求：${singleRole.coreDemand || '无'}。你的初始立场：${singleRole.initialStance}。`;
    satisfaction = extra.satisfaction || 50;
    currentEmotion = extra.emotion || 'neutral';
    if (difficulty === 'easy') {
      personality += ' 你性格温和，容易沟通。';
    } else if (difficulty === 'hard') {
      personality += ' 你性格急躁，说话难听，容易发火。';
    }
  }

  let memoryHint = '';
  if (villager) {
    const memoryKey = `${sessionId}_${villager.name}`;
    const memories = villagerMemory.get(memoryKey) || [];
    if (memories.length > 0) {
      memoryHint = `\n该村民记得你之前说过：${memories.join('；')}。如果合适，可以在对话中提及这些承诺的履行情况。`;
    }
  }

  let discussionHint = '';
  if (villager && updatedSession.messages.length >= 2) {
    const lastAssistantMsg = [...updatedSession.messages].reverse().find(m => m.role === 'assistant' && m.content !== scenario.initial_message);
    if (lastAssistantMsg) {
      discussionHint = `\n刚刚其他村民或村官发表了观点，请你针对他/她的发言表达你的看法，要体现你的性格特点。`;
    }
  }

  let characterList = '';
  if (villager) {
    if (scenarioId === 'scenario_001') {
      characterList = '场景中有三个村民：张三、李四、王婶（王大妈）。请只与这些角色对话，不要提及任何不存在的人物。';
    } else if (scenarioId === 'scenario_002') {
      characterList = '场景中有三个村民：张大爷、李大妈、王会计。请只与这些角色对话。';
    } else if (scenarioId === 'scenario_003') {
      characterList = '场景中有三个村民：老赵、刘婶、周会计。请只与这些角色对话。';
    } else if (scenarioId === 'scenario_004') {
      characterList = '场景中有三个村民：李大叔、孙婶、周会计。请只与这些角色对话。';
    } else if (scenarioId === 'scenario_005') {
      characterList = '场景中有三个村民：小陈、老刘、王阿姨。请只与这些角色对话。';
    } else {
      characterList = '请只与现有村民对话，不要提及任何不存在的人物。';
    }
  } else {
    characterList = `当前只有你和村官两个人对话，没有其他村民。请只针对村官的发言进行回应，不要提及任何不存在的人物。`;
  }

  const strategyTipInstruction = `
请分析用户刚才的发言，判断其使用的策略（安抚、强硬、讲道理、回避等），并给出一个简短的实时提示（不超过20字）帮助用户改进。同时判断对话是否推动了阶段目标。返回JSON格式：{"reply":"你的回复","satisfactionDelta":整数(-20到20),"emotion":"happy/sad/angry/neutral","stageProgress":0或1,"strategyTip":"提示内容"}`;

  const prompt = `你正在模拟一场乡村工作场景。你的角色是：${roleName}。当前对话目标：${scenario.goal}。

${personality}

${characterList}

**你正在与村官（村干部）对话。村官是来帮助你解决问题的，请以村民的身份与他/她交流。**

当前村民满意度：${satisfaction}（0-100），情绪：${currentEmotion}。

请根据以下对话历史，以角色的身份自然回应。注意语气要符合角色设定。

${memoryHint}
${discussionHint}

${strategyTipInstruction}

对话历史：
${dialogueHistory}

${roleName}：`;

  try {
    let response = await chat([{ role: 'user', content: prompt }], { temperature: 0.8, max_tokens: 350 });
    let parsed;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch(e) {}
    if (!parsed) parsed = { reply: response, satisfactionDelta: 0, emotion: 'neutral', stageProgress: 0, strategyTip: '' };

    let reply = parsed.reply;
    let satisfactionDelta = parsed.satisfactionDelta || 0;
    let newEmotion = parsed.emotion || 'neutral';
    let stageProgress = parsed.stageProgress || 0;
    let strategyTip = parsed.strategyTip || '';

    const currentUnfinishedStage = stages.find(s => !s.completed);
    if (currentUnfinishedStage && stageProgress === 0) {
      if (shouldForceStageProgress(scenarioId, message, currentUnfinishedStage.name)) {
        console.log(`🔧 关键词触发推进阶段: ${currentUnfinishedStage.name}，重新生成回复...`);

        const newPrompt = `你正在模拟一场乡村工作场景。你的角色是：${roleName}。当前对话目标：${scenario.goal}。

${personality}

${characterList}

**你正在与村官（村干部）对话。村官是来帮助你解决问题的。**

**重要：村官刚刚成功完成了“${currentUnfinishedStage.name}”阶段，你的情绪应该明显缓和，态度转向配合。请以更平和的语气回应，不要继续发脾气或对抗。**

当前村民满意度：${satisfaction}（0-100），情绪：${currentEmotion}。

请根据以下对话历史，以角色的身份自然回应。注意语气要符合角色设定（但情绪已缓和）。

${memoryHint}
${discussionHint}

${strategyTipInstruction}

对话历史：
${dialogueHistory}

${roleName}：`;

        try {
          const newResponse = await chat([{ role: 'user', content: newPrompt }], { temperature: 0.8, max_tokens: 350 });
          let newParsed;
          try {
            const jsonMatch = newResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) newParsed = JSON.parse(jsonMatch[0]);
          } catch(e) {}
          if (newParsed) {
            reply = newParsed.reply || reply;
            satisfactionDelta = newParsed.satisfactionDelta || 5;
            newEmotion = newParsed.emotion || 'happy';
            strategyTip = newParsed.strategyTip || strategyTip;
          } else {
            reply = newResponse;
            satisfactionDelta = 5;
            newEmotion = 'happy';
          }
        } catch(err) {
          console.warn('重新生成回复失败，使用原回复并追加提示', err);
          reply += `\n\n（村民情绪有所缓和）`;
          satisfactionDelta = Math.max(satisfactionDelta, 5);
          newEmotion = 'happy';
        }

        stageProgress = 1;
        satisfactionDelta = Math.max(satisfactionDelta, 5);
        reply += `\n\n（系统提示：您已成功完成“${currentUnfinishedStage.name}”阶段，进入下一阶段。）`;
      }
    }

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

// ========== 结束对练并生成报告 ==========
router.post('/finish', async (req, res) => {
  const { sessionId } = req.body;
  const userId = req.user.userId;

  const session = await getSession(userId, sessionId);
  if (!session || session.type !== 'simulate') return res.status(404).json({ error: '对练会话不存在' });

  let extra = { scenarioId: session.scenarioId, stages: [], satisfaction: 50 };
  if (session.scenarioId) {
    try { extra = JSON.parse(session.scenarioId); } catch(e) {}
  }

  const scenarioId = extra.scenarioId || session.scenarioId;
  const stages = extra.stages || [];
  const finalSatisfaction = extra.satisfaction || 50;

  const scenario = await db.get('SELECT * FROM scenarios WHERE id = $1', [scenarioId]);
  if (!scenario) return res.status(500).json({ error: '场景数据丢失' });

  let evalDimensions = [];
  if (scenario.eval_dimensions) {
    try { evalDimensions = JSON.parse(scenario.eval_dimensions); } catch(e) {}
  }

  const dialogue = session.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp }));

  const reportPrompt = `你是一名乡村治理培训师。请根据以下村官与${scenario.role}的模拟对话，生成一份详细评估报告。

评估维度：${evalDimensions.join('、')}。

要求：
1. 对每个维度打分（1-5分），并给出具体改进建议。
2. 从对话中摘录村官的2-3句典型发言，分别标注"优点"或"需改进"。
3. 提供2-3条该场景下的优秀话术参考。
4. 总结用户在本模拟中的关键失误点，并归类，这些将存入错题本。

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
    const finalScore = Math.min(100, Math.round((totalScore + satisfactionBonus/10) * 20));

    const completedCount = stages.filter(s => s.completed).length;
    const totalCount = stages.length;
    extra.report = report;
    extra.finalScore = finalScore;
    extra.satisfaction = finalSatisfaction;
    extra.stagesCompleted = completedCount;
    extra.totalStages = totalCount;
    extra.isFinished = true;
    await db.run(`UPDATE sessions SET scenario_id = $1 WHERE id = $2`, [JSON.stringify(extra), sessionId]);

    res.json({ report, finalScore, satisfaction: finalSatisfaction, stagesCompleted: completedCount, totalStages: totalCount });
  } catch (err) {
    console.error('生成报告失败:', err);
    res.status(500).json({ error: '生成报告失败' });
  }
});

// ========== 获取模拟会话状态 ==========
router.get('/status/:sessionId', async (req, res) => {
  const userId = req.user.userId;
  const session = await getSession(userId, req.params.sessionId);
  if (!session || session.type !== 'simulate') return res.status(404).json({ error: '会话不存在' });

  let extra = {};
  if (session.scenarioId) {
    try { extra = JSON.parse(session.scenarioId); } catch(e) {}
  }

  res.json({
    satisfaction: extra.satisfaction || 50,
    emotion: extra.emotion || 'neutral',
    stages: extra.stages || [],
    timeRemaining: extra.timeLimit ? Math.max(0, extra.timeLimit - Math.floor((Date.now() - (extra.startTime||Date.now())) / 1000)) : null,
    villagersState: extra.villagersState || {}
  });
});

// ========== 获取报告（供结束后查看） ==========
router.get('/report/:sessionId', async (req, res) => {
  const userId = req.user.userId;
  const session = await getSession(userId, req.params.sessionId);
  if (!session || session.type !== 'simulate') return res.status(404).json({ error: '会话不存在' });

  let extra = {};
  if (session.scenarioId) {
    try { extra = JSON.parse(session.scenarioId); } catch(e) {}
  }

  if (extra.report && extra.isFinished) {
    res.json({
      report: extra.report,
      finalScore: extra.finalScore,
      satisfaction: extra.satisfaction,
      stagesCompleted: extra.stagesCompleted,
      totalStages: extra.totalStages
    });
  } else {
    const reportMsg = session.messages.find(m => m.role === 'system' && m.content.startsWith('report:'));
    if (reportMsg) {
      try {
        const reportJson = JSON.parse(reportMsg.content.substring(7));
        res.json({ report: reportJson, finalScore: 0, satisfaction: 0, stagesCompleted: 0, totalStages: 0 });
      } catch(e) {
        res.status(404).json({ error: '报告格式错误' });
      }
    } else {
      res.status(404).json({ error: '未找到报告' });
    }
  }
});

// ========== 强制推进议程 ==========
router.post('/force-stage', async (req, res) => {
  const { sessionId } = req.body;
  const userId = req.user.userId;

  const session = await getSession(userId, sessionId);
  if (!session || session.type !== 'simulate') return res.status(404).json({ error: '会话不存在' });

  let extra = {};
  if (session.scenarioId) {
    try { extra = JSON.parse(session.scenarioId); } catch(e) {}
  }

  const stages = extra.stages || [];
  const currentIndex = stages.findIndex(s => !s.completed);
  if (currentIndex === -1) {
    return res.status(400).json({ error: '所有议程已完成，无需推进' });
  }

  stages[currentIndex].completed = true;
  extra.stages = stages;

  await db.run(`UPDATE sessions SET scenario_id = $1 WHERE id = $2`, [JSON.stringify(extra), sessionId]);
  await addMessage(sessionId, 'system', `📌 已强制推进议程：“${stages[currentIndex].name}” 已完成。`, Date.now());

  res.json({ success: true, completedStage: stages[currentIndex].name, remainingStages: stages.filter(s => !s.completed).length });
});

module.exports = router;