const express = require('express');
const { chat, chatStream } = require('../services/openai');
const { searchKnowledge } = require('../services/vectorSearch');
const { webSearch, keywordSearch } = require('../services/knowledgeService');
const { getSession, updateSession, addMessage } = require('../services/sessionService');
const db = require('../services/db');
const pointsService = require('../services/pointsService');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// 内存缓存
const answerCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function getCacheKey(message, knowledgeContext) {
  const str = `${message}|${knowledgeContext?.substring(0, 200) || ''}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return `chat_${hash}`;
}

// 系统提示词
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

async function offlineReply(message, knowledgeContext) {
  if (knowledgeContext && knowledgeContext.trim()) {
    return `⚠️ 当前为离线模式，无法联网获取最新信息。\n\n以下是根据本地知识库找到的相关内容：\n${knowledgeContext}\n\n您可以尝试重新连接网络后再次提问，或描述更详细的情况，我会尽力协助。`;
  } else {
    return `⚠️ 当前为离线模式，且本地知识库未找到相关内容。\n\n建议您检查网络连接，或稍后再试。`;
  }
}

// 主聊天接口（流式 + 缓存）
router.post('/', async (req, res) => {
  const { sessionId, message } = req.body;
  const userId = req.user.userId;
  if (!sessionId || !message) {
    return res.status(400).json({ error: '缺少 sessionId 或 message' });
  }

  const session = await getSession(userId, sessionId);
  if (!session) return res.status(404).json({ error: '会话不存在' });
  if (session.type !== 'chat') return res.status(400).json({ error: '该会话不是问答会话' });

  await addMessage(sessionId, 'user', message, Date.now());

  const updatedSession = await getSession(userId, sessionId);
  const userMessageCount = updatedSession.messages.filter(m => m.role === 'user').length;
  if (userMessageCount === 1) {
    const newTitle = message.length > 20 ? message.substring(0, 20) + '...' : message;
    await updateSession(userId, sessionId, { title: newTitle });
  }

  // 知识检索
  let knowledgeResults = [];
  try {
    knowledgeResults = await searchKnowledge(message, 3);
  } catch (err) {
    console.warn('向量检索失败，使用关键词降级', err);
    knowledgeResults = await keywordSearch(message, 3);
  }

  let knowledgeContext = '';
  const knowledgeRefs = [];
  if (knowledgeResults && knowledgeResults.length > 0) {
    knowledgeContext = '\n\n【相关知识库内容】\n' + knowledgeResults.map(k =>
      `- ${k.title}：${k.content.substring(0,200)}${k.content.length > 200 ? '...' : ''}`
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
          `- ${w.title}：${w.snippet.substring(0,200)}${w.snippet.length > 200 ? '...' : ''}`
        ).join('\n');
        knowledgeRefs.push(...webResults.map(w => ({ title: w.title, snippet: w.snippet, link: w.link, type: 'web' })));
      }
    } catch (e) {
      console.warn('联网搜索失败，已进入离线模式');
    }
  }
  console.log('触发联网搜索条件检查', { shouldSearch, hasKey: !!process.env.BAIDU_API_KEY, offlineMode: process.env.OFFLINE_MODE });
if (shouldSearch && process.env.BAIDU_API_KEY && process.env.OFFLINE_MODE !== 'true') {
  console.log('开始调用 webSearch...');
  try {
    webResults = await webSearch(message, 2);
    console.log('webSearch 结果数量:', webResults.length);
  } catch(e) { console.warn('联网搜索失败', e); }
} else {
  console.log('跳过联网搜索');
}

  const history = updatedSession.messages.slice(-10).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content
  }));

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: `用户问题：${message}\n${knowledgeContext}\n请回答。` }
  ];

  const cacheKey = getCacheKey(message, knowledgeContext);
  const cached = answerCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    const reply = cached.answer;
    const assistantMsgId = (await addMessage(sessionId, 'assistant', reply, Date.now())).messageId;
    const finalSession = await getSession(userId, sessionId);
    // 添加对话积分
    await pointsService.addPoints(userId, pointsService.CHAT_MESSAGE, `对话: ${message.substring(0,30)}`);
    return res.json({
      reply,
      assistantMessageId: assistantMsgId,
      knowledgeRefs,
      offlineMode: false,
      sessionTitle: finalSession.title,
      fromCache: true
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let fullReply = '';
  let errorOccurred = false;

  const sendChunk = (content) => {
    res.write(`data: ${JSON.stringify({ content })}\n\n`);
  };
  const sendEnd = (assistantMessageId, sessionTitle) => {
    res.write(`data: ${JSON.stringify({ done: true, assistantMessageId, sessionTitle, knowledgeRefs })}\n\n`);
    res.end();
  };

  try {
    await chatStream(messages, { temperature: 0.7, max_tokens: 2500 }, (chunk) => {
      fullReply += chunk;
      sendChunk(chunk);
    });
    const assistantMsgId = (await addMessage(sessionId, 'assistant', fullReply, Date.now())).messageId;
    const finalSession = await getSession(userId, sessionId);
    if (fullReply.length > 50 && !errorOccurred) {
      answerCache.set(cacheKey, { answer: fullReply, timestamp: Date.now() });
    }
    await pointsService.addPoints(userId, pointsService.CHAT_MESSAGE, `对话: ${message.substring(0,30)}`);
    sendEnd(assistantMsgId, finalSession.title);
  } catch (err) {
    console.error('DeepSeek API 调用失败，进入离线模式:', err.message);
    errorOccurred = true;
    fullReply = await offlineReply(message, knowledgeContext);
    sendChunk(fullReply);
    const assistantMsgId = (await addMessage(sessionId, 'assistant', fullReply, Date.now())).messageId;
    const finalSession = await getSession(userId, sessionId);
    await pointsService.addPoints(userId, pointsService.CHAT_MESSAGE, `对话(离线): ${message.substring(0,30)}`);
    sendEnd(assistantMsgId, finalSession.title);
  }
});

// 对话摘要接口
router.post('/summarize', async (req, res) => {
  const { sessionId, messages: providedMessages } = req.body;
  const userId = req.user.userId;
  let conversationMessages = [];
  if (sessionId) {
    const session = await getSession(userId, sessionId);
    if (!session) return res.status(404).json({ error: '会话不存在' });
    conversationMessages = session.messages.slice(-20);
  } else if (providedMessages && Array.isArray(providedMessages)) {
    conversationMessages = providedMessages;
  } else {
    return res.status(400).json({ error: '请提供 sessionId 或 messages 数组' });
  }

  if (conversationMessages.length === 0) {
    return res.json({ summary: { points: [], status: '', reasons: [], suggestions: [], references: [] } });
  }

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
    let jsonStr = '';
    const firstBrace = summaryText.indexOf('{');
    const lastBrace = summaryText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = summaryText.substring(firstBrace, lastBrace + 1);
    } else {
      throw new Error('未找到有效的JSON对象');
    }
    let summary = JSON.parse(jsonStr);
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
    res.json({ summary: { points: [], status: '', reasons: [], suggestions: [], references: [] } });
  }
});

module.exports = router;