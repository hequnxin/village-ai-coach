// routes/game.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../services/db');
const { chat } = require('../services/openai');
const { generateChoice, generateFill } = require('../services/questionGenerator');

const router = express.Router();

// ==================== 辅助函数 ====================
async function getUserTotalPoints(userId) {
  const sessionCount = (await db.get(`SELECT COUNT(*) as c FROM sessions WHERE user_id = $1`, [userId])).c;
  const favoriteCount = (await db.get(`SELECT COUNT(*) as c FROM favorites WHERE user_id = $1`, [userId])).c;
  const favoriteSessionCount = (await db.get(`SELECT COUNT(*) as c FROM sessions WHERE user_id = $1 AND favorite = 1`, [userId])).c;
  const approvedUploads = (await db.get(`SELECT COUNT(*) as c FROM knowledge WHERE submitted_by = (SELECT username FROM users WHERE id = $1) AND status = 'approved'`, [userId])).c;
  const basePoints = sessionCount * 10 + favoriteCount * 2 + favoriteSessionCount * 5 + approvedUploads * 20;
  const rewardPointsRow = await db.get(`SELECT SUM(points) as sum FROM user_points WHERE user_id = $1`, [userId]);
  const rewardPoints = rewardPointsRow.sum || 0;
  return basePoints + rewardPoints;
}

// ==================== 趣味闯关（原政策闯关） ====================
router.get('/policy-themes', async (req, res) => {
  const userId = req.user.userId;
  const themes = await db.all(`SELECT * FROM game_themes WHERE is_active = 1 ORDER BY sort_order`);
  for (const theme of themes) {
    const progress = await db.get(`SELECT completed FROM user_theme_progress WHERE user_id = $1 AND theme_id = $2`, [userId, theme.id]);
    theme.completed = progress ? progress.completed === 1 : false;
  }
  res.json(themes);
});

router.get('/fun-level-questions', async (req, res) => {
  const { theme, difficulty, count = 5 } = req.query;
  if (!theme) return res.status(400).json({ error: '缺少主题参数' });
  // 只从政策/常见问题类别中选题
  let questions = await db.all(`
    SELECT id, question, options, answer, explanation, type 
    FROM quiz_questions 
    WHERE type = 'choice' AND (source_category IN ('政策', '常见问题') OR category IN ('政策', '常见问题'))
    ORDER BY RANDOM() 
    LIMIT $1
  `, [parseInt(count)]);
  if (questions.length < parseInt(count)) {
    const extra = await db.all(`
      SELECT id, question, options, answer, explanation, type 
      FROM quiz_questions 
      WHERE type = 'choice'
      ORDER BY RANDOM() 
      LIMIT $1
    `, [parseInt(count) - questions.length]);
    questions = [...questions, ...extra];
  }
  const events = ['double', 'hint', 'skip'];
  const randomEvent = Math.random() < 0.2 ? events[Math.floor(Math.random() * events.length)] : null;
  res.json({
    questions: questions.map(q => ({ ...q, options: JSON.parse(q.options) })),
    event: randomEvent
  });
});

router.post('/policy-submit', async (req, res) => {
  const { themeId, score, total } = req.body;
  const userId = req.user.userId;
  const passingScore = Math.ceil(total * 0.6);
  const passed = score >= passingScore;
  const reward = passed ? 50 : 0;
  if (passed) {
    await db.run(`INSERT INTO user_theme_progress (id, user_id, theme_id, completed, completed_at) VALUES ($1, $2, $3, 1, NOW()) ON CONFLICT (user_id, theme_id) DO UPDATE SET completed = 1, completed_at = NOW()`,
      [uuidv4(), userId, themeId]);
    if (reward > 0) {
      await db.run(`INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, NOW())`,
        [uuidv4(), userId, reward, `通关主题: ${themeId}`]);
    }
  }
  res.json({ passed, reward });
});

