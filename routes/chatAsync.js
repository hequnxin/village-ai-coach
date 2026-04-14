// routes/chatAsync.js

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../services/db');
const { chat } = require('../services/openai');
const { searchKnowledge } = require('../services/vectorSearch');
const { keywordSearch } = require('../services/knowledgeService');
const { getSession, addMessage, updateSession } = require('../services/sessionService');
const pointsService = require('../services/pointsService');

const router = express.Router();

// 系统提示词（与原有保持一致）
const SYSTEM_PROMPT = `你是一名经验丰富的乡村治理专家，同时也是基层干部的"AI伙伴"。你的任务是用中文回答村官提出的各种实际问题。你的回答必须遵循以下原则：

1. **有条理**：使用纯文本序号组织内容，例如：
   - 一级标题使用"一、二、三、"（后面跟一个空格）
   - 二级标题使用"（一）（二）（三）" 或 "1. 2. 3."（注意点号）
   - 三级标题使用"（1）（2）（3）" 或 "①②③"
   - 列表项使用"- "或"• "
   - 使用空行分隔不同主题。
   - **绝对不要使用任何Markdown标记**，如星号*、井号#、方括号[]等。
2. **循因导果**：帮助用户分析问题的原因、影响、后果，理清逻辑。
3. **梳理问题**：将复杂问题拆解成几个方面，逐一说明。
4. **结尾引导**：在回答的最后，提出2-3个有针对性、递进式的引导问题。
5. **必要时苏格拉底式引导**：如果用户的问题含糊不清，你可以先反问几个问题。
6. **长度控制**：如果回答内容预计会很长（超过1500字），请主动拆分为多个部分，并在第一部分末尾明确询问用户："内容较长，是否继续了解剩余部分？请回复"继续"。"

请输出纯文本，不要包含任何Markdown语法。`;

// 异步生成回复（带状态更新）
async function generateReplyAsync(sessionId, assistantMsgId, userId, userMessage, knowledgeContext) {
    try {
        const session = await getSession(userId, sessionId);
        if (!session) {
            console.error(`会话不存在: ${sessionId}`);
            return;
        }

        // 1. 更新状态为 'retrieving'（正在检索知识库）
        await db.run('UPDATE messages SET status = $1 WHERE id = $2', ['retrieving', assistantMsgId]);

        // 模拟短暂延迟，让前端有时间渲染状态（可选）
        await new Promise(resolve => setTimeout(resolve, 300));

        // 2. 知识检索（已在外部完成，但为了演示，可以再强调一下）
        // 实际上 knowledgeContext 已经由调用方传入，此处可直接使用

        // 3. 更新状态为 'generating'（正在生成回答）
        await db.run('UPDATE messages SET status = $1 WHERE id = $2', ['generating', assistantMsgId]);

        // 构建历史消息
        const history = (session.messages || []).slice(-10).map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content
        }));

        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...history,
            { role: 'user', content: `用户问题：${userMessage}\n${knowledgeContext}\n请回答。` }
        ];

        // 调用 AI 生成回复
        const reply = await chat(messages, { temperature: 0.7, max_tokens: 2500 });

        // 4. 更新消息内容和状态为 'completed'
        await db.run('UPDATE messages SET content = $1, status = $2 WHERE id = $3', [reply, 'completed', assistantMsgId]);

        // 添加积分
        await pointsService.addPoints(userId, pointsService.CHAT_MESSAGE, `对话: ${userMessage.substring(0,30)}`);

    } catch (err) {
        console.error('异步生成失败:', err);
        const errorReply = '❌ AI 生成失败，请稍后重试。';
        await db.run('UPDATE messages SET content = $1, status = $2 WHERE id = $3', [errorReply, 'completed', assistantMsgId]);
    }
}

// 发送消息（异步）
router.post('/', async (req, res) => {
    const { sessionId, message } = req.body;
    const userId = req.user.userId;

    if (!sessionId || !message) {
        return res.status(400).json({ error: '缺少 sessionId 或 message' });
    }

    const session = await getSession(userId, sessionId);
    if (!session) return res.status(404).json({ error: '会话不存在' });
    if (session.type !== 'chat') return res.status(400).json({ error: '该会话不是问答会话' });

    // 保存用户消息
    await addMessage(sessionId, 'user', message, Date.now());

    // 更新会话标题（如果是第一条消息）
    const userMessageCount = (session.messages || []).filter(m => m.role === 'user').length + 1;
    if (userMessageCount === 1) {
        const newTitle = message.length > 20 ? message.substring(0, 20) + '...' : message;
        await updateSession(userId, sessionId, { title: newTitle });
    }

    // 知识检索（同步进行，但前端会先收到占位消息）
    let knowledgeResults = [];
    try {
        knowledgeResults = await searchKnowledge(message, 3);
    } catch (err) {
        console.warn('向量检索失败，使用关键词降级', err);
        knowledgeResults = await keywordSearch(message, 3);
    }

    let knowledgeContext = '';
    if (knowledgeResults && knowledgeResults.length) {
        knowledgeContext = '\n\n【相关知识库内容】\n' + knowledgeResults.map(k => `- ${k.title}：${k.content.substring(0,200)}${k.content.length>200?'...':''}`).join('\n');
    }

    // 创建占位 assistant 消息（状态 pending）
    const assistantMsgId = uuidv4();
    await db.run(
        'INSERT INTO messages (id, session_id, role, content, status, timestamp) VALUES ($1, $2, $3, $4, $5, $6)',
        [assistantMsgId, sessionId, 'assistant', '正在准备...', 'pending', Date.now()]
    );

    // 异步生成回复（不等待）
    generateReplyAsync(sessionId, assistantMsgId, userId, message, knowledgeContext).catch(console.error);

    // 立即返回 assistant 消息 ID
    res.json({ assistantMessageId: assistantMsgId });
});

// 轮询检查消息状态
router.get('/status/:messageId', async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user.userId;

    const msg = await db.get(
        `SELECT m.id, m.content, m.status, m.session_id, s.user_id
         FROM messages m
         JOIN sessions s ON m.session_id = s.id
         WHERE m.id = $1 AND s.user_id = $2`,
        [messageId, userId]
    );

    if (!msg) return res.status(404).json({ error: '消息不存在' });

    res.json({ status: msg.status, content: msg.content });
});

module.exports = router;