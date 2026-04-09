const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../services/db');
const { chat } = require('../services/openai');

const router = express.Router();

// ==================== 每日一练 ====================
router.get('/daily', async (req, res) => {
  const userId = req.user.userId;
  const today = new Date().toISOString().slice(0, 10);
  let existing = await db.get('SELECT * FROM daily_quiz WHERE user_id = $1 AND quiz_date = $2', [userId, today]);
  if (existing) {
    const questions = await db.all(
      `SELECT q.id, q.type, q.question, q.options, q.answer, q.explanation, q.category
       FROM daily_quiz_questions dq
       JOIN quiz_questions q ON dq.question_id = q.id
       WHERE dq.quiz_id = $1`,
      [existing.id]
    );
    return res.json({
      quizId: existing.id,
      questions: questions.map(q => ({ ...q, options: JSON.parse(q.options) })),
      completed: existing.completed === 1,
      score: existing.score
    });
  }
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const yesterdayQuiz = await db.get('SELECT id FROM daily_quiz WHERE user_id = $1 AND quiz_date = $2', [userId, yesterdayStr]);
  let excludeIds = [];
  if (yesterdayQuiz) {
    const yesterdayQuestions = await db.all('SELECT question_id FROM daily_quiz_questions WHERE quiz_id = $1', [yesterdayQuiz.id]);
    excludeIds = yesterdayQuestions.map(q => q.question_id);
  }
  let sql = `SELECT id, type, question, options, answer, explanation, category FROM quiz_questions`;
  let params = [];
  if (excludeIds.length > 0) {
    sql += ` WHERE id NOT IN (${excludeIds.map((_, i) => `$${i+1}`).join(',')})`;
    params = excludeIds;
  }
  sql += ` ORDER BY RANDOM() LIMIT 5`;
  let questions = await db.all(sql, params);
  if (questions.length < 5) {
    questions = await db.all(`SELECT id, type, question, options, answer, explanation, category FROM quiz_questions ORDER BY RANDOM() LIMIT 5`);
  }
  const quizId = uuidv4();
  const now = new Date().toISOString();
  await db.run(
    'INSERT INTO daily_quiz (id, user_id, quiz_date, score, completed, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [quizId, userId, today, 0, 0, now]
  );
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
  const today = new Date().toISOString().slice(0, 10);
  const quiz = await db.get('SELECT * FROM daily_quiz WHERE id = $1 AND user_id = $2', [quizId, userId]);
  if (!quiz || quiz.completed) return res.status(400).json({ error: '无效或已提交' });
  let score = 0;
  const wrongList = [];
  for (let ans of answers) {
    const question = await db.get('SELECT answer FROM quiz_questions WHERE id = $1', [ans.questionId]);
    if (question && question.answer === ans.selected) {
      score++;
    } else {
      wrongList.push(ans.questionId);
    }
  }
  await db.run('UPDATE daily_quiz SET score = $1, completed = 1 WHERE id = $2', [score, quizId]);
  for (let qid of wrongList) {
    const existing = await db.get('SELECT * FROM wrong_questions WHERE user_id = $1 AND question_id = $2', [userId, qid]);
    if (existing) {
      await db.run('UPDATE wrong_questions SET wrong_count = wrong_count + 1, last_wrong_date = $1 WHERE id = $2', [today, existing.id]);
    } else {
      await db.run('INSERT INTO wrong_questions (id, user_id, question_id, wrong_count, last_wrong_date) VALUES ($1, $2, $3, $4, $5)',
        [uuidv4(), userId, qid, 1, today]);
    }
  }
  let rewardPoints = score * 10;
  if (score === answers.length) rewardPoints += 20;
  await db.run('INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)',
    [uuidv4(), userId, rewardPoints, `每日一练得分${score}/${answers.length}`, new Date().toISOString()]);
  res.json({ score, total: answers.length, rewardPoints, wrongQuestions: wrongList });
});

