const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../services/db');
const { chat } = require('../services/openai');
const { getKnowledgeBase } = require('../services/knowledgeService');

const router = express.Router();

// ========== 辅助函数：记录错题 ==========
async function recordWrongQuestion(userId, questionId, userAnswer) {
  const today = new Date().toISOString().slice(0, 10);
  const existing = await db.get('SELECT * FROM wrong_questions WHERE user_id = $1 AND question_id = $2', [userId, questionId]);
  if (existing) {
    await db.run('UPDATE wrong_questions SET wrong_count = wrong_count + 1, last_wrong_date = $1 WHERE id = $2', [today, existing.id]);
  } else {
    await db.run('INSERT INTO wrong_questions (id, user_id, question_id, wrong_count, last_wrong_date) VALUES ($1, $2, $3, $4, $5)',
      [uuidv4(), userId, questionId, 1, today]);
  }
}

// ========== 政策闯关关卡 ==========
router.get('/levels', async (req, res) => {
  const levels = await db.all('SELECT * FROM policy_levels ORDER BY order_num');
  const userId = req.user.userId;
  const progress = await db.all('SELECT level_id, completed FROM user_level_progress WHERE user_id = $1', [userId]);
  const progressMap = {};
  progress.forEach(p => { progressMap[p.level_id] = p.completed; });
  const result = levels.map(lvl => ({
    ...lvl,
    questions: JSON.parse(lvl.questions),
    completed: progressMap[lvl.id] === 1
  }));
  res.json(result);
});

router.get('/level/:levelId', async (req, res) => {
  const level = await db.get('SELECT * FROM policy_levels WHERE id = $1', [req.params.levelId]);
  if (!level) return res.status(404).json({ error: '关卡不存在' });
  const questionIds = JSON.parse(level.questions);
  if (!questionIds.length) return res.status(404).json({ error: '关卡题目为空' });
  const placeholders = questionIds.map((_, i) => `$${i+1}`).join(',');
  const questions = await db.all(`SELECT * FROM quiz_questions WHERE id IN (${placeholders})`, questionIds);
  res.json(questions.map(q => ({ ...q, options: JSON.parse(q.options) })));
});

