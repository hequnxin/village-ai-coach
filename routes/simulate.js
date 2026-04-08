const express = require('express');
const { chat } = require('../services/openai');
const { getSession, addMessage, updateSession, createSession } = require('../services/sessionService');
const db = require('../services/db');

const router = express.Router();

// 获取场景列表
router.get('/scenarios', async (req, res) => {
    const scenarios = await db.all('SELECT * FROM scenarios ORDER BY created_at');
    scenarios.forEach(s => {
        if (s.eval_dimensions) {
            s.evalDimensions = JSON.parse(s.eval_dimensions);
        } else {
            s.evalDimensions = [];
        }
        delete s.eval_dimensions;
    });
    res.json(scenarios);
});

// 创建模拟会话（接收难度参数）
router.post('/session', async (req, res) => {
    const { scenarioId, difficulty = 'medium' } = req.body;
    const userId = req.user.userId;

    const scenario = await db.get('SELECT * FROM scenarios WHERE id = $1', [scenarioId]);
    if (!scenario) return res.status(404).json({ error: '场景不存在' });

    if (scenario.eval_dimensions) {
        scenario.evalDimensions = JSON.parse(scenario.eval_dimensions);
    } else {
        scenario.evalDimensions = [];
    }

    const session = await createSession(userId, { title: scenario.title, type: 'simulate', scenarioId, difficulty });
    await addMessage(session.id, 'assistant', scenario.initial_message, Date.now());

    res.json({ sessionId: session.id, initialMessage: scenario.initial_message });
});

// 模拟对话（根据难度调整角色性格）
router.post('/chat', async (req, res) => {
    const { sessionId, message } = req.body;
    const userId = req.user.userId;

    const session = await getSession(userId, sessionId);
    if (!session || session.type !== 'simulate') {
        return res.status(404).json({ error: '对练会话不存在' });
    }

    const scenarioId = session.scenarioId;
    if (!scenarioId) return res.status(500).json({ error: '场景数据丢失' });

    const scenario = await db.get('SELECT * FROM scenarios WHERE id = $1', [scenarioId]);
    if (!scenario) return res.status(500).json({ error: '场景数据丢失' });

    await addMessage(sessionId, 'user', message, Date.now());

    const updatedSession = await getSession(userId, sessionId);
    const dialogueHistory = updatedSession.messages.filter(m => m.role !== 'system').map(m =>
        `${m.role === 'user' ? '村官' : scenario.role}: ${m.content}`
    ).join('\n');

    let personality = '';
    const difficulty = session.difficulty || 'medium';
    switch (difficulty) {
        case 'easy':
            personality = `你的性格温和、有耐心，即使面对质疑也愿意耐心解释。你说话客气，容易沟通。`;
            break;
        case 'medium':
            personality = `你的性格普通，有时会表现出一些固执和不耐烦，但整体还能理性沟通。`;
            break;
        case 'hard':
            personality = `你的性格急躁、说话难听，容易发火，对村干部的提议非常抵触，喜欢用反问和指责的语气。你会故意刁难对方，说话夹枪带棒。`;
            break;
        default:
            personality = `你的性格普通，有时会表现出一些固执和不耐烦。`;
    }

    const prompt = `你正在模拟乡村工作场景。你的角色是：${scenario.role}。当前对话目标：${scenario.goal}。\
${personality}\
请根据以下对话历史，以角色的身份自然回应。注意语气要符合角色设定，可以适当推进对话，展现出该难度下应有的情绪和态度。\

对话历史：\
${dialogueHistory}\
${scenario.role}：`;

    try {
        const reply = await chat([{ role: 'user', content: prompt }], { temperature: 0.8, max_tokens: 250 });
        const msgId = (await addMessage(sessionId, 'assistant', reply, Date.now())).messageId;
        res.json({ reply, messageId: msgId });
    } catch (err) {
        console.error('对练消息失败:', err);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// 结束对练并生成评估报告
router.post('/finish', async (req, res) => {
    const { sessionId } = req.body;
    const userId = req.user.userId;

    const session = await getSession(userId, sessionId);
    if (!session || session.type !== 'simulate') return res.status(404).json({ error: '对练会话不存在' });

    const scenarioId = session.scenarioId;
    if (!scenarioId) return res.status(500).json({ error: '场景数据丢失' });

    const scenario = await db.get('SELECT * FROM scenarios WHERE id = $1', [scenarioId]);
    if (!scenario) return res.status(500).json({ error: '场景数据丢失' });

    let evalDimensions = [];
    if (scenario.eval_dimensions) {
        try {
            evalDimensions = JSON.parse(scenario.eval_dimensions);
        } catch (e) {
            evalDimensions = [];
        }
    }

    const dialogue = session.messages.filter(m => m.role !== 'system').map(m =>
        `${m.role === 'user' ? '村官' : scenario.role}: ${m.content}`
    ).join('\n');

    const evalPrompt = `你是一名乡村治理培训师，请根据以下村官与${scenario.role}的模拟对话，从多个维度评估村官的表现。维度包括：${evalDimensions.join('、')}。请为每个维度打分（1-5分，5分为最佳），并给出具体的改进建议。最后以JSON格式输出，格式如下：\
{
    "scores": { "沟通技巧": 4, "政策熟悉度": 3, ... },
    "suggestions": "整体表现...建议..."
}\

对话内容：\
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
        await addMessage(sessionId, 'system', `report:${JSON.stringify(report)}`, Date.now());
        res.json(report);
    } catch (err) {
        console.error('生成报告失败:', err);
        res.status(500).json({ error: '生成报告失败' });
    }
});

module.exports = router;