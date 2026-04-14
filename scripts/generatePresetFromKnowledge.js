// scripts/generatePresetFromKnowledge.js
require('dotenv').config();
const db = require('../services/db');
const knowledgeData = require('../knowledge.json');
const { chat } = require('../services/openai');

// 生成预设答案的 prompt
const generatePrompt = (item) => {
    return `你是一名乡村治理专家。请根据以下知识内容，生成一个“预设答案”，包含三个部分：原因分析、具体措施/政策要点、操作建议、引导思考。格式如下：

【原因分析】
（1-2句话分析该问题的背景或原因）

【具体措施】
（分点列出核心措施或政策要点，每条一行，用数字序号）

【操作建议】
（1-2条实际可操作的建议）

【引导思考】
（1个引导用户继续提问的问题）

知识标题：${item.title}
知识内容：${item.content.substring(0, 1500)}
知识类型：${item.type}，分类：${item.category}

请直接输出上述格式的预设答案，不要输出其他内容。`;
};

async function generatePresetAnswer(item) {
    if (!process.env.DEEPSEEK_API_KEY) {
        // 无 AI 时使用简单模板
        return `【原因分析】
${item.content.substring(0, 100)}...

【具体措施】
${item.content.substring(100, 500)}...

【操作建议】
1. 建议咨询当地乡镇相关部门获取最新政策文件。
2. 可根据本村实际情况调整实施细节。

【引导思考】
您村是否遇到类似情况？欢迎进一步提问。`;
    }
    try {
        const prompt = generatePrompt(item);
        const answer = await chat([{ role: 'user', content: prompt }], { temperature: 0.5, max_tokens: 800 });
        return answer;
    } catch (err) {
        console.error(`生成预设答案失败: ${item.id}`, err.message);
        return null;
    }
}

// 提取关键词
function extractKeywords(text) {
    const stopWords = ['的', '了', '是', '在', '和', '与', '或', '等', '以及', '其中', '对于'];
    const words = text.split(/[\s,，。？?！!、；;：:]+/).filter(w => w.length >= 2 && !stopWords.includes(w));
    return [...new Set(words)].slice(0, 10);
}

async function generatePresetFromKnowledge() {
    console.log('开始从知识库生成预设问答...');
    // 筛选政策、常见问题、案例（可根据需要调整）
    const targetItems = knowledgeData.filter(item =>
        item.status === 'approved' &&
        (item.category === '政策' || item.category === '常见问题' || item.type === '政策法规')
    );
    console.log(`找到 ${targetItems.length} 条知识适合生成预设问答`);

    let inserted = 0;
    for (const item of targetItems) {
        // 检查是否已存在相同问题的预设
        const existing = await db.get(`SELECT id FROM preset_qa WHERE question = $1`, [item.title]);
        if (existing) {
            console.log(`跳过已存在: ${item.title}`);
            continue;
        }

        console.log(`生成预设: ${item.title}`);
        const answer = await generatePresetAnswer(item);
        if (!answer) continue;

        const keywords = extractKeywords(item.title + ' ' + (item.tags || ''));
        await db.run(
            `INSERT INTO preset_qa (question, answer, category, keywords, priority, is_active) 
             VALUES ($1, $2, $3, $4, $5, true)`,
            [item.title, answer, item.category, keywords, 5]
        );
        inserted++;

        // 避免请求过快
        await new Promise(r => setTimeout(r, 500));
    }
    console.log(`✅ 成功生成 ${inserted} 条预设问答`);
    await db.pool.end();
}

generatePresetFromKnowledge().catch(console.error);