// ==================== 每日一练（只从政策/常见问题类别选题） ====================
router.get('/daily', async (req, res) => {
  const userId = req.user.userId;
  const today = new Date().toISOString().slice(0, 10);
  let daily = await db.get(`SELECT * FROM daily_quiz WHERE user_id = $1 AND quiz_date = $2`, [userId, today]);
  if (daily && daily.completed) {
    const questions = await db.all(`
      SELECT q.id, q.type, q.question, q.options, q.answer, q.explanation, NULL as hint
      FROM daily_quiz_questions dq 
      JOIN quiz_questions q ON dq.question_id = q.id 
      WHERE dq.quiz_id = $1`, [daily.id]);
    return res.json({ quizId: daily.id, questions: questions.map(q => ({ ...q, options: q.options ? JSON.parse(q.options) : [] })), completed: true, score: daily.score });
  }

  let questions = [];
  // 只从政策/常见问题类别中取选择题
  const choiceQuestions = await db.all(`
    SELECT id, type, question, options, answer, explanation 
    FROM quiz_questions 
    WHERE type = 'choice' AND (source_category IN ('政策', '常见问题') OR category IN ('政策', '常见问题'))
    ORDER BY RANDOM() 
    LIMIT 3
  `);
  // 填空题暂不限类别（但尽量从政策/常见问题中取，如果不足则补充）
  let fillQuestions = await db.all(`
    SELECT f.id, f.sentence as question, f.correct_word as answer, f.hint 
    FROM fill_questions f
    JOIN knowledge k ON f.id LIKE 'auto_' || k.id || '_fill'
    WHERE k.category IN ('政策', '常见问题')
    ORDER BY RANDOM() 
    LIMIT 2
  `);
  if (fillQuestions.length < 2) {
    const extra = await db.all(`SELECT id, sentence as question, correct_word as answer, hint FROM fill_questions ORDER BY RANDOM() LIMIT $1`, [2 - fillQuestions.length]);
    fillQuestions = [...fillQuestions, ...extra];
  }

  let finalChoice = [...choiceQuestions];
  if (finalChoice.length < 3) {
    const extra = await db.all(`SELECT id, type, question, options, answer, explanation FROM quiz_questions WHERE type = 'choice' ORDER BY RANDOM() LIMIT $1`, [3 - finalChoice.length]);
    finalChoice.push(...extra);
  }

  for (let q of finalChoice) {
    questions.push({
      id: q.id,
      type: 'choice',
      question: q.question,
      options: JSON.parse(q.options),
      answer: q.answer,
      explanation: q.explanation
    });
  }
  for (let f of fillQuestions) {
    questions.push({
      id: f.id,
      type: 'fill',
      question: f.question,
      answer: f.answer,
      hint: f.hint,
      explanation: `正确答案是“${f.answer}”`
    });
  }

  if (questions.length === 0) {
    return res.status(404).json({ error: '无可用题目' });
  }

  const quizId = uuidv4();
  await db.run(`INSERT INTO daily_quiz (id, user_id, quiz_date, score, completed, created_at) VALUES ($1, $2, $3, 0, 0, $4)`, [quizId, userId, today, new Date().toISOString()]);
  for (const q of questions) {
    if (q.type === 'fill') {
      let existing = await db.get(`SELECT id FROM quiz_questions WHERE id = $1`, [q.id]);
      if (!existing) {
        await db.run(`
          INSERT INTO quiz_questions (id, type, question, options, answer, explanation, created_at)
          VALUES ($1, 'fill', $2, NULL, $3, $4, NOW())
        `, [q.id, q.question, q.answer, q.explanation]);
      }
    }
    await db.run(`INSERT INTO daily_quiz_questions (id, quiz_id, question_id) VALUES ($1, $2, $3)`, [uuidv4(), quizId, q.id]);
  }
  res.json({ quizId, questions, completed: false });
});

