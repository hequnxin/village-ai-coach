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

// 预设问题列表
const PRESET_QUESTIONS = [
  '村里闲置小学可以改造成什么？',
  '土地流转合同要注意哪些条款？',
  '如何申请高标准农田项目？',
  '村民不配合垃圾分类怎么办？',
  '想发展民宿需要办哪些手续？'
];

// 预设问题的预置知识上下文（避免每次检索）
const PRESET_CONTEXT = {
  '村里闲置小学可以改造成什么？': `【相关知识库内容】
- 闲置小学盘活：可改造为村级养老服务中心、农产品加工车间、电商直播基地、村史馆、农家书屋、游客中心、特色民宿、农产品冷链仓库等。
- 操作建议：通过“四议两公开”决策改造方向，对接乡镇政府申请专项资金（每村10-30万元），改造为经营性场所需办理营业执照。
- 注意事项：保留房屋结构安全，不得改变土地性质。`,

  '土地流转合同要注意哪些条款？': `【相关知识库内容】
- 规范合同必须包含：流转双方信息（姓名、身份证号）、地块详情（位置、面积、四至边界，附测绘图）、流转期限（不得超过承包期剩余年限）、流转用途（必须保持农业用途）、租金及支付方式（明确日期和逾期责任）、违约责任（如改变用途的罚则）、争议解决方式（协商→调解→仲裁→诉讼）。
- 操作建议：使用农业农村部示范文本，签订后到乡镇经管站备案，鼓励通过产权交易平台公开流转。`,

  '如何申请高标准农田项目？': `【相关知识库内容】
- 申请流程：村级摸底（连片耕地≥300亩、水源有保障、群众意愿高）→编制方案→逐级申报（村级申请→乡镇审核→县级农业农村局立项）→专家评审→公示批复→组织实施→验收。
- 补助标准：每亩1500-3000元。
- 操作建议：每年3-5月集中申报，优先选择水源有保障的地块，可联合周边村打包申报。`,

  '村民不配合垃圾分类怎么办？': `【相关知识库内容】
- 六步工作法：干部带头分类挂牌示范户、积分激励（垃圾分类兑换超市）、简化分类（初期只分“会烂”和“不会烂”）、入户指导（网格员包户）、红黑榜公示、纳入村规民约（与分红挂钩但不罚款）。
- 操作建议：先选1-2个村民小组试点，每户发放两个不同颜色垃圾桶，确保分类后能分类收运。`,

  '想发展民宿需要办哪些手续？': `【相关知识库内容】
- 按顺序办理：选址合规（不占基本农田）→村民代表会议同意→营业执照（经营范围选“民宿服务”）→特种行业许可证（需消防验收）→卫生许可证（布草消毒、病媒防治）→食品经营许可证（若提供餐饮）→税务登记（月入10万以下免增值税）。
- 操作建议：先咨询乡镇旅游办了解扶持政策（每间客房补贴2000-5000元），可委托代办机构。`
};

// 异步生成回复
async function generateReplyAsync(sessionId, assistantMsgId, userId, userMessage, knowledgeContext, isPreset = false) {
  try {
    const session = await getSession(userId, sessionId);
    if (!session) {
      console.error(`会话不存在: ${sessionId}`);
      return;
    }

    // 直接进入生成状态（预设问题跳过检索状态）
    await db.run('UPDATE messages SET status = $1 WHERE id = $2', ['generating', assistantMsgId]);

    const history = (session.messages || []).slice(-10).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));

    let finalContext = knowledgeContext;
    if (isPreset && PRESET_CONTEXT[userMessage]) {
      finalContext = PRESET_CONTEXT[userMessage];
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: `用户问题：${userMessage}\n${finalContext}\n请回答。` }
    ];

    // 预设问题使用更小的 max_tokens 加快速度
    const maxTokens = isPreset ? 1200 : 2000;
    const temperature = isPreset ? 0.8 : 0.7;
    const reply = await chat(messages, { temperature, max_tokens: maxTokens });

    await db.run('UPDATE messages SET content = $1, status = $2 WHERE id = $3', [reply, 'completed', assistantMsgId]);
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

  // 判断是否为预设问题
  const isPreset = PRESET_QUESTIONS.includes(message.trim());

  let knowledgeContext = '';
  if (!isPreset) {
    // 非预设问题：正常知识检索
    let knowledgeResults = [];
    try {
      knowledgeResults = await searchKnowledge(message, 3);
    } catch (err) {
      console.warn('向量检索失败，使用关键词降级', err);
      knowledgeResults = await keywordSearch(message, 3);
    }
    if (knowledgeResults && knowledgeResults.length) {
      knowledgeContext = '\n\n【相关知识库内容】\n' + knowledgeResults.map(k => `- ${k.title}：${k.content.substring(0,200)}${k.content.length>200?'...':''}`).join('\n');
    }
  }

  // 创建占位 assistant 消息
  const assistantMsgId = uuidv4();
  await db.run(
    'INSERT INTO messages (id, session_id, role, content, status, timestamp) VALUES ($1, $2, $3, $4, $5, $6)',
    [assistantMsgId, sessionId, 'assistant', '正在准备...', 'pending', Date.now()]
  );

  // 异步生成回复
  generateReplyAsync(sessionId, assistantMsgId, userId, message, knowledgeContext, isPreset).catch(console.error);

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