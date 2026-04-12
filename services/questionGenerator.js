// services/questionGenerator.js
const db = require('./db');
const { chat } = require('./openai');

// ================== 辅助函数 ==================
function extractKeyword(text, fallback = '政策') {
  const stopWords = ['的', '了', '是', '在', '和', '与', '或', '等', '以及', '其中', '对于'];
  const words = text.split(/[\s，,。？?！!、；;：:]+/).filter(w =>
    w.length >= 2 && !/^\d+$/.test(w) && !stopWords.includes(w)
  );
  if (words.length === 0) return fallback;
  const freq = {};
  for (let w of words) freq[w] = (freq[w] || 0) + 1;
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  return sorted[0][0];
}

async function getDistractors(keyword, currentCategory, limit = 3) {
  const rows = await db.all(
    `SELECT title FROM knowledge WHERE status = 'approved' AND category != $1 ORDER BY RANDOM() LIMIT $2`,
    [currentCategory, limit * 2]
  );
  const candidates = rows.map(r => extractKeyword(r.title, r.title)).filter(k => k !== keyword);
  const unique = [...new Set(candidates)];
  return unique.slice(0, limit);
}

// ================== 选择题（单选） ==================
async function generateChoiceByRule(knowledge) {
  const keyword = extractKeyword(knowledge.content, knowledge.title);
  const distractors = await getDistractors(keyword, knowledge.category, 3);
  let options = [keyword, ...distractors];
  while (options.length < 4) options.push('以上都不对');
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  const answerIndex = options.indexOf(keyword);
  return {
    question_type: 'choice',
    question: `根据知识"${knowledge.title}"，以下哪个选项最符合？`,
    options: JSON.stringify(options),
    answer: String(answerIndex),
    explanation: `正确答案是"${keyword}"，因为：${knowledge.content.substring(0, 150)}`
  };
}

async function generateChoiceByAI(knowledge) {
  const prompt = `你是一名乡村政策出题专家。根据以下知识，生成一道四选一选择题。
要求：题目紧扣知识点，四个选项都与内容相关，只有一个正确，其余为合理干扰项。
知识标题：${knowledge.title}
知识内容：${knowledge.content.substring(0, 1200)}
输出JSON格式：{"question":"...","options":["...","...","...","..."],"answer":0,"explanation":"..."}`;
  try {
    const response = await chat([{ role: 'user', content: prompt }], { temperature: 0.6, max_tokens: 600 });
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      const obj = JSON.parse(match[0]);
      if (obj.question && obj.options?.length === 4 && typeof obj.answer === 'number') {
        return {
          question_type: 'choice',
          question: obj.question,
          options: JSON.stringify(obj.options),
          answer: String(obj.answer),
          explanation: obj.explanation || ''
        };
      }
    }
    return null;
  } catch (err) {
    console.error('AI生成选择题失败:', err.message);
    return null;
  }
}

async function generateChoice(knowledge, useAI = true) {
  if (useAI && process.env.DEEPSEEK_API_KEY) {
    const aiResult = await generateChoiceByAI(knowledge);
    if (aiResult) return aiResult;
  }
  return await generateChoiceByRule(knowledge);
}

// ================== 填空题 ==================
async function generateFillByRule(knowledge) {
  const keyword = extractKeyword(knowledge.content, knowledge.title);
  let sentence = knowledge.content.replace(new RegExp(keyword, 'g'), '__________');
  if (sentence.length > 200) sentence = sentence.substring(0, 200) + '......';
  let hint = `提示：这个关键词出现在"${knowledge.title}"中，属于"${knowledge.type}"领域。`;
  if (knowledge.category === '政策') hint = `提示：这是关于"${knowledge.title}"的一个核心政策术语。`;
  else if (knowledge.category === '案例') hint = `提示：这是案例"${knowledge.title}"中的一个关键措施或结果。`;
  else hint = `提示：根据"${knowledge.title}"的相关内容填写。`;
  return {
    question_type: 'fill',
    question: sentence,
    answer: keyword,
    hint: hint,
    explanation: `正确答案是"${keyword}"。`
  };
}