router.post('/daily/submit', async (req, res) => {
  const { quizId, score, total } = req.body;
  const userId = req.user.userId;
  const daily = await db.get(`SELECT * FROM daily_quiz WHERE id = $1 AND user_id = $2`, [quizId, userId]);
  if (!daily || daily.completed) return res.status(400).json({ error: '无效或已提交' });
  await db.run(`UPDATE daily_quiz SET score = $1, completed = 1 WHERE id = $2`, [score, quizId]);
  const rewardPoints = score * 10 + (score === total ? 20 : 0);
  await db.run(`INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [uuidv4(), userId, rewardPoints, `每日一练得分${score}/${total}`, new Date().toISOString()]);
  res.json({ score, total, rewardPoints });
});

router.get('/daily/status', async (req, res) => {
  const userId = req.user.userId;
  const today = new Date().toISOString().slice(0,10);
  const daily = await db.get(`SELECT score, completed FROM daily_quiz WHERE user_id = $1 AND quiz_date = $2`, [userId, today]);
  if (daily && daily.completed) {
    const countRes = await db.get(`
      SELECT COUNT(*) as total FROM daily_quiz_questions 
      WHERE quiz_id IN (SELECT id FROM daily_quiz WHERE user_id = $1 AND quiz_date = $2)
    `, [userId, today]);
    const total = countRes ? countRes.total : 5;
    res.json({ completed: true, score: daily.score, total });
  } else {
    res.json({ completed: false });
  }
});

// ==================== 每周竞赛（支持多次参赛，题目限制类别） ====================
router.get('/weekly/status', async (req, res) => {
  const userId = req.user.userId;
  const tableExists = await db.get(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'weekly_contest_attempts')`);
  if (!tableExists.exists) {
    return res.json({ participated: false, attemptsLeft: 3 });
  }
  const now = new Date();
  const day = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - day + (day === 0 ? -6 : 1));
  weekStart.setHours(0,0,0,0);
  const startStr = weekStart.toISOString().slice(0,10);
  const contest = await db.get(`SELECT id, questions FROM weekly_contest WHERE week_start = $1`, [startStr]);
  if (!contest) {
    return res.json({ participated: false, attemptsLeft: 3 });
  }
  const attemptsCount = await db.get(`SELECT COUNT(*) as count FROM weekly_contest_attempts WHERE contest_id = $1 AND user_id = $2`, [contest.id, userId]);
  const attemptsLeft = Math.max(0, 3 - (attemptsCount.count || 0));
  const best = await db.get(`
    SELECT score, total_questions, time_used 
    FROM weekly_contest_attempts 
    WHERE contest_id = $1 AND user_id = $2 
    ORDER BY (score * 1.0 / total_questions) DESC, time_used ASC 
    LIMIT 1
  `, [contest.id, userId]);
  if (best) {
    res.json({
      participated: true,
      bestScore: best.score,
      total: best.total_questions,
      bestTime: best.time_used,
      attemptsLeft
    });
  } else {
    res.json({ participated: false, attemptsLeft: 3 });
  }
});

