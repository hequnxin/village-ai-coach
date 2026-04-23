require('dotenv').config();
const db = require('../services/db');
const knowledgeData = require('../knowledge.json');

async function importKnowledge() {
    console.log('开始导入知识库...');
    let count = 0;
    for (const k of knowledgeData) {
        const tagsStr = Array.isArray(k.tags) ? k.tags.join(',') : k.tags;
        try {
            await db.run(
                `INSERT INTO knowledge (id, title, content, source, status, tags, type, category, submitted_by, submitted_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 ON CONFLICT (id) DO NOTHING`,
                [k.id, k.title, k.content, k.source, k.status, tagsStr, k.type, k.category, k.submittedBy || 'system', k.submittedAt]
            );
            count++;
        } catch (err) {
            console.error(`导入失败 ${k.id}: ${err.message}`);
        }
    }
    console.log(`✅ 导入完成，共 ${count} 条知识`);

    // 导入完成后自动生成高质量题目
    console.log('开始从知识库自动生成题目...');
    const { generateAndStoreQuestions } = require('../services/questionGenerator');
    await generateAndStoreQuestions(100);
    console.log('题目生成完成');
}

importKnowledge().catch(console.error);