// ==================== 错题本 ====================
router.get('/wrong-questions', async (req, res) => {
  const userId = req.user.userId;
  const wrongs = await db.all(
    `SELECT w.question_id, w.wrong_count, w.last_wrong_date, q.question, q.options, q.answer, q.explanation, q.type, q.category
     FROM wrong_questions w
     JOIN quiz_questions q ON w.question_id = q.id
     WHERE w.user_id = $1
     ORDER BY w.last_wrong_date DESC`,
    [userId]
  );
  res.json(wrongs.map(w => ({ ...w, options: JSON.parse(w.options) })));
});

// ==================== 填空每日5题 ====================
router.get('/fill-daily', async (req, res) => {
  const userId = req.user.userId;
  const today = new Date().toISOString().slice(0, 10);
  let fillDaily = await db.get('SELECT * FROM fill_daily WHERE user_id = $1 AND date = $2', [userId, today]);
  if (!fillDaily) {
    const questions = await db.all('SELECT * FROM fill_questions ORDER BY RANDOM() LIMIT 5');
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
    if (answers[i] && answers[i].trim().toLowerCase() === questions[i].correct_word.toLowerCase()) {
      correctCount++;
    }
  }
  const rewardPoints = correctCount * 5;
  await db.run('UPDATE fill_daily SET completed = 1, score = $1 WHERE id = $2', [correctCount, fillDaily.id]);
  if (rewardPoints > 0) {
    await db.run('INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)',
      [uuidv4(), userId, rewardPoints, `填空每日练答对${correctCount}题`, new Date().toISOString()]);
  }
  res.json({ correctCount, total: questions.length, rewardPoints });
});

// ==================== 限时挑战 ====================
router.get('/timed-challenge', async (req, res) => {
  const questions = await db.all(`SELECT id, type, question, options, answer, category FROM quiz_questions ORDER BY RANDOM() LIMIT 10`);
  res.json(questions.map(q => ({ ...q, options: JSON.parse(q.options) })));
});

router.post('/timed-challenge/submit', async (req, res) => {
  const { answers, timeLeft } = req.body;
  const userId = req.user.userId;
  let correctCount = 0;
  for (let ans of answers) {
    const question = await db.get('SELECT answer FROM quiz_questions WHERE id = $1', [ans.questionId]);
    if (question && question.answer === ans.selected) correctCount++;
  }
  let rewardPoints = correctCount * 5;
  if (timeLeft > 0) rewardPoints += Math.floor(timeLeft / 2);
  await db.run('INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)',
    [uuidv4(), userId, rewardPoints, `限时挑战答对${correctCount}题`, new Date().toISOString()]);
  res.json({ correctCount, total: answers.length, rewardPoints });
});

// ==================== 政策匹配游戏 ====================
router.get('/matching-game', (req, res) => {
  const matches = [
    { left: "宅基地三权分置", right: "所有权、资格权、使用权分置" },
    { left: "四议两公开", right: "党支部提议、两委会商议、党员大会审议、村民代表会议决议，决议公开、结果公开" },
    { left: "雨露计划", right: "贫困家庭子女职业教育补助政策" },
    { left: "一事一议", right: "村级公益事业建设村民筹资筹劳制度" },
    { left: "防返贫监测机制", right: "对脱贫户进行动态监测，防止返贫" }
  ];
  res.json(matches);
});

// ==================== 积分商城 ====================
router.get('/shop/items', async (req, res) => {
  const items = await db.all('SELECT * FROM shop_items ORDER BY price');
  res.json(items);
});

