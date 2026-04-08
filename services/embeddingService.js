// 加载环境变量
require('dotenv').config();
const https = require('https');

// 🔥 【唯一正确】阿里云百炼 OpenAI兼容模式接口（永不404）
const API_KEY = process.env.DASHSCOPE_API_KEY;
const HOST = 'dashscope.aliyuncs.com';
const PATH = '/compatible-mode/v1/embeddings'; // 核心修复！

// 缓存
const cache = new Map();

function getEmbedding(text) {
  if (!text || text.trim() === '') return Promise.resolve([]);

  const key = text.slice(0, 200);
  if (cache.has(key)) return Promise.resolve(cache.get(key));

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: "text-embedding-v2",
      input: text
    });

    const options = {
      hostname: HOST,
      port: 443,
      path: PATH,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          const embedding = result.data[0].embedding;
          cache.set(key, embedding);
          resolve(embedding);
        } catch (err) {
          console.log('状态码:', res.statusCode, '返回:', data);
          reject('解析失败');
        }
      });
    });

    req.on('error', err => reject(err.message));
    req.write(postData);
    req.end();
  });
}

// 余弦相似度
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] ** 2;
    magB += vecB[i] ** 2;
  }
  return magA && magB ? dot / Math.sqrt(magA * magB) : 0;
}

module.exports = { getEmbedding, cosineSimilarity };