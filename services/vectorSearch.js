const db = require('./db');
const { getEmbedding, cosineSimilarity } = require('./embeddingService');
const { keywordSearch } = require('./knowledgeService');

let knowledgeVectors = [];
let isInitialized = false;
let embeddingFailed = false;

async function initVectorIndex() {
    const knowledge = await db.all(`SELECT id, title, content FROM knowledge WHERE status = $1`, ['approved']);
    if (knowledge.length === 0) {
        console.warn('知识库为空，向量索引跳过');
        return;
    }
    knowledgeVectors = [];
    for (const item of knowledge) {
        const text = `${item.title} ${item.content}`;
        try {
            const vector = await getEmbedding(text);
            knowledgeVectors.push({
                id: item.id,
                title: item.title,
                content: item.content,
                vector
            });
        } catch (err) {
            console.error(`向量化失败 ID:${item.id}`, err.message);
            knowledgeVectors.push({
                id: item.id,
                title: item.title,
                content: item.content,
                vector: null
            });
        }
    }
    isInitialized = true;
    console.log(`✅ 向量索引初始化完成，共 ${knowledgeVectors.length} 条`);
}

async function searchKnowledge(query, k = 3) {
    if (embeddingFailed) {
        return keywordSearch(query, k);
    }
    if (!isInitialized) {
        try {
            await initVectorIndex();
        } catch (err) {
            console.warn('向量索引初始化失败，使用关键词匹配降级', err);
            return keywordSearch(query, k);
        }
    }
    if (knowledgeVectors.length === 0) {
        return keywordSearch(query, k);
    }
    try {
        const queryVec = await getEmbedding(query);
        const results = knowledgeVectors
            .filter(item => item.vector !== null)
            .map(item => ({
                id: item.id,
                title: item.title,
                content: item.content,
                score: cosineSimilarity(queryVec, item.vector)
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, k);
        if (results.length === 0 || results[0].score < 0.3) {
            const kwResults = await keywordSearch(query, k);
            if (kwResults.length > 0) return kwResults;
        }
        return results;
    } catch (err) {
        console.error('向量检索失败，降级为关键词匹配', err);
        return keywordSearch(query, k);
    }
}

module.exports = { initVectorIndex, searchKnowledge };