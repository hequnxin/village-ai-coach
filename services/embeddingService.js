require('dotenv').config();
const https = require('https');

// 阿里云百炼 OpenAI兼容模式接口
const API_KEY = process.env.DASHSCOPE_API_KEY;
const HOST = 'dashscope.aliyuncs.com';
const PATH = '/compatible-mode/v1/embeddings';

// 缓存
const cache = new Map();

// 指数退避重试
async function retryRequest(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
    }
  }
}

function getEmbedding(text) {
  if (!text || text.trim() === '') return Promise.resolve([]);
  const key = text.slice(0, 200);
  if (cache.has(key)) return Promise.resolve(cache.get(key));

  return retryRequest(() => new Promise((resolve, reject) => {
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
          if (res.statusCode !== 200) {
            console.error(`Embedding API 错误 ${res.statusCode}: ${data}`);
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const result = JSON.parse(data);
          if (!result.data || !result.data[0] || !result.data[0].embedding) {
            console.error('Embedding 响应格式错误:', result);
            reject(new Error('无效响应格式'));
            return;
          }
          const embedding = result.data[0].embedding;
          cache.set(key, embedding);
          resolve(embedding);
        } catch (err) {
          console.error('解析 embedding 响应失败:', err.message, data.substring(0, 200));
          reject(err);
        }
      });
    });

    req.on('error', err => {
      console.error('Embedding 请求失败:', err.message);
      reject(err);
    });
    req.write(postData);
    req.end();
  }), 2, 500);
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