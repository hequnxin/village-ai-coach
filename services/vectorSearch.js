const natural = require('natural');
const TfIdf = natural.TfIdf;
const db = require('./db');

let tfidf = null;
let documents = []; // { id, text }

function initVectorIndex() {
  const knowledge = db.prepare('SELECT id, title, content FROM knowledge WHERE status = ?').all('approved');
  if (knowledge.length === 0) return;
  tfidf = new TfIdf();
  knowledge.forEach((item) => {
    const text = `${item.title} ${item.content}`;
    tfidf.addDocument(text);
    documents.push({ id: item.id, text });
  });
}

function cosineSimilarity(vecA, vecB) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function getDocumentVector(docIndex) {
  const terms = tfidf.listTerms(docIndex);
  const vector = new Array(tfidf.documents.length).fill(0);
  terms.forEach(term => {
    vector[term.index] = term.tfidf;
  });
  return vector;
}

function searchKnowledge(query, k = 3) {
  if (!tfidf || tfidf.documents.length === 0) {
    // 降级：使用关键词匹配
    const { keywordSearch } = require('./knowledgeService');
    return keywordSearch(query, k);
  }
  // 将查询视为一个新文档，计算其向量
  const queryTfidf = new TfIdf();
  queryTfidf.addDocument(query);
  const queryTerms = queryTfidf.listTerms(0);
  const queryVector = new Array(tfidf.documents.length).fill(0);
  queryTerms.forEach(term => {
    queryVector[term.index] = term.tfidf;
  });
  // 计算每个文档的相似度
  const similarities = [];
  for (let i = 0; i < tfidf.documents.length; i++) {
    const docVector = getDocumentVector(i);
    const sim = cosineSimilarity(queryVector, docVector);
    similarities.push({ index: i, sim });
  }
  similarities.sort((a, b) => b.sim - a.sim);
  const topIndices = similarities.slice(0, k).map(s => s.index);
  const results = topIndices.map(idx => {
    const doc = documents[idx];
    const item = db.prepare('SELECT id, title, content, type, category, tags FROM knowledge WHERE id = ?').get(doc.id);
    return item;
  }).filter(Boolean);
  return results;
}

module.exports = { initVectorIndex, searchKnowledge };