async function generateFillByAI(knowledge) {
  const prompt = `根据以下知识，生成一道填空题。挖去一个关键词，用__________代替，并给出正确答案和简短提示。
要求：提示不能直接说出答案，只能提供上下文线索（如所属类别、知识标题等），让用户思考。
知识标题：${knowledge.title}
知识内容：${knowledge.content.substring(0, 800)}
输出JSON：{"sentence":"...","correct_word":"...","hint":"..."}`;
  try {
    const response = await chat([{ role: 'user', content: prompt }], { temperature: 0.5, max_tokens: 300 });
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      const obj = JSON.parse(match[0]);
      if (obj.sentence && obj.correct_word) {
        return {
          question_type: 'fill',
          question: obj.sentence,
          answer: obj.correct_word,
          hint: obj.hint || '',
          explanation: `正确答案是"${obj.correct_word}"。`
        };
      }
    }
    return null;
  } catch (err) {
    console.error('AI生成填空题失败:', err.message);
    return null;
  }
}

async function generateFill(knowledge, useAI = true) {
  if (useAI && process.env.DEEPSEEK_API_KEY) {
    const aiResult = await generateFillByAI(knowledge);
    if (aiResult) return aiResult;
  }
  return await generateFillByRule(knowledge);
}

// ================== 判断题（仅AI生成） ==================
async function generateJudgeByAI(knowledge) {
  const prompt = `你是一名乡村政策出题专家。根据以下知识，生成一道判断题（正确/错误）。
要求：题目必须基于知识内容，判断点明确，不能模棱两可。
知识标题：${knowledge.title}
知识内容：${knowledge.content.substring(0, 800)}
输出JSON格式：{"question":"判断：...","answer":0或1,"explanation":"解析"}`;
  try {
    const response = await chat([{ role: 'user', content: prompt }], { temperature: 0.5, max_tokens: 300 });
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      const obj = JSON.parse(match[0]);
      if (obj.question && (obj.answer === 0 || obj.answer === 1)) {
        return {
          question_type: 'judge',
          question: obj.question,
          options: JSON.stringify(['正确', '错误']),
          answer: String(obj.answer),
          explanation: obj.explanation || ''
        };
      }
    }
    return null;
  } catch (err) {
    console.error('AI生成判断题失败:', err.message);
    return null;
  }
}

// ================== 排序题（仅AI生成） ==================
async function generateSortByAI(knowledge) {
  const prompt = `你是一名乡村政策出题专家。根据以下知识，生成一道排序题（将步骤按正确顺序排列）。
要求：知识中必须包含明确的流程、步骤或顺序。提取2-5个步骤。
知识标题：${knowledge.title}
知识内容：${knowledge.content.substring(0, 800)}
输出JSON格式：{"question":"请按正确顺序排列：...","options":["步骤1","步骤2",...],"answer":[0,1,2,...],"explanation":"正确顺序是..."}`;
  try {
    const response = await chat([{ role: 'user', content: prompt }], { temperature: 0.5, max_tokens: 500 });
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      const obj = JSON.parse(match[0]);
      if (obj.question && Array.isArray(obj.options) && obj.options.length >= 2 && Array.isArray(obj.answer)) {
        return {
          question_type: 'sort',
          question: obj.question,
          options: JSON.stringify(obj.options),
          answer: JSON.stringify(obj.answer),
          explanation: obj.explanation || ''
        };
      }
    }
    return null;
  } catch (err) {
    console.error('AI生成排序题失败:', err.message);
    return null;
  }
}

