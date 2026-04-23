const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
});

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