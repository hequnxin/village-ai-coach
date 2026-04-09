// services/questionGenerator.js
const db = require('./db');
const { chat } = require('./openai');

/**
 * 从文本中提取关键词（用于答案）
 */
function extractKeyword(text, fallback = '政策') {
    const words = text.split(/[\s，,。？?！!、；;：:]+/).filter(w => w.length >= 2 && !/^\d+$/.test(w));
    if (words.length === 0) return fallback;
    const freq = {};
    for (let w of words) freq[w] = (freq[w] || 0) + 1;
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    return sorted[0][0];
}

/**
 * 从知识库中随机获取不同主题的关键词作为干扰项
 */
async function getDistractors(keyword, currentCategory, limit = 3) {
    const rows = await db.all(
        `SELECT title FROM knowledge WHERE status = 'approved' AND category != ? ORDER BY RANDOM() LIMIT ?`,
        [currentCategory, limit * 2]
    );
    const candidates = rows.map(r => extractKeyword(r.title, r.title)).filter(k => k !== keyword);
    const unique = [...new Set(candidates)];
    return unique.slice(0, limit);
}

/**
 * 规则生成选择题（不依赖AI）
 */
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
        question: `根据知识“${knowledge.title}”，以下哪个选项最符合？`,
        options: options,
        answer: answerIndex,
        explanation: `正确答案是“${keyword}”，因为：${knowledge.content.substring(0, 150)}`
    };
}

/**
 * AI生成选择题（质量高，但消耗token）
 */
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
                return obj;
            }
        }
        return null;
    } catch (err) {
        console.error('AI生成选择题失败:', err.message);
        return null;
    }
}

/**
 * 对外接口：生成选择题（优先AI，失败则规则）
 */
async function generateChoice(knowledge, useAI = true) {
    if (useAI && process.env.DEEPSEEK_API_KEY) {
        const aiResult = await generateChoiceByAI(knowledge);
        if (aiResult) return aiResult;
    }
    return await generateChoiceByRule(knowledge);
}

/**
 * 规则生成填空题
 */
async function generateFillByRule(knowledge) {
    const keyword = extractKeyword(knowledge.content, knowledge.title);
    let sentence = knowledge.content.replace(new RegExp(keyword, 'g'), '______');
    if (sentence.length > 200) sentence = sentence.substring(0, 200) + '……';
    return {
        sentence: sentence,
        correct_word: keyword,
        hint: `提示：关于“${knowledge.title}”的关键词`
    };
}

/**
 * AI生成填空题
 */
async function generateFillByAI(knowledge) {
    const prompt = `根据以下知识，生成一道填空题。挖去一个关键词，用______代替，并给出正确答案和简短提示。
知识标题：${knowledge.title}
知识内容：${knowledge.content.substring(0, 800)}
输出JSON：{"sentence":"...","correct_word":"...","hint":"..."}`;
    try {
        const response = await chat([{ role: 'user', content: prompt }], { temperature: 0.5, max_tokens: 300 });
        const match = response.match(/\{[\s\S]*\}/);
        if (match) {
            const obj = JSON.parse(match[0]);
            if (obj.sentence && obj.correct_word) return obj;
        }
        return null;
    } catch (err) {
        console.error('AI生成填空题失败:', err.message);
        return null;
    }
}

/**
 * 对外接口：生成填空题（优先AI，失败则规则）
 */
async function generateFill(knowledge, useAI = true) {
    if (useAI && process.env.DEEPSEEK_API_KEY) {
        const aiResult = await generateFillByAI(knowledge);
        if (aiResult) return aiResult;
    }
    return await generateFillByRule(knowledge);
}

/**
 * 批量生成题目并存入数据库（用于初始化，幂等）
 */
async function generateAndStoreQuestions(limit = 50) {
    // 幂等检查：如果 quiz_questions 已有数据，则跳过生成
    const existingCount = await db.get(`SELECT COUNT(*) as count FROM quiz_questions`);
    if (existingCount.count > 0) {
        console.log(`已有 ${existingCount.count} 道选择题，跳过自动生成`);
        return;
    }

    const knowledge = await db.all(`SELECT id, title, content, type, category FROM knowledge WHERE status = 'approved' ORDER BY RANDOM() LIMIT ?`, [limit]);
    let choiceCount = 0, fillCount = 0;
    for (const k of knowledge) {
        // 生成选择题
        const choice = await generateChoice(k, false); // 先用规则快速生成
        if (choice) {
            await db.run(`INSERT OR IGNORE INTO quiz_questions (id, type, question, options, answer, explanation, category, theme, difficulty, created_at)
                VALUES (?, 'choice', ?, ?, ?, ?, ?, ?, ?, ?)`,
                [`auto_${k.id}_choice`, choice.question, JSON.stringify(choice.options), choice.answer, choice.explanation, k.category, k.type, 1, new Date().toISOString()]);
            choiceCount++;
        }
        // 生成填空题
        const fill = await generateFill(k, false);
        if (fill) {
            await db.run(`INSERT OR IGNORE INTO fill_questions (id, sentence, correct_word, hint, category) VALUES (?, ?, ?, ?, ?)`,
                [`auto_${k.id}_fill`, fill.sentence, fill.correct_word, fill.hint, k.type]);
            fillCount++;
        }
        await new Promise(r => setTimeout(r, 100));
    }
    console.log(`✅ 生成并存储选择题 ${choiceCount} 道，填空题 ${fillCount} 道`);
}

module.exports = { generateChoice, generateFill, generateAndStoreQuestions };