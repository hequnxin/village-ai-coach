const axios = require('axios');
const db = require('./db');

async function getKnowledgeBase() {
    const sql = `SELECT id, title, content, type, category, tags FROM knowledge WHERE status = $1`;
    return await db.all(sql, ['approved']);
}

async function keywordSearch(query, limit = 3) {
    const keywords = query.toLowerCase().split(/[\s,，。？?！!、]+/).filter(k => k.length > 1);
    const knowledge = await getKnowledgeBase();
    const results = knowledge.map(item => {
        const text = (item.title + ' ' + item.content).toLowerCase();
        let score = 0;
        keywords.forEach(kw => {
            if (text.includes(kw)) score += 1;
        });
        return { item, score };
    }).filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => r.item);
    return results;
}

async function webSearch(query, limit = 3) {
    if (!process.env.BAIDU_API_KEY) {
        console.warn('百度 API Key 未配置');
        return [];
    }
    try {
        const response = await axios.post(
            'https://qianfan.baidubce.com/v2/ai_search/web_search',
            {
                messages: [{ role: 'user', content: query }],
                search_source: 'baidu_search_v2',
                resource_type_filter: [{ type: 'web', top_k: limit }]
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.BAIDU_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        const references = response.data.references || [];
        return references.map(ref => ({
            title: ref.title || '',
            snippet: ref.content || '',
            link: ref.url || ''
        }));
    } catch (error) {
        console.error('百度搜索失败:', error.response?.data || error.message);
        return [];
    }
}

module.exports = { getKnowledgeBase, keywordSearch, webSearch };