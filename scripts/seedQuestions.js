require('dotenv').config();
const db = require('../services/db');

async function seedQuestions() {
  try {
    const count = await db.get('SELECT COUNT(*) as cnt FROM quiz_questions');
    if (count.cnt > 0) {
      console.log(`✅ 已有 ${count.cnt} 道题目，跳过插入`);
      process.exit(0);
    }
    const now = new Date().toISOString();
    const defaultQuestions = [
      { id: 'q1', type: 'choice', question: '宅基地三权分置不包括以下哪一项？', options: '["所有权","资格权","使用权","经营权"]', answer: 3, explanation: '三权分置是指所有权、资格权、使用权分置。', category: '土地管理', difficulty: 1, created_at: now },
      { id: 'q2', type: 'choice', question: '"四议两公开"中"两公开"是指？', options: '["决议公开、结果公开","过程公开、结果公开","决议公开、财务公开","结果公开、监督公开"]', answer: 0, explanation: '两公开是决议公开和实施结果公开。', category: '基层治理', difficulty: 1, created_at: now },
      { id: 'q3', type: 'choice', question: '农民专业合作社至少需要多少名成员？', options: '["3","5","7","10"]', answer: 1, explanation: '根据《农民专业合作社法》，至少需要5名成员。', category: '产业发展', difficulty: 1, created_at: now },
      { id: 'q4', type: 'choice', question: '农村低保申请审批一般需要多少个工作日？', options: '["15","30","45","60"]', answer: 1, explanation: '一般30个工作日左右。', category: '民生保障', difficulty: 1, created_at: now },
      { id: 'q5', type: 'choice', question: '以下哪项不属于乡村振兴促进法的主要内容？', options: '["永久基本农田保护","农民收入稳定增长","城市人口向乡村迁移","传统村落保护"]', answer: 2, explanation: '鼓励城市人才向乡村流动，但不是人口迁移。', category: '政策法规', difficulty: 2, created_at: now }
    ];
    for (const q of defaultQuestions) {
      await db.run(`INSERT INTO quiz_questions (id, type, question, options, answer, explanation, category, difficulty, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [q.id, q.type, q.question, q.options, q.answer, q.explanation, q.category, q.difficulty, q.created_at]);
    }
    console.log(`✅ 插入了 ${defaultQuestions.length} 道默认题目`);
  } catch (err) {
    console.error('种子脚本执行失败:', err);
  } finally {
    process.exit(0);
  }
}

seedQuestions();