router.get('/weekly/current', async (req, res) => {
  const userId = req.user.userId;
  const now = new Date();
  const day = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - day + (day === 0 ? -6 : 1));
  weekStart.setHours(0,0,0,0);
  const startStr = weekStart.toISOString().slice(0,10);
  let contest = await db.get(`SELECT * FROM weekly_contest WHERE week_start = $1`, [startStr]);

  if (contest) {
    const attemptsCount = (await db.get(`SELECT COUNT(*) as count FROM weekly_contest_attempts WHERE contest_id = $1 AND user_id = $2`, [contest.id, userId])).count;
    if (attemptsCount >= 3) {
      return res.status(403).json({ error: '本周参赛次数已达上限（3次）' });
    }
  }

  let questions = [];
  if (contest) {
    const questionIds = JSON.parse(contest.questions);
    if (questionIds.length) {
      const placeholders = questionIds.map((_,i) => `$${i+1}`).join(',');
      questions = await db.all(`SELECT id, question, options, answer, explanation FROM quiz_questions WHERE id IN (${placeholders})`, questionIds);
    }
  }
  if (questions.length === 0) {
    // 从政策/常见问题类别中选题
    let fallback = await db.all(`
      SELECT id, question, options, answer, explanation 
      FROM quiz_questions 
      WHERE type = 'choice' AND (source_category IN ('政策', '常见问题') OR category IN ('政策', '常见问题'))
      ORDER BY RANDOM() 
      LIMIT 10
    `);
    if (fallback.length === 0) {
      const knowledge = await db.all(`SELECT id, title, content, type FROM knowledge WHERE status = 'approved' AND category IN ('政策', '常见问题') ORDER BY RANDOM() LIMIT 10`);
      if (knowledge.length === 0) return res.status(500).json({ error: '无可用题目来源' });
      for (const k of knowledge) {
        const choice = await generateChoice(k, true);
        if (choice) {
          const qid = `temp_${Date.now()}_${Math.random().toString(36).substr(2,6)}`;
          await db.run(`INSERT INTO quiz_questions (id, type, question, options, answer, explanation, category, theme, difficulty, source_category, created_at) VALUES ($1, 'choice', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [qid, choice.question, JSON.stringify(choice.options), choice.answer, choice.explanation, k.category, k.type, 1, k.category, new Date().toISOString()]);
          fallback.push({ id: qid, question: choice.question, options: JSON.stringify(choice.options), answer: choice.answer, explanation: choice.explanation });
        }
      }
      questions = fallback;
    } else {
      questions = fallback;
    }
    if (questions.length === 0) return res.status(500).json({ error: '无法生成竞赛题目' });
    const contestId = uuidv4();
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const endStr = weekEnd.toISOString().slice(0,10);
    await db.run(`INSERT INTO weekly_contest (id, week_start, week_end, questions, status) VALUES ($1, $2, $3, $4, 'active')`,
      [contestId, startStr, endStr, JSON.stringify(questions.map(q => q.id))]);
    contest = { id: contestId };
  }
  const attemptsCount = contest ? (await db.get(`SELECT COUNT(*) as count FROM weekly_contest_attempts WHERE contest_id = $1 AND user_id = $2`, [contest.id, userId])).count : 0;
  const attemptNumber = attemptsCount + 1;
  res.json({ contestId: contest.id, questions: questions.map(q => ({ ...q, options: JSON.parse(q.options) })), attemptNumber });
});

router.post('/weekly/submit', async (req, res) => {
  const { contestId, answers, timeUsed, attemptNumber } = req.body;
  const userId = req.user.userId;
  const contest = await db.get(`SELECT * FROM weekly_contest WHERE id = $1 AND status = 'active'`, [contestId]);
  if (!contest) return res.status(400).json({ error: '竞赛已结束' });

  const existingAttempts = await db.get(`SELECT COUNT(*) as count FROM weekly_contest_attempts WHERE contest_id = $1 AND user_id = $2`, [contestId, userId]);
  if (existingAttempts.count >= 3) {
    return res.status(403).json({ error: '本周参赛次数已达上限' });
  }

  let correct = 0;
  const totalQuestions = answers.length;
  for (const ans of answers) {
    const q = await db.get(`SELECT answer FROM quiz_questions WHERE id = $1`, [ans.questionId]);
    if (q && q.answer == ans.selected) correct++;
  }
  const attemptId = uuidv4();
  await db.run(`
    INSERT INTO weekly_contest_attempts (id, contest_id, user_id, attempt_number, score, total_questions, time_used, submitted_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
  `, [attemptId, contestId, userId, attemptNumber, correct, totalQuestions, timeUsed]);

  const points = correct * 5;
  await db.run(`INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [uuidv4(), userId, points, `每周竞赛得分${correct}/${totalQuestions}`, new Date().toISOString()]);

  for (let i = 0; i < answers.length; i++) {
    const ans = answers[i];
    const q = await db.get(`SELECT answer FROM quiz_questions WHERE id = $1`, [ans.questionId]);
    if (q && q.answer != ans.selected) {
      const today = new Date().toISOString().slice(0,10);
      const existing = await db.get(`SELECT * FROM wrong_questions WHERE user_id = $1 AND question_id = $2`, [userId, ans.questionId]);
      if (existing) {
        await db.run(`UPDATE wrong_questions SET wrong_count = wrong_count + 1, last_wrong_date = $1 WHERE id = $2`, [today, existing.id]);
      } else {
        await db.run(`INSERT INTO wrong_questions (id, user_id, question_id, wrong_count, last_wrong_date) VALUES ($1, $2, $3, 1, $4)`,
          [uuidv4(), userId, ans.questionId, today]);
      }
    }
  }
  res.json({ score: correct, total: totalQuestions, rewardPoints: points });
});

router.get('/weekly/rank/:contestId', async (req, res) => {
  const ranks = await db.all(`
    SELECT u.username, a.score, a.total_questions, a.time_used,
           ROUND(CAST(a.score AS DECIMAL) / a.total_questions * 100, 1) as accuracy
    FROM weekly_contest_attempts a
    JOIN users u ON a.user_id = u.id
    WHERE a.contest_id = $1
    ORDER BY (a.score * 1.0 / a.total_questions) DESC, a.time_used ASC
    LIMIT 10
  `, [req.params.contestId]);
  res.json(ranks);
});

// ==================== 错题本 ====================
router.get('/wrong-questions', async (req, res) => {
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
  let clearedCount = 0;
  for (const ans of answers) {
    const q = await db.get(`SELECT answer FROM quiz_questions WHERE id = $1`, [ans.questionId]);
    if (q && q.answer == ans.selected) {
      await db.run(`DELETE FROM wrong_questions WHERE user_id = $1 AND question_id = $2`, [userId, ans.questionId]);
      clearedCount++;
    }
  }
  const reward = clearedCount * 10;
  if (reward > 0) {
    await db.run(`INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), userId, reward, `错题闯关答对${clearedCount}题`, new Date().toISOString()]);
  }
  res.json({ clearedCount, rewardPoints: reward });
});

router.post('/wrong-questions/record', async (req, res) => {
  const { questionId, userAnswer } = req.body;
  const userId = req.user.userId;
  let q = await db.get(`SELECT type, answer FROM quiz_questions WHERE id = $1`, [questionId]);
  if (!q) {
    const fill = await db.get(`SELECT correct_word as answer FROM fill_questions WHERE id = $1`, [questionId]);
    if (!fill) return res.status(404).json({ error: '题目不存在' });
    const isCorrect = (fill.answer.trim().toLowerCase() === String(userAnswer).trim().toLowerCase());
    if (!isCorrect) {
      const today = new Date().toISOString().slice(0,10);
      const existing = await db.get(`SELECT * FROM wrong_questions WHERE user_id = $1 AND question_id = $2`, [userId, questionId]);
      if (existing) {
        await db.run(`UPDATE wrong_questions SET wrong_count = wrong_count + 1, last_wrong_date = $1 WHERE id = $2`, [today, existing.id]);
      } else {
        await db.run(`INSERT INTO wrong_questions (id, user_id, question_id, wrong_count, last_wrong_date) VALUES ($1, $2, $3, 1, $4)`,
          [uuidv4(), userId, questionId, today]);
      }
    }
    return res.json({ recorded: true });
  }
  let isCorrect = false;
  if (q.type === 'choice') {
    isCorrect = (parseInt(q.answer) === parseInt(userAnswer));
  } else {
    isCorrect = (String(q.answer).trim().toLowerCase() === String(userAnswer).trim().toLowerCase());
  }
  if (!isCorrect) {
    const today = new Date().toISOString().slice(0,10);
    const existing = await db.get(`SELECT * FROM wrong_questions WHERE user_id = $1 AND question_id = $2`, [userId, questionId]);
    if (existing) {
      await db.run(`UPDATE wrong_questions SET wrong_count = wrong_count + 1, last_wrong_date = $1 WHERE id = $2`, [today, existing.id]);
    } else {
      await db.run(`INSERT INTO wrong_questions (id, user_id, question_id, wrong_count, last_wrong_date) VALUES ($1, $2, $3, 1, $4)`,
        [uuidv4(), userId, questionId, today]);
    }
  }
  res.json({ recorded: true });
});

// ==================== 刮刮乐 ====================
router.get('/scratch/today-count', async (req, res) => {
  const userId = req.user.userId;
  const today = new Date().toISOString().slice(0,10);
  const count = (await db.get(`SELECT COUNT(*) as c FROM scratch_cards WHERE user_id = $1 AND date(created_at) = $2`, [userId, today])).c;
  res.json({ count });
});

router.get('/scratch/generate', async (req, res) => {
  const userId = req.user.userId;
  const today = new Date().toISOString().slice(0,10);
  const count = (await db.get(`SELECT COUNT(*) as c FROM scratch_cards WHERE user_id = $1 AND date(created_at) = $2`, [userId, today])).c;
  if (count >= 5) return res.status(429).json({ error: '今日刮刮卡次数已达上限' });
  // 只从政策/常见问题类别中选题
  const question = await db.all(`
    SELECT id, question, options, answer 
    FROM quiz_questions 
    WHERE type = 'choice' AND (source_category IN ('政策', '常见问题') OR category IN ('政策', '常见问题'))
    ORDER BY RANDOM() 
    LIMIT 1
  `);
  if (question.length === 0) return res.status(404).json({ error: '无题目' });
  const q = question[0];
  const cardId = uuidv4();
  await db.run(`INSERT INTO scratch_cards (id, user_id, question_id, answer, reward_points, created_at) VALUES ($1, $2, $3, $4, 0, $5)`,
    [cardId, userId, q.id, q.answer, new Date().toISOString()]);
  res.json({ cardId, question: q.question, options: JSON.parse(q.options) });
});

router.post('/scratch/submit', async (req, res) => {
  const { cardId, selected } = req.body;
  const userId = req.user.userId;
  const card = await db.get(`SELECT * FROM scratch_cards WHERE id = $1 AND user_id = $2 AND is_used = 0`, [cardId, userId]);
  if (!card) return res.status(400).json({ error: '无效刮刮卡' });
  const isCorrect = (card.answer == selected);
  let reward = 0;
  if (isCorrect) {
    reward = Math.floor(Math.random() * 20) + 10;
    await db.run(`UPDATE scratch_cards SET is_used = 1, reward_points = $1, used_at = $2 WHERE id = $3`, [reward, new Date().toISOString(), cardId]);
    await db.run(`INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), userId, reward, '刮刮乐奖励', new Date().toISOString()]);
  } else {
    await db.run(`UPDATE scratch_cards SET is_used = 1, used_at = $1 WHERE id = $2`, [new Date().toISOString(), cardId]);
  }
  res.json({ correct: isCorrect, rewardPoints: reward });
});

// ==================== 其他接口 ====================
router.post('/add-points', async (req, res) => {
  const { points, reason } = req.body;
  const userId = req.user.userId;
  await db.run(`INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [uuidv4(), userId, points, reason, new Date().toISOString()]);
  res.json({ success: true });
});

// 调试接口：清除今日刮刮乐记录
router.post('/debug/clear-scratch-today', async (req, res) => {
  const userId = req.user.userId;
  const today = new Date().toISOString().slice(0,10);
  await db.run(`DELETE FROM scratch_cards WHERE user_id = $1 AND date(created_at) = $2`, [userId, today]);
  res.json({ success: true, message: '已清除今日刮刮乐记录' });
});

module.exports = router;