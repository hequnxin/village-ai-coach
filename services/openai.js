// services/openai.js
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
});

/**
 * 非流式调用（用于摘要等不需要流式的场景）
 */
async function chat(messages, options = {}) {
  const completion = await openai.chat.completions.create({
    model: 'deepseek-chat',
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 800,
    stream: false,
  });
  return completion.choices[0].message.content;
}

/**
 * 流式调用
 * @param {Array} messages - 消息数组
 * @param {Object} options - 参数
 * @param {Function} onChunk - 每个chunk的回调，接收字符串片段
 * @returns {Promise<string>} 完整回复
 */
async function chatStream(messages, options = {}, onChunk) {
  const stream = await openai.chat.completions.create({
    model: 'deepseek-chat',
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 800,
    stream: true,
  });

  let fullContent = '';
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    if (content) {
      fullContent += content;
      if (onChunk) onChunk(content);
    }
  }
  return fullContent;
}

module.exports = { chat, chatStream };