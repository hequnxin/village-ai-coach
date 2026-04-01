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
  });
  return completion.choices[0].message.content;
}

module.exports = { chat };