// ================== 统一生成入口（修复版：分别补充各题型） ==================
async function generateAndStoreQuestions(limit = 50, force = false) {
  // 获取各题型现有数量
  const existingChoice = (await db.get(`SELECT COUNT(*) as c FROM quiz_questions WHERE question_type = 'choice'`)).c;
  const existingFill = (await db.get(`SELECT COUNT(*) as c FROM quiz_questions WHERE question_type = 'fill'`)).c;
  const existingJudge = (await db.get(`SELECT COUNT(*) as c FROM quiz_questions WHERE question_type = 'judge'`)).c;
  const existingSort = (await db.get(`SELECT COUNT(*) as c FROM quiz_questions WHERE question_type = 'sort'`)).c;

  const target = limit;
  const needChoice = Math.max(0, target - existingChoice);
  const needFill = Math.max(0, target - existingFill);
  const needJudge = Math.max(0, target - existingJudge);
  const needSort = Math.max(0, target - existingSort);

  if (needChoice === 0 && needFill === 0 && needJudge === 0 && needSort === 0) {
    console.log(`所有题型已达到目标 ${target} 道，跳过生成`);
    return;
  }

  // 获取所有已审核的知识（随机顺序）
  let knowledge = await db.all(
    `SELECT id, title, content, type, category FROM knowledge WHERE status = 'approved' ORDER BY RANDOM()`
  );

  let choiceCount = 0, fillCount = 0, judgeCount = 0, sortCount = 0;

  for (const k of knowledge) {
    // 选择题（如果还需要）
    if (needChoice > 0 && choiceCount < needChoice) {
      const exists = await db.get(`SELECT id FROM quiz_questions WHERE id = $1`, [`auto_${k.id}_choice`]);
      if (!exists) {
        const choice = await generateChoice(k, true);
        if (choice) {
          await db.run(`INSERT INTO quiz_questions (id, type, question_type, question, options, answer, explanation, category, theme, difficulty, source_category, created_at)
            VALUES ($1, 'choice', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (id) DO NOTHING`,
            [`auto_${k.id}_choice`, choice.question_type, choice.question, choice.options, choice.answer, choice.explanation, k.category, k.type, 1, k.category, new Date().toISOString()]);
          choiceCount++;
        }
      }
    }

    // 填空题
    if (needFill > 0 && fillCount < needFill) {
      const exists = await db.get(`SELECT id FROM quiz_questions WHERE id = $1`, [`auto_${k.id}_fill`]);
      if (!exists) {
        const fill = await generateFill(k, true);
        if (fill) {
          await db.run(`INSERT INTO quiz_questions (id, type, question_type, question, options, answer, explanation, category, theme, difficulty, source_category, created_at)
            VALUES ($1, 'fill', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (id) DO NOTHING`,
            [`auto_${k.id}_fill`, fill.question_type, fill.question, fill.options || '[]', fill.answer, fill.explanation, k.category, k.type, 1, k.category, new Date().toISOString()]);
          fillCount++;
        }
      }
    }

    // 判断题：仅AI生成，需要配置 DEEPSEEK_API_KEY
    if (needJudge > 0 && judgeCount < needJudge && process.env.DEEPSEEK_API_KEY) {
      const judge = await generateJudgeByAI(k);
      if (judge) {
        await db.run(`INSERT INTO quiz_questions (id, type, question_type, question, options, answer, explanation, category, theme, difficulty, source_category, created_at)
          VALUES ($1, 'judge', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (id) DO NOTHING`,
          [`judge_${k.id}_${Date.now()}_${judgeCount}`, judge.question_type, judge.question, judge.options, judge.answer, judge.explanation, k.category, k.type, 1, k.category, new Date().toISOString()]);
        judgeCount++;
      } else {
        console.log(`⚠️  AI生成判断题失败，跳过知识：${k.id}`);
      }
    }

    // 排序题：仅AI生成，需要配置 DEEPSEEK_API_KEY
    if (needSort > 0 && sortCount < needSort && process.env.DEEPSEEK_API_KEY) {
      const sort = await generateSortByAI(k);
      if (sort) {
        await db.run(`INSERT INTO quiz_questions (id, type, question_type, question, options, answer, explanation, category, theme, difficulty, source_category, created_at)
          VALUES ($1, 'sort', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (id) DO NOTHING`,
          [`sort_${k.id}_${Date.now()}_${sortCount}`, sort.question_type, sort.question, sort.options, sort.answer, sort.explanation, k.category, k.type, 1, k.category, new Date().toISOString()]);
        sortCount++;
      } else {
        console.log(`⚠️  AI生成排序题失败，跳过知识：${k.id}`);
      }
    }

    if (choiceCount >= needChoice && fillCount >= needFill && judgeCount >= needJudge && sortCount >= needSort) break;
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`✅ 生成并存储：选择题 ${choiceCount} 道，填空题 ${fillCount} 道，判断题 ${judgeCount} 道，排序题 ${sortCount} 道`);
}

module.exports = { generateChoice, generateFill, generateJudgeByAI, generateSortByAI, generateAndStoreQuestions };