router.post('/level/submit', async (req, res) => {
  const { levelId, answers } = req.body;
  const userId = req.user.userId;
  const level = await db.get('SELECT * FROM policy_levels WHERE id = $1', [levelId]);
  if (!level) return res.status(404).json({ error: '关卡不存在' });
  const questionIds = JSON.parse(level.questions);
  let correct = 0;
  for (let ans of answers) {
    const q = await db.get('SELECT answer FROM quiz_questions WHERE id = $1', [ans.questionId]);
    if (q && q.answer === ans.selected) correct++;
    else {
      await recordWrongQuestion(userId, ans.questionId, ans.selected);
    }
  }
  const passed = correct === questionIds.length;
  const existing = await db.get('SELECT * FROM user_level_progress WHERE user_id = $1 AND level_id = $2', [userId, levelId]);
  if (existing) {
    if (existing.completed === 1) return res.json({ passed: true, alreadyCompleted: true });
    await db.run('UPDATE user_level_progress SET completed = $1, score = $2, passed_at = $3 WHERE id = $4',
      [passed ? 1 : 0, correct, passed ? new Date().toISOString() : null, existing.id]);
  } else {
    await db.run('INSERT INTO user_level_progress (id, user_id, level_id, completed, score, passed_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [uuidv4(), userId, levelId, passed ? 1 : 0, correct, passed ? new Date().toISOString() : null]);
  }
  if (passed) {
    await db.run('INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)',
      [uuidv4(), userId, 50, `通关关卡：${level.name}`, new Date().toISOString()]);
  }
  res.json({ passed, correct, total: questionIds.length });
});

// ========== 每日一练 ==========
router.get('/daily', async (req, res) => {
  const userId = req.user.userId;
  const today = new Date().toISOString().slice(0, 10);
  let existing = await db.get('SELECT * FROM daily_quiz WHERE user_id = $1 AND quiz_date = $2', [userId, today]);
  if (existing) {
    const questions = await db.all(
      `SELECT q.id, q.type, q.question, q.options, q.answer, q.explanation, q.category
       FROM daily_quiz_questions dq JOIN quiz_questions q ON dq.question_id = q.id WHERE dq.quiz_id = $1`,
      [existing.id]
    );
    return res.json({
      quizId: existing.id,
      questions: questions.map(q => ({ ...q, options: JSON.parse(q.options) })),
      completed: existing.completed === 1,
      score: existing.score
    });
  }
  let questions = await db.all(`SELECT id, type, question, options, answer, explanation, category FROM quiz_questions ORDER BY RANDOM() LIMIT 5`);
  if (questions.length === 0) return res.status(404).json({ error: '暂无题目，请先运行种子脚本' });
  const quizId = uuidv4();
  const now = new Date().toISOString();
  await db.run('INSERT INTO daily_quiz (id, user_id, quiz_date, score, completed, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [quizId, userId, today, 0, 0, now]);
  for (let q of questions) {
    await db.run('INSERT INTO daily_quiz_questions (id, quiz_id, question_id) VALUES ($1, $2, $3)', [uuidv4(), quizId, q.id]);
  }
  res.json({
    quizId,
    questions: questions.map(q => ({ ...q, options: JSON.parse(q.options) })),
    completed: false
  });
});

router.post('/daily/submit', async (req, res) => {
  const { quizId, answers } = req.body;
  const userId = req.user.userId;
  const quiz = await db.get('SELECT * FROM daily_quiz WHERE id = $1 AND user_id = $2', [quizId, userId]);
  if (!quiz || quiz.completed) return res.status(400).json({ error: '无效或已提交' });
  let score = 0;
  for (let ans of answers) {
    const q = await db.get('SELECT answer FROM quiz_questions WHERE id = $1', [ans.questionId]);
    if (q && q.answer === ans.selected) score++;
    else {
      await recordWrongQuestion(userId, ans.questionId, ans.selected);
    }
  }
  await db.run('UPDATE daily_quiz SET score = $1, completed = 1 WHERE id = $2', [score, quizId]);
  const rewardPoints = score * 10 + (score === answers.length ? 20 : 0);
  await db.run('INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)',
    [uuidv4(), userId, rewardPoints, `每日一练得分${score}/${answers.length}`, new Date().toISOString()]);
  res.json({ score, total: answers.length, rewardPoints });
});

// ========== 填空每日5题 ==========
router.get('/fill-daily', async (req, res) => {
  const userId = req.user.userId;
  const today = new Date().toISOString().slice(0, 10);
  let fillDaily = await db.get('SELECT * FROM fill_daily WHERE user_id = $1 AND date = $2', [userId, today]);
  if (!fillDaily) {
    const questions = await db.all('SELECT * FROM fill_questions ORDER BY RANDOM() LIMIT 5');
    if (questions.length === 0) return res.status(404).json({ error: '暂无填空题目' });
    const fillId = uuidv4();
    await db.run('INSERT INTO fill_daily (id, user_id, date, questions, completed, score) VALUES ($1, $2, $3, $4, $5, $6)',
      [fillId, userId, today, JSON.stringify(questions), 0, 0]);
    fillDaily = { id: fillId, questions: questions, completed: 0 };
  } else {
    fillDaily.questions = JSON.parse(fillDaily.questions);
  }
  const hiddenQuestions = fillDaily.questions.map(q => ({
    id: q.id,
    sentence: q.sentence,
    hint: q.hint && q.hint.length > 15 ? q.hint.substring(0, 15) + '...' : (q.hint || '根据上下文填空')
  }));
  res.json({ questions: hiddenQuestions, completed: fillDaily.completed === 1 });
});

router.post('/fill-daily/submit', async (req, res) => {
  const { answers } = req.body;
  const userId = req.user.userId;
  const today = new Date().toISOString().slice(0, 10);
  const fillDaily = await db.get('SELECT * FROM fill_daily WHERE user_id = $1 AND date = $2 AND completed = 0', [userId, today]);
  if (!fillDaily) return res.status(400).json({ error: '今日填空已完成或不存在' });
  const questions = JSON.parse(fillDaily.questions);
  let correctCount = 0;
  for (let i = 0; i < questions.length; i++) {
    if (answers[i] && answers[i].trim().toLowerCase() === questions[i].correct_word.toLowerCase()) correctCount++;
  }
  const rewardPoints = correctCount * 5;
  await db.run('UPDATE fill_daily SET completed = 1, score = $1 WHERE id = $2', [correctCount, fillDaily.id]);
  if (rewardPoints > 0) {
    await db.run('INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)',
      [uuidv4(), userId, rewardPoints, `填空每日练答对${correctCount}题`, new Date().toISOString()]);
  }
  res.json({ correctCount, total: questions.length, rewardPoints });
});

// ========== 错题本 ==========
router.get('/wrong-questions/list', async (req, res) => {
  const userId = req.user.userId;
  const wrongs = await db.all(
    `SELECT w.question_id, w.wrong_count, w.last_wrong_date, q.question, q.options, q.answer, q.explanation, q.type, q.category
     FROM wrong_questions w JOIN quiz_questions q ON w.question_id = q.id
     WHERE w.user_id = $1 ORDER BY w.last_wrong_date DESC`,
    [userId]
  );
  res.json(wrongs.map(w => ({ ...w, options: JSON.parse(w.options) })));
});

router.post('/wrong-questions/clear', async (req, res) => {
  const { answers } = req.body;
  const userId = req.user.userId;
  let allCorrect = true;
  for (let ans of answers) {
    const q = await db.get('SELECT answer FROM quiz_questions WHERE id = $1', [ans.questionId]);
    if (!q || q.answer !== ans.selected) { allCorrect = false; break; }
  }
  if (allCorrect) {
    await db.run('DELETE FROM wrong_questions WHERE user_id = $1', [userId]);
    await db.run('INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)',
      [uuidv4(), userId, 50, '错题清零', new Date().toISOString()]);
    res.json({ cleared: true, rewardPoints: 50 });
  } else {
    res.json({ cleared: false });
  }
});

router.post('/wrong-questions/record', async (req, res) => {
  const { questionId, userAnswer } = req.body;
  const userId = req.user.userId;
  await recordWrongQuestion(userId, questionId, userAnswer);
  res.json({ success: true });
});

// ========== 每周竞赛 ==========
router.get('/weekly/current', async (req, res) => {
  const now = new Date();
  const day = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - day + (day === 0 ? -6 : 1));
  weekStart.setHours(0,0,0,0);
  const startStr = weekStart.toISOString().slice(0,10);
  let contest = await db.get('SELECT * FROM weekly_contest WHERE week_start = $1', [startStr]);
  if (!contest) {
    const countRes = await db.get('SELECT COUNT(*) as count FROM quiz_questions');
    if (countRes.count === 0) return res.status(404).json({ error: '暂无题目，请先运行种子脚本' });
    const questionIds = (await db.all(`SELECT id FROM quiz_questions ORDER BY RANDOM() LIMIT 10`)).map(q => q.id);
    const contestId = uuidv4();
    await db.run('INSERT INTO weekly_contest (id, week_start, week_end, questions, status) VALUES ($1, $2, $3, $4, $5)',
      [contestId, startStr, weekStart.toISOString().slice(0,10), JSON.stringify(questionIds), 'active']);
    contest = { id: contestId, week_start: startStr, questions: JSON.stringify(questionIds) };
  }
  const questionIds = JSON.parse(contest.questions);
  if (!questionIds.length) return res.status(404).json({ error: '竞赛题目为空' });
  const placeholders = questionIds.map((_, i) => `$${i+1}`).join(',');
  const questions = await db.all(`SELECT * FROM quiz_questions WHERE id IN (${placeholders})`, questionIds);
  res.json({ contestId: contest.id, questions: questions.map(q => ({ ...q, options: JSON.parse(q.options) })) });
});

router.post('/weekly/submit', async (req, res) => {
  const { contestId, answers, timeUsed } = req.body;
  const userId = req.user.userId;
  const contest = await db.get('SELECT * FROM weekly_contest WHERE id = $1', [contestId]);
  if (!contest || contest.status !== 'active') return res.status(400).json({ error: '竞赛已结束' });
  let correct = 0;
  for (let ans of answers) {
    const q = await db.get('SELECT answer FROM quiz_questions WHERE id = $1', [ans.questionId]);
    if (q && q.answer === ans.selected) correct++;
    else {
      await recordWrongQuestion(userId, ans.questionId, ans.selected);
    }
  }
  const existing = await db.get('SELECT * FROM weekly_contest_scores WHERE contest_id = $1 AND user_id = $2', [contestId, userId]);
  if (existing) {
    await db.run('UPDATE weekly_contest_scores SET score = $1, time_used = $2, submitted_at = $3 WHERE id = $4',
      [correct, timeUsed, new Date().toISOString(), existing.id]);
  } else {
    await db.run('INSERT INTO weekly_contest_scores (id, contest_id, user_id, score, time_used, submitted_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [uuidv4(), contestId, userId, correct, timeUsed, new Date().toISOString()]);
  }
  const points = correct * 5;
  await db.run('INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)',
    [uuidv4(), userId, points, `每周竞赛得分${correct}`, new Date().toISOString()]);
  res.json({ score: correct, total: answers.length, rewardPoints: points });
});

router.get('/weekly/rank/:contestId', async (req, res) => {
  const ranks = await db.all(
    `SELECT u.username, w.score, w.time_used
     FROM weekly_contest_scores w JOIN users u ON w.user_id = u.id
     WHERE w.contest_id = $1 ORDER BY w.score DESC, w.time_used ASC LIMIT 10`,
    [req.params.contestId]
  );
  res.json(ranks);
});

// ========== 刮刮乐 ==========
router.get('/scratch/generate', async (req, res) => {
  const userId = req.user.userId;
  const today = new Date().toISOString().slice(0,10);
  const count = (await db.get('SELECT COUNT(*) as c FROM scratch_cards WHERE user_id = $1 AND date(created_at) = $2', [userId, today])).c;
  if (count >= 3) return res.status(429).json({ error: '今日刮刮卡已达上限' });
  const question = await db.get(`SELECT id, question, options, answer FROM quiz_questions ORDER BY RANDOM() LIMIT 1`);
  if (!question) return res.status(404).json({ error: '暂无题目，请先运行种子脚本' });
  const cardId = uuidv4();
  await db.run('INSERT INTO scratch_cards (id, user_id, question_id, answer, reward_points, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [cardId, userId, question.id, question.answer, 0, new Date().toISOString()]);
  res.json({ cardId, question: question.question, options: JSON.parse(question.options) });
});

router.post('/scratch/submit', async (req, res) => {
  const { cardId, selected } = req.body;
  const userId = req.user.userId;
  const card = await db.get('SELECT * FROM scratch_cards WHERE id = $1 AND user_id = $2 AND is_used = 0', [cardId, userId]);
  if (!card) return res.status(400).json({ error: '无效刮刮卡' });
  const isCorrect = (card.answer === selected);
  let reward = 0;
  if (isCorrect) {
    reward = Math.floor(Math.random() * 20) + 10;
    await db.run('UPDATE scratch_cards SET is_used = 1, reward_points = $1, used_at = $2 WHERE id = $3',
      [reward, new Date().toISOString(), cardId]);
    await db.run('INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)',
      [uuidv4(), userId, reward, '刮刮乐奖励', new Date().toISOString()]);
  } else {
    await db.run('UPDATE scratch_cards SET is_used = 1, used_at = $1 WHERE id = $2', [new Date().toISOString(), cardId]);
  }
  res.json({ correct: isCorrect, rewardPoints: reward });
});

// ========== 积分添加接口 ==========
router.post('/add-points', async (req, res) => {
  const { points, reason } = req.body;
  const userId = req.user.userId;
  if (!points || points <= 0) return res.status(400).json({ error: '无效积分' });
  await db.run('INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)',
    [uuidv4(), userId, points, reason || '游戏奖励', new Date().toISOString()]);
  res.json({ success: true });
});

// ========== 从知识库生成题目 ==========
router.post('/generate-from-knowledge', async (req, res) => {
  const { topic, count = 5 } = req.body;
  if (!topic) return res.status(400).json({ error: '请提供知识点主题' });
  try {
    const knowledge = await getKnowledgeBase();
    let relevantText = '';
    if (knowledge.length) {
      const matched = knowledge.filter(k => k.title.includes(topic) || k.content.includes(topic));
      if (matched.length) relevantText = matched.slice(0, 3).map(k => `【${k.title}】${k.content.substring(0, 500)}`).join('\n');
      else relevantText = knowledge.slice(0, 3).map(k => `【${k.title}】${k.content.substring(0, 500)}`).join('\n');
    }
    const prompt = `你是一名乡村政策专家。请基于以下知识库内容，生成${count}道关于“${topic}”的选择题。要求每道题包含题干、4个选项、正确答案(0-3)、详细解析。输出JSON数组格式。知识库内容：${relevantText || '无'}`;
    const response = await chat([{ role: 'user', content: prompt }], { temperature: 0.6, max_tokens: 2000 });
    const match = response.match(/\[[\s\S]*\]/);
    const questions = JSON.parse(match ? match[0] : response);
    const inserted = [];
    for (const q of questions.slice(0, count)) {
      const id = `ai_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      await db.run(`INSERT INTO quiz_questions (id, type, question, options, answer, explanation, category, difficulty, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, 'choice', q.question, JSON.stringify(q.options), q.answer, q.explanation, topic, 2, new Date().toISOString()]);
      inserted.push({ id, question: q.question });
    }
    res.json({ success: true, count: inserted.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;