router.post('/shop/buy', async (req, res) => {
  const { itemId } = req.body;
  const userId = req.user.userId;
  const item = await db.get('SELECT * FROM shop_items WHERE id = $1', [itemId]);
  if (!item) return res.status(404).json({ error: '物品不存在' });
  const sessionCount = (await db.get('SELECT COUNT(*) as c FROM sessions WHERE user_id = $1', [userId])).c;
  const favoriteCount = (await db.get('SELECT COUNT(*) as c FROM favorites WHERE user_id = $1', [userId])).c;
  const favoriteSessionCount = (await db.get('SELECT COUNT(*) as c FROM sessions WHERE user_id = $1 AND favorite = 1', [userId])).c;
  const approvedUploads = (await db.get('SELECT COUNT(*) as c FROM knowledge WHERE submitted_by = $1 AND status = $2', [req.user.username, 'approved'])).c;
  const basePoints = sessionCount * 10 + favoriteCount * 2 + favoriteSessionCount * 5 + approvedUploads * 20;
  const rewardPointsRow = await db.get('SELECT SUM(points) as sum FROM user_points WHERE user_id = $1', [userId]);
  const rewardPoints = rewardPointsRow.sum || 0;
  const totalPoints = basePoints + rewardPoints;
  if (totalPoints < item.price) return res.status(400).json({ error: '积分不足' });
  await db.run('INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)',
    [uuidv4(), userId, -item.price, `购买商品：${item.name}`, new Date().toISOString()]);
  const userItemId = uuidv4();
  await db.run('INSERT INTO user_items (id, user_id, item_id, purchased_at, equipped) VALUES ($1, $2, $3, $4, $5)',
    [userItemId, userId, itemId, new Date().toISOString(), 0]);
  res.json({ success: true, remainingPoints: totalPoints - item.price });
});

router.post('/shop/equip', async (req, res) => {
  const { itemId, equip } = req.body;
  const userId = req.user.userId;
  if (equip) {
    const item = await db.get('SELECT type FROM shop_items WHERE id = $1', [itemId]);
    if (item) {
      await db.run('UPDATE user_items SET equipped = 0 WHERE user_id = $1 AND item_id IN (SELECT id FROM shop_items WHERE type = $2)', [userId, item.type]);
    }
    await db.run('UPDATE user_items SET equipped = $1 WHERE user_id = $2 AND item_id = $3', [1, userId, itemId]);
  } else {
    await db.run('UPDATE user_items SET equipped = $1 WHERE user_id = $2 AND item_id = $3', [0, userId, itemId]);
  }
  res.json({ success: true });
});

router.get('/my-items', async (req, res) => {
  const userId = req.user.userId;
  const items = await db.all(
    `SELECT ui.id, ui.item_id, ui.equipped, si.name, si.type, si.icon, si.data, si.price
     FROM user_items ui
     JOIN shop_items si ON ui.item_id = si.id
     WHERE ui.user_id = $1`,
    [userId]
  );
  res.json(items);
});

router.get('/total-points', async (req, res) => {
  const userId = req.user.userId;
  const sessionCount = (await db.get('SELECT COUNT(*) as c FROM sessions WHERE user_id = $1', [userId])).c;
  const favoriteCount = (await db.get('SELECT COUNT(*) as c FROM favorites WHERE user_id = $1', [userId])).c;
  const favoriteSessionCount = (await db.get('SELECT COUNT(*) as c FROM sessions WHERE user_id = $1 AND favorite = 1', [userId])).c;
  const approvedUploads = (await db.get('SELECT COUNT(*) as c FROM knowledge WHERE submitted_by = $1 AND status = $2', [req.user.username, 'approved'])).c;
  const basePoints = sessionCount * 10 + favoriteCount * 2 + favoriteSessionCount * 5 + approvedUploads * 20;
  const rewardPointsRow = await db.get('SELECT SUM(points) as sum FROM user_points WHERE user_id = $1', [userId]);
  const rewardPoints = rewardPointsRow.sum || 0;
  const total = basePoints + rewardPoints;
  res.json({ total, basePoints, rewardPoints });
});

