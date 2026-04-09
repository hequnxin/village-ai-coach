// scripts/generateQuestionsFromKnowledge.js
require('dotenv').config();
const db = require('../services/db');
const { chat } = require('../services/openai');
const { v4: uuidv4 } = require('uuid');

// 配置：每个专题生成的选择题数量
const CHOICE_PER_TYPE = 5;
// 每个专题生成的填空题数量
const FILL_PER_TYPE = 2;

// 生成一道选择题
async function generateChoiceQuestion(knowledge) {
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
        id: `choice_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        type: 'choice',
        question: q.question,
        options: JSON.stringify(q.options),
        answer: q.answer,
        explanation: q.explanation || '无解析',
        category: knowledge.type,
        difficulty: 1,
        created_at: new Date().toISOString()
      };
    }
  } catch (err) {
    console.error(`生成选择题失败 [${knowledge.id}]:`, err.message);
  }
  return null;
}

// 生成一道填空题
async function generateFillQuestion(knowledge) {
  const prompt = `你是一名乡村政策考试出题官。请根据以下知识内容，生成一道填空题。要求：
- 从知识中抽出一个关键词语作为填空处，用“______”表示
- 给出正确答案（即被挖去的词语）
- 提供一条简短提示（10字以内）

知识内容：
标题：${knowledge.title}
正文：${knowledge.content.substring(0, 800)}

输出格式（纯JSON）：
{
  "sentence": "带有______的句子",
  "correct_word": "正确答案",
  "hint": "提示"
}`;

  try {
    const response = await chat([{ role: 'user', content: prompt }], { temperature: 0.5, max_tokens: 300 });
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const f = JSON.parse(jsonMatch[0]);
      return {
        id: `fill_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        sentence: f.sentence,
        correct_word: f.correct_word,
        hint: f.hint || '根据上下文填空',
        category: knowledge.type,
        created_at: new Date().toISOString()
      };
    }
  } catch (err) {
    console.error(`生成填空题失败 [${knowledge.id}]:`, err.message);
  }
  return null;
}

async function generateQuestionsFromKnowledge() {
  console.log('开始从知识库生成题目（选择题 + 填空题）...');

  // 获取所有已审核的知识，按专题分组
  const knowledgeList = await db.all(`SELECT id, title, content, type FROM knowledge WHERE status = 'approved'`);
  if (knowledgeList.length === 0) {
    console.log('知识库为空，跳过生成');
    return;
  }

  const typeMap = new Map();
  for (const k of knowledgeList) {
    if (!typeMap.has(k.type)) typeMap.set(k.type, []);
    typeMap.get(k.type).push(k);
  }

  const generatedChoices = [];
  const generatedFills = [];

  for (const [type, items] of typeMap.entries()) {
    console.log(`\n===== 专题【${type}】共有 ${items.length} 条知识 =====`);

    // 生成选择题
    const choiceLimit = Math.min(items.length, CHOICE_PER_TYPE);
    console.log(`  生成 ${choiceLimit} 道选择题...`);
    for (let i = 0; i < choiceLimit; i++) {
      const q = await generateChoiceQuestion(items[i]);
      if (q) generatedChoices.push(q);
      await new Promise(r => setTimeout(r, 1000)); // 避免限流
    }

    // 生成填空题
    const fillLimit = Math.min(items.length, FILL_PER_TYPE);
    console.log(`  生成 ${fillLimit} 道填空题...`);
    for (let i = 0; i < fillLimit; i++) {
      const f = await generateFillQuestion(items[i]);
      if (f) generatedFills.push(f);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // 插入选择题到 quiz_questions
  if (generatedChoices.length > 0) {
    for (const q of generatedChoices) {
      await db.run(
        `INSERT INTO quiz_questions (id, type, question, options, answer, explanation, category, difficulty, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [q.id, q.type, q.question, q.options, q.answer, q.explanation, q.category, q.difficulty, q.created_at]
      );
    }
    console.log(`✅ 成功插入 ${generatedChoices.length} 道选择题`);
  } else {
    console.log('⚠️ 未生成任何选择题');
  }

  // 插入填空题到 fill_questions
  if (generatedFills.length > 0) {
    for (const f of generatedFills) {
      await db.run(
        `INSERT INTO fill_questions (id, sentence, correct_word, hint, category)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [f.id, f.sentence, f.correct_word, f.hint, f.category]
      );
    }
    console.log(`✅ 成功插入 ${generatedFills.length} 道填空题`);
  } else {
    console.log('⚠️ 未生成任何填空题');
  }

  // 创建/更新政策闯关关卡（仅选择题）
  const questionByType = new Map();
  for (const q of generatedChoices) {
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
      // 合并题目去重
      const oldIds = JSON.parse(existing.questions || '[]');
      const newIds = [...new Set([...oldIds, ...qids])];
      await db.run(`UPDATE policy_levels SET questions = $1 WHERE id = $2`, [JSON.stringify(newIds), existing.id]);
      console.log(`更新关卡 ${type}闯关，题目数 ${newIds.length}`);
    }
  }

  console.log('\n🎉 所有题目生成完毕！');
}

// 如果直接运行此脚本，则执行生成
if (require.main === module) {
  generateQuestionsFromKnowledge().catch(console.error);
}

module.exports = { generateQuestionsFromKnowledge };