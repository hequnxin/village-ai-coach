const express = require('express');
const { chat } = require('../services/openai');
const { searchKnowledge } = require('../services/vectorSearch');
const { webSearch } = require('../services/knowledgeService');
const { getSession, updateSession, addMessage } = require('../services/sessionService');

const router = express.Router();

const SYSTEM_PROMPT = `你是一名经验丰富的乡村治理专家，同时也是基层干部的"AI伙伴"。你的任务是用中文回答村官提出的各种实际问题，你的回答必须遵循以下原则：

1. **有条理**：使用小标题、列表、分段等方式组织内容，使回答清晰易读。
2. **循因导果**：帮助用户分析问题的原因、影响、后果，理清逻辑。
3. **梳理问题**：将复杂问题拆解成几个方面，逐一说明。
4. **结尾引导**：在回答的最后，根据用户当前问题和历史对话，提出2-3个有针对性、递进式的引导问题，帮助用户深入思考或明确下一步行动。你可以使用类似这样的句式：
   - "您是否已经......？"
   - "接下来您打算如何处理......？"
   - "您觉得最大的难点在哪里？"
   - "关于......，您有什么具体的想法吗？"
   问题要贴合对话内容，避免空泛。
5. **必要时苏格拉底式引导**：如果用户的问题含糊不清，你可以先反问几个问题，引导用户澄清需求，再给出建议。
如果用户提供的信息不足，可以适当追问。`;

async function offlineReply(message, knowledgeContext) {
  if (knowledgeContext && knowledgeContext.trim()) {
    return `⚠️ 当前为离线模式，无法联网获取最新信息。\n\n以下是根据本地知识库找到的相关内容：\n${knowledgeContext}\n\n您可以尝试重新连接网络后再次提问，或描述更详细的情况，我会尽力协助。`;
  } else {
    return `⚠️ 当前为离线模式，且本地知识库未找到相关内容。\n\n建议您检查网络连接，或稍后再试。`;
  }
}

// 原有聊天路由
router.post('/', async (req, res) => {
  const { sessionId, message } = req.body;
  const userId = req.user.userId;
  if (!sessionId || !message) {
    return res.status(400).json({ error: '缺少 sessionId 或 message' });
  }

  const session = getSession(userId, sessionId);
  if (!session) {
    return res.status(404).json({ error: '会话不存在' });
  }
  if (session.type !== 'chat') {
    return res.status(400).json({ error: '该会话不是问答会话' });
  }

  addMessage(sessionId, 'user', message, Date.now());

  // 自动设置标题（第一条用户消息）
  const updatedSession = getSession(userId, sessionId);
  const userMessageCount = updatedSession.messages.filter(m => m.role === 'user').length;
  if (userMessageCount === 1) {
    const newTitle = message.length > 20 ? message.substring(0, 20) + '...' : message;
    updateSession(userId, sessionId, { title: newTitle });
  }

  // 知识检索
  const knowledgeResults = searchKnowledge(message, 3);
  let knowledgeContext = '';
  const knowledgeRefs = [];
  if (knowledgeResults.length > 0) {
    knowledgeContext = '\n\n【相关知识库内容】\n' + knowledgeResults.map(k =>
      `- ${k.title}：${k.content.substring(0, 200)}${k.content.length > 200 ? '...' : ''}`
    ).join('\n');
    knowledgeRefs.push(...knowledgeResults.map(k => ({ title: k.title, id: k.id, type: 'knowledge' })));
  }

  // 可选联网搜索
  let webResults = [];
  const shouldSearch = message.includes('联网搜索') || message.includes('查一下') || message.includes('搜索一下');
  if (shouldSearch && process.env.BAIDU_API_KEY && process.env.OFFLINE_MODE !== 'true') {
    try {
      webResults = await webSearch(message, 2);
      if (webResults.length > 0) {
        knowledgeContext += '\n\n【网络搜索结果】\n' + webResults.map(w =>
          `- ${w.title}：${w.snippet.substring(0, 200)}${w.snippet.length > 200 ? '...' : ''}`
        ).join('\n');
        knowledgeRefs.push(...webResults.map(w => ({ title: w.title, snippet: w.snippet, link: w.link, type: 'web' })));
      }
    } catch (e) {
      console.warn('联网搜索失败，已进入离线模式');
    }
  }

  // 构建历史
  const history = updatedSession.messages.slice(-10).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content
  }));
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: `用户问题：${message}\n${knowledgeContext}\n请回答。` }
  ];

  let reply = '';
  let errorOccurred = false;
  try {
    reply = await chat(messages, { temperature: 0.7, max_tokens: 1200 });
  } catch (err) {
    console.error('DeepSeek API 调用失败，进入离线模式:', err.message);
    errorOccurred = true;
    reply = await offlineReply(message, knowledgeContext);
  }

  const assistantMsgId = addMessage(sessionId, 'assistant', reply, Date.now()).messageId;

  const finalSession = getSession(userId, sessionId);
  const finalTitle = finalSession.title;

  res.json({
    reply,
    assistantMessageId: assistantMsgId,
    knowledgeRefs,
    offlineMode: errorOccurred,
    sessionTitle: finalTitle
  });
});

// 新增：对话摘要接口
// 新增：对话摘要接口（增强版）
router.post('/summarize', async (req, res) => {
  const { sessionId, messages: providedMessages } = req.body;
  const userId = req.user.userId;

  let conversationMessages = [];
  if (sessionId) {
    const session = getSession(userId, sessionId);
    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }
    conversationMessages = session.messages.slice(-20); // 取最近20条
  } else if (providedMessages && Array.isArray(providedMessages)) {
    conversationMessages = providedMessages;
  } else {
    return res.status(400).json({ error: '请提供 sessionId 或 messages 数组' });
  }

  if (conversationMessages.length === 0) {
    return res.json({ summary: { points: [], status: '', reasons: [], suggestions: [], references: [] } });
  }

  // 构建对话文本
  const dialogueText = conversationMessages.map(msg => {
    const role = msg.role === 'user' ? '村官' : 'AI伙伴';
    return `${role}：${msg.content}`;
  }).join('\n\n');

  const summaryPrompt = `你是一名乡村治理专家，请根据以下村官与AI的对话，提取关键信息，按照以下格式输出一个 JSON 对象（不要包含其他文字）：

{
  "points": ["问题要点1", "问题要点2"],
  "status": "现状描述",
  "reasons": ["原因分析1", "原因分析2"],
  "suggestions": ["建议1", "建议2"],
  "references": ["参考案例/政策1", "参考案例/政策2"]
}

对话内容：
${dialogueText}`;

  try {
    const summaryText = await chat([{ role: 'user', content: summaryPrompt }], { temperature: 0.3, max_tokens: 800 });

    // 更健壮的 JSON 提取：尝试找到第一个 { 和最后一个 }
    let jsonStr = '';
    const firstBrace = summaryText.indexOf('{');
    const lastBrace = summaryText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = summaryText.substring(firstBrace, lastBrace + 1);
    } else {
      throw new Error('未找到有效的JSON对象');
    }

    let summary = JSON.parse(jsonStr);
    // 确保所有字段都存在
    summary = {
      points: summary.points || [],
      status: summary.status || '',
      reasons: summary.reasons || [],
      suggestions: summary.suggestions || [],
      references: summary.references || []
    };
    res.json({ summary });
  } catch (err) {
    console.error('生成摘要失败:', err);
    // 降级返回空结构
    res.json({ summary: { points: [], status: '', reasons: [], suggestions: [], references: [] } });
  }
});

module.exports = router;