// ==================== AI生成题目（管理员） ====================
router.post('/generate-question', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '无权限' });
  try {
    const prompt = `请生成一道关于乡村振兴或农村政策的选择题，要求：题目、四个选项、正确答案索引(0-3)、解析。以JSON格式输出，例如：{"question":"...","options":["...","...","...","..."],"answer":0,"explanation":"..."}`;
    const response = await chat([{ role: 'user', content: prompt }], { temperature: 0.7, max_tokens: 500 });
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const q = JSON.parse(jsonMatch[0]);
      const id = `ai_${Date.now()}`;
      await db.run(`INSERT INTO quiz_questions (id, type, question, options, answer, explanation, category, difficulty, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, 'choice', q.question, JSON.stringify(q.options), q.answer, q.explanation, 'AI生成', 2, new Date().toISOString()]);
      res.json({ success: true, id });
    } else {
      res.status(500).json({ error: '生成失败' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== 政策闯关模式 ====================
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

// ==================== 双人PK答题 ====================
router.post('/pk/create', async (req, res) => {
  const userId = req.user.userId;
  const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const questions = await db.all(`SELECT id FROM quiz_questions ORDER BY RANDOM() LIMIT 5`);
  const questionIds = questions.map(q => q.id);
  const roomId = uuidv4();
  await db.run(`INSERT INTO pk_rooms (id, room_code, creator_id, status, questions, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [roomId, roomCode, userId, 'waiting', JSON.stringify(questionIds), new Date().toISOString()]);
  res.json({ roomCode, roomId, questions: questionIds });
});

router.post('/pk/join', async (req, res) => {
  const { roomCode } = req.body;
  const userId = req.user.userId;
  const room = await db.get('SELECT * FROM pk_rooms WHERE room_code = $1 AND status = $2', [roomCode, 'waiting']);
  if (!room) return res.status(404).json({ error: '房间不存在或已开始' });
  if (room.creator_id === userId) return res.status(400).json({ error: '不能加入自己创建的房间' });
  await db.run('UPDATE pk_rooms SET opponent_id = $1, status = $2 WHERE id = $3', [userId, 'playing', room.id]);
  res.json({ roomId: room.id, questions: JSON.parse(room.questions) });
});

router.post('/pk/submit', async (req, res) => {
  const { roomId, answers } = req.body;
  const userId = req.user.userId;
  const room = await db.get('SELECT * FROM pk_rooms WHERE id = $1', [roomId]);
  if (!room || room.status !== 'playing') return res.status(400).json({ error: '房间状态错误' });
  let correct = 0;
  for (let ans of answers) {
    const q = await db.get('SELECT answer FROM quiz_questions WHERE id = $1', [ans.questionId]);
    if (q && q.answer === ans.selected) correct++;
  }
  if (userId === room.creator_id) {
    await db.run('UPDATE pk_rooms SET creator_answers = $1, creator_score = $2 WHERE id = $3', [JSON.stringify(answers), correct, roomId]);
  } else if (userId === room.opponent_id) {
    await db.run('UPDATE pk_rooms SET opponent_answers = $1, opponent_score = $2 WHERE id = $3', [JSON.stringify(answers), correct, roomId]);
  } else {
    return res.status(403).json({ error: '无权限' });
  }
  res.json({ accepted: true });
});

router.get('/pk/status/:roomId', async (req, res) => {
  const room = await db.get('SELECT * FROM pk_rooms WHERE id = $1', [req.params.roomId]);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  const bothSubmitted = room.creator_answers !== null && room.opponent_answers !== null;
  let winner = null;
  if (bothSubmitted && room.status === 'playing') {
    if (room.creator_score > room.opponent_score) winner = room.creator_id;
    else if (room.opponent_score > room.creator_score) winner = room.opponent_id;
    else winner = null;
    await db.run('UPDATE pk_rooms SET status = $1, winner_id = $2, finished_at = $3 WHERE id = $4', ['finished', winner, new Date().toISOString(), room.id]);
    if (winner) {
      await db.run('INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)',
        [uuidv4(), winner, 30, 'PK胜利', new Date().toISOString()]);
    }
  }
  res.json({
    status: room.status,
    creatorScore: room.creator_score,
    opponentScore: room.opponent_score,
    winnerId: room.winner_id,
    finished: room.status === 'finished'
  });
});

