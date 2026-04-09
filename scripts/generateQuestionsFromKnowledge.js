// scripts/generateQuestionsFromKnowledge.js
require('dotenv').config();
const db = require('../services/db');
const { chat } = require('../services/openai');
const { v4: uuidv4 } = require('uuid');

// 为一条知识生成一道选择题
async function generateQuestion(knowledge) {
  const prompt = `你是一名乡村政策考试出题官。请根据以下知识内容，生成一道四选一的选择题。要求：
- 题目紧扣知识要点
- 四个选项，其中只有一个正确
- 给出正确答案的索引（0-3）和解析

知识内容：
标题：${knowledge.title}
正文：${knowledge.content.substring(0, 800)}

输出格式（纯JSON）：
{
  "question": "题目文本",
  "options": ["选项A", "选项B", "选项C", "选项D"],
  "answer": 0,
  "explanation": "解析文本"
}`;

  try {
    const response = await chat([{ role: 'user', content: prompt }], { temperature: 0.5, max_tokens: 500 });
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const q = JSON.parse(jsonMatch[0]);
      return {
        id: `gen_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        type: 'choice',
        question: q.question,
        options: JSON.stringify(q.options),
        answer: q.answer,
        explanation: q.explanation || '无解析',
        category: knowledge.type,      // 使用知识的专题作为分类
        difficulty: 1,
        created_at: new Date().toISOString()
      };
    }
  } catch (err) {
    console.error(`生成题目失败 [${knowledge.id}]:`, err.message);
  }
  return null;
}

// 主函数：从知识库生成题目并创建关卡
async function generateQuestionsFromKnowledge() {
  console.log('开始从知识库生成题目...');
  // 获取所有已审核的知识
  const knowledgeList = await db.all(`SELECT id, title, content, type FROM knowledge WHERE status = 'approved'`);
  if (knowledgeList.length === 0) {
    console.log('知识库为空，跳过生成');
    return;
  }

  // 按专题分组
  const typeMap = new Map();
  for (const k of knowledgeList) {
    if (!typeMap.has(k.type)) typeMap.set(k.type, []);
    typeMap.get(k.type).push(k);
  }

  const generatedQuestions = [];
  for (const [type, items] of typeMap.entries()) {
    // 每个专题最多生成5题（避免API调用过多）
    const limit = Math.min(items.length, 5);
    console.log(`专题【${type}】共有 ${items.length} 条知识，将生成 ${limit} 道题目`);
    for (let i = 0; i < limit; i++) {
      const q = await generateQuestion(items[i]);
      if (q) generatedQuestions.push(q);
      // 避免API限流，间隔1秒
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  if (generatedQuestions.length === 0) {
    console.log('没有生成任何题目');
    return;
  }

  // 插入题目到 quiz_questions（避免重复）
  for (const q of generatedQuestions) {
    await db.run(
      `INSERT INTO quiz_questions (id, type, question, options, answer, explanation, category, difficulty, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [q.id, q.type, q.question, q.options, q.answer, q.explanation, q.category, q.difficulty, q.created_at]
    );
  }
  console.log(`✅ 成功生成并插入 ${generatedQuestions.length} 道题目`);

  // 按专题创建或更新关卡
  const questionByType = new Map();
  for (const q of generatedQuestions) {
    if (!questionByType.has(q.category)) questionByType.set(q.category, []);
    questionByType.get(q.category).push(q.id);
  }

  let levelOrder = 1;
  for (const [type, qids] of questionByType.entries()) {
    const existing = await db.get(`SELECT id, questions FROM policy_levels WHERE name = $1`, [type + '闯关']);
    if (!existing) {
      const levelId = uuidv4();
      await db.run(
        `INSERT INTO policy_levels (id, name, category, order_num, questions)
         VALUES ($1, $2, $3, $4, $5)`,
        [levelId, `${type}闯关`, type, levelOrder++, JSON.stringify(qids)]
      );
      console.log(`创建关卡：${type}闯关，包含 ${qids.length} 题`);
    } else {
      // 已有关卡，合并题目（去重）
      const oldIds = JSON.parse(existing.questions || '[]');
      const newIds = [...new Set([...oldIds, ...qids])];
      await db.run(`UPDATE policy_levels SET questions = $1 WHERE id = $2`, [JSON.stringify(newIds), existing.id]);
      console.log(`更新关卡 ${type}闯关，题目数 ${newIds.length}`);
    }
  }
  console.log('关卡创建/更新完成');
}

// 如果直接运行此脚本，则执行生成
if (require.main === module) {
  generateQuestionsFromKnowledge().catch(console.error);
}

module.exports = { generateQuestionsFromKnowledge };