// ==================== 单题填空（兼容旧版） ====================
router.get('/fill-question', async (req, res) => {
  const question = await db.get(`SELECT * FROM fill_questions ORDER BY RANDOM() LIMIT 1`);
  if (!question) return res.status(404).json({ error: '暂无填空题' });
  res.json(question);
});

router.post('/fill-submit', async (req, res) => {
  const { questionId, userAnswer } = req.body;
  const q = await db.get('SELECT correct_word FROM fill_questions WHERE id = $1', [questionId]);
  if (!q) return res.status(404).json({ error: '题目不存在' });
  const isCorrect = (userAnswer.trim() === q.correct_word);
  if (isCorrect) {
    await db.run('INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)',
      [uuidv4(), req.user.userId, 10, '填空游戏答对', new Date().toISOString()]);
  }
  res.json({ correct: isCorrect, correctAnswer: q.correct_word });
});

// ==================== 错题闯关 ====================
router.get('/wrong-questions/list', async (req, res) => {
  const userId = req.user.userId;
  const wrongs = await db.all(
    `SELECT w.question_id, w.wrong_count, q.question, q.options, q.answer, q.explanation
     FROM wrong_questions w
     JOIN quiz_questions q ON w.question_id = q.id
     WHERE w.user_id = $1`,
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
    if (!q || q.answer !== ans.selected) {
      allCorrect = false;
      break;
    }
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

// ==================== 每周竞赛 ====================
router.get('/weekly/current', async (req, res) => {
  const now = new Date();
  const day = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - day + (day === 0 ? -6 : 1));
  weekStart.setHours(0,0,0,0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23,59,59,999);
  const startStr = weekStart.toISOString().slice(0,10);
  const endStr = weekEnd.toISOString().slice(0,10);
  let contest = await db.get('SELECT * FROM weekly_contest WHERE week_start = $1', [startStr]);
  if (!contest) {
    const questionIds = (await db.all(`SELECT id FROM quiz_questions ORDER BY RANDOM() LIMIT 10`)).map(q => q.id);
    const contestId = uuidv4();
    await db.run('INSERT INTO weekly_contest (id, week_start, week_end, questions, status) VALUES ($1, $2, $3, $4, $5)',
      [contestId, startStr, endStr, JSON.stringify(questionIds), 'active']);
    contest = { id: contestId, week_start: startStr, week_end: endStr, questions: JSON.stringify(questionIds), status: 'active' };
  }
  const questionIds = JSON.parse(contest.questions);
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
     FROM weekly_contest_scores w
     JOIN users u ON w.user_id = u.id
     WHERE w.contest_id = $1
     ORDER BY w.score DESC, w.time_used ASC
     LIMIT 10`,
    [req.params.contestId]
  );
  res.json(ranks);
});

// ==================== 刮刮乐 ====================
router.get('/scratch/generate', async (req, res) => {
  const userId = req.user.userId;
  const today = new Date().toISOString().slice(0,10);
  const count = (await db.get('SELECT COUNT(*) as c FROM scratch_cards WHERE user_id = $1 AND date(created_at) = $2', [userId, today])).c;
  if (count >= 5) return res.status(429).json({ error: '今日刮刮卡已达上限' });
  const question = await db.get(`SELECT id, question, options, answer FROM quiz_questions ORDER BY RANDOM() LIMIT 1`);
  if (!question) return res.status(404).json({ error: '无题目' });
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

// ==================== 积分添加接口 ====================
router.post('/add-points', async (req, res) => {
  const { points, reason } = req.body;
  const userId = req.user.userId;
  if (!points || points <= 0) return res.status(400).json({ error: '无效积分' });
  await db.run('INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)',
    [uuidv4(), userId, points, reason || '游戏奖励', new Date().toISOString()]);
  res.json({ success: true });
});

module.exports = router;