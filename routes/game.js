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

// ==================== 趣味闯关 ====================

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
  let questions = await db.all(`
    SELECT id, question, options, answer, explanation, type
    FROM quiz_questions
    WHERE type = 'choice' AND (source_category IN ('政策', '常见问题') OR category IN ('政策', '常见问题'))
    ORDER BY RANDOM()
    LIMIT $1
  `, [parseInt(count)]);
  questions = questions.map(q => ({ ...q, options: JSON.parse(q.options) }));
  if (questions.length < parseInt(count)) {
    const extra = await db.all(`
      SELECT id, question, options, answer, explanation, type
      FROM quiz_questions
      WHERE type = 'choice'
      ORDER BY RANDOM()
      LIMIT $1
    `, [parseInt(count) - questions.length]);
    const parsedExtra = extra.map(q => ({ ...q, options: JSON.parse(q.options) }));
    questions = [...questions, ...parsedExtra];
  }
  // 随机将部分题目转换为判断题或排序题（优化逻辑）
  if (questions.length >= 2) {
    const newQuestions = [];
    for (let i = 0; i < questions.length; i++) {
      let q = questions[i];
      const rand = Math.random();
      if (q.type === 'choice') {
        if (rand < 0.2 && i % 2 === 0) {
          const cleanQuestion = q.question.replace(/[？?]/g, '');
          let isTrue = true;
          const positiveKeywords = ['可以', '应该', '需要', '必须', '鼓励', '支持'];
          const negativeKeywords = ['不能', '禁止', '不得', '严禁', '不准'];
          for (const kw of positiveKeywords) if (cleanQuestion.includes(kw)) { isTrue = true; break; }
          for (const kw of negativeKeywords) if (cleanQuestion.includes(kw)) { isTrue = false; break; }
          q = {
            ...q,
            question_type: 'judge',
            question: `判断：${cleanQuestion}？`,
            options: ['正确', '错误'],
            answer: isTrue ? 0 : 1,
            explanation: q.explanation || (isTrue ? '该说法符合政策规定。' : '该说法与政策不符。')
          };
        } else if (rand < 0.35 && i % 3 === 0 && q.options.length >= 3) {
          const correctOrder = [...Array(q.options.length).keys()];
          const shuffled = [...correctOrder];
          for (let j = shuffled.length - 1; j > 0; j--) {
            const k = Math.floor(Math.random() * (j + 1));
            [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
          }
          const shuffledOptions = shuffled.map(idx => q.options[idx]);
          q = {
            ...q,
            question_type: 'sort',
            question: `请按正确顺序排列：${q.question}`,
            options: shuffledOptions,
            answer: correctOrder,
            explanation: q.explanation || '请按照政策流程顺序排列。'
          };
        } else {
          q.question_type = 'choice';
        }
      } else {
        q.question_type = 'choice';
      }
      newQuestions.push(q);
    }
    questions = newQuestions;
  } else {
    questions = questions.map(q => ({ ...q, question_type: 'choice' }));
  }
  const events = ['double', 'hint', 'skip'];
  const randomEvent = Math.random() < 0.2 ? events[Math.floor(Math.random() * events.length)] : null;
  res.json({ questions, event: randomEvent });
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

// ==================== 翻牌配对（记忆匹配） ====================

// 获取随机卡片配对（根据难度）
router.get('/memory-pairs', async (req, res) => {
  const { difficulty = 'medium' } = req.query;
  let pairCount = 8;      // 简单
  let gridCols = 4;
  if (difficulty === 'medium') { pairCount = 12; gridCols = 4; }
  if (difficulty === 'hard') { pairCount = 18; gridCols = 6; }

  // 从知识库获取术语-描述对
  let pairs = await db.all(`
    SELECT id, title as term, content as description
    FROM knowledge
    WHERE status = 'approved' AND category IN ('政策', '常见问题')
    ORDER BY RANDOM() LIMIT $1
  `, [pairCount]);

  if (pairs.length < pairCount) {
    const extra = await db.all(`
      SELECT id, title as term, content as description
      FROM knowledge WHERE status = 'approved' ORDER BY RANDOM() LIMIT $1
    `, [pairCount - pairs.length]);
    pairs.push(...extra);
  }

  // 构建卡片数组：每对生成两张卡片（术语和描述）
  let cards = [];
  pairs.forEach((pair, idx) => {
    cards.push({
      id: `${pair.id}_term`,
      pairId: idx,
      type: 'term',
      text: pair.term.length > 40 ? pair.term.substring(0,40)+'...' : pair.term,
      description: pair.description
    });
    cards.push({
      id: `${pair.id}_desc`,
      pairId: idx,
      type: 'desc',
      text: pair.description.length > 60 ? pair.description.substring(0,60)+'...' : pair.description,
      description: pair.description
    });
  });

  // 随机打乱卡片顺序
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  res.json({ cards, pairCount, gridCols });
});

// 保存游戏结果
router.post('/memory-submit', async (req, res) => {
  const { difficulty, score, timeUsed, moves, matchedCount, totalPairs } = req.body;
  const userId = req.user.userId;
  const recordId = uuidv4();
  await db.run(`
    INSERT INTO memory_game_records (id, user_id, difficulty, score, time_used, moves, matched_count, total_pairs, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
  `, [recordId, userId, difficulty, score, timeUsed, moves, matchedCount, totalPairs]);

  // 奖励积分
  const rewardPoints = Math.floor(score / 10);
  if (rewardPoints > 0) {
    await db.run(`INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), userId, rewardPoints, `翻牌配对得分${score}`, new Date().toISOString()]);
  }
  res.json({ success: true, rewardPoints });
});

// 排行榜（按得分）
router.get('/memory-rank', async (req, res) => {
  const { difficulty = 'medium' } = req.query;
  const ranks = await db.all(`
    SELECT u.username, MAX(r.score) as best_score, MIN(r.time_used) as best_time, MIN(r.moves) as best_moves
    FROM memory_game_records r
    JOIN users u ON r.user_id = u.id
    WHERE r.difficulty = $1
    GROUP BY r.user_id
    ORDER BY best_score DESC, best_time ASC, best_moves ASC
    LIMIT 10
  `, [difficulty]);
  res.json(ranks);
});

// ==================== 每日一练 ====================

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
  const choiceQuestions = await db.all(`
    SELECT id, type, question, options, answer, explanation
    FROM quiz_questions
    WHERE type = 'choice' AND (source_category IN ('政策', '常见问题') OR category IN ('政策', '常见问题'))
    ORDER BY RANDOM()
    LIMIT 3
  `);
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
    questions.push({ id: q.id, type: 'choice', question: q.question, options: JSON.parse(q.options), answer: q.answer, explanation: q.explanation });
  }
  for (let f of fillQuestions) {
    questions.push({ id: f.id, type: 'fill', question: f.question, answer: f.answer, hint: f.hint, explanation: `正确答案是"${f.answer}"` });
  }
  if (questions.length === 0) return res.status(404).json({ error: '无可用题目' });
  const quizId = uuidv4();
  await db.run(`INSERT INTO daily_quiz (id, user_id, quiz_date, score, completed, created_at) VALUES ($1, $2, $3, 0, 0, $4)`, [quizId, userId, today, new Date().toISOString()]);
  for (const q of questions) {
    if (q.type === 'fill') {
      let existing = await db.get(`SELECT id FROM quiz_questions WHERE id = $1`, [q.id]);
      if (!existing) {
        await db.run(`INSERT INTO quiz_questions (id, type, question, options, answer, explanation, created_at) VALUES ($1, 'fill', $2, NULL, $3, $4, NOW())`, [q.id, q.question, q.answer, q.explanation]);
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
    const countRes = await db.get(`SELECT COUNT(*) as total FROM daily_quiz_questions WHERE quiz_id IN (SELECT id FROM daily_quiz WHERE user_id = $1 AND quiz_date = $2)`, [userId, today]);
    const total = countRes ? countRes.total : 5;
    res.json({ completed: true, score: daily.score, total });
  } else {
    res.json({ completed: false });
  }
});

// ==================== 每周竞赛（带缓存） ====================

let cachedWeeklyContest = null;
let cachedWeekStart = null;

router.get('/weekly/status', async (req, res) => {
  const userId = req.user.userId;
  const tableExists = await db.get(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'weekly_contest_attempts')`);
  if (!tableExists.exists) return res.json({ participated: false, attemptsLeft: 3 });
  const now = new Date();
  const day = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - day + (day === 0 ? -6 : 1));
  weekStart.setHours(0,0,0,0);
  const startStr = weekStart.toISOString().slice(0,10);
  const contest = await db.get(`SELECT id, questions FROM weekly_contest WHERE week_start = $1`, [startStr]);
  if (!contest) return res.json({ participated: false, attemptsLeft: 3 });
  const attempts = await db.all(`SELECT * FROM weekly_contest_attempts WHERE contest_id = $1 AND user_id = $2 ORDER BY submitted_at DESC`, [contest.id, userId]);
  const attemptsCount = attempts.length;
  const attemptsLeft = Math.max(0, 3 - attemptsCount);
  if (attemptsCount === 0) return res.json({ participated: false, attemptsLeft: 3 });
  let best = null;
  let bestScore = 0;
  let bestTotal = 0;
  let bestTime = Infinity;
  for (const att of attempts) {
    const accuracy = att.score / att.total_questions;
    const currentBestAccuracy = best ? best.score / best.total_questions : -1;
    if (accuracy > currentBestAccuracy || (accuracy === currentBestAccuracy && att.time_used < bestTime)) {
      best = att;
      bestScore = att.score;
      bestTotal = att.total_questions;
      bestTime = att.time_used;
    }
  }
  res.json({ participated: true, bestScore, total: bestTotal, bestTime, attemptsLeft });
});

router.get('/weekly/current', async (req, res) => {
  const userId = req.user.userId;
  const now = new Date();
  const day = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - day + (day === 0 ? -6 : 1));
  weekStart.setHours(0,0,0,0);
  const startStr = weekStart.toISOString().slice(0,10);

  if (cachedWeeklyContest && cachedWeekStart === startStr) {
    const contest = cachedWeeklyContest;
    const attemptsCount = (await db.get(`SELECT COUNT(*) as count FROM weekly_contest_attempts WHERE contest_id = $1 AND user_id = $2`, [contest.id, userId])).count;
    if (attemptsCount >= 3) return res.status(403).json({ error: '本周参赛次数已达上限（3次）' });
    const questions = JSON.parse(contest.questions);
    const parsedQuestions = await Promise.all(questions.map(async qid => {
      const q = await db.get(`SELECT id, question, options, answer, explanation FROM quiz_questions WHERE id = $1`, [qid]);
      return q ? { ...q, options: JSON.parse(q.options) } : null;
    }));
    const attemptNumber = attemptsCount + 1;
    return res.json({ contestId: contest.id, questions: parsedQuestions.filter(Boolean), attemptNumber });
  }

  let contest = await db.get(`SELECT * FROM weekly_contest WHERE week_start = $1`, [startStr]);
  let questions = [];
  if (contest) {
    const questionIds = JSON.parse(contest.questions);
    if (questionIds.length) {
      const placeholders = questionIds.map((_,i) => `$${i+1}`).join(',');
      questions = await db.all(`SELECT id, question, options, answer, explanation FROM quiz_questions WHERE id IN (${placeholders})`, questionIds);
      questions = questions.map(q => ({ ...q, options: JSON.parse(q.options) }));
    }
  }
  if (questions.length === 0) {
    let fallback = await db.all(`SELECT id, question, options, answer, explanation FROM quiz_questions WHERE type = 'choice' AND (source_category IN ('政策', '常见问题') OR category IN ('政策', '常见问题')) ORDER BY RANDOM() LIMIT 10`);
    fallback = fallback.map(q => ({ ...q, options: JSON.parse(q.options) }));
    if (fallback.length === 0) {
      const knowledge = await db.all(`SELECT id, title, content, type FROM knowledge WHERE status = 'approved' AND category IN ('政策', '常见问题') ORDER BY RANDOM() LIMIT 10`);
      if (knowledge.length === 0) return res.status(500).json({ error: '无可用题目来源' });
      for (const k of knowledge) {
        const choice = await generateChoice(k, true);
        if (choice) {
          const qid = `temp_${Date.now()}_${Math.random().toString(36).substr(2,6)}`;
          await db.run(`INSERT INTO quiz_questions (id, type, question, options, answer, explanation, category, difficulty, source_category, created_at) VALUES ($1, 'choice', $2, $3, $4, $5, $6, $7, $8, $9)`,
            [qid, choice.question, JSON.stringify(choice.options), choice.answer, choice.explanation, k.category, 1, k.category, new Date().toISOString()]);
          fallback.push({ id: qid, question: choice.question, options: choice.options, answer: choice.answer, explanation: choice.explanation });
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
    cachedWeeklyContest = { id: contestId, questions: JSON.stringify(questions.map(q => q.id)) };
    cachedWeekStart = startStr;
  }
  const attemptsCount = (await db.get(`SELECT COUNT(*) as count FROM weekly_contest_attempts WHERE contest_id = $1 AND user_id = $2`, [contest.id, userId])).count;
  if (attemptsCount >= 3) return res.status(403).json({ error: '本周参赛次数已达上限（3次）' });
  const attemptNumber = attemptsCount + 1;
  res.json({ contestId: contest.id, questions, attemptNumber });
});

router.post('/weekly/submit', async (req, res) => {
  const { contestId, answers, timeUsed, attemptNumber } = req.body;
  const userId = req.user.userId;
  const contest = await db.get(`SELECT * FROM weekly_contest WHERE id = $1 AND status = 'active'`, [contestId]);
  if (!contest) return res.status(400).json({ error: '竞赛已结束' });
  const existing = await db.get(`SELECT id FROM weekly_contest_attempts WHERE contest_id = $1 AND user_id = $2 AND attempt_number = $3`, [contestId, userId, attemptNumber]);
  if (existing) return res.status(400).json({ error: '已提交过本次竞赛' });
  let correct = 0;
  const totalQuestions = answers.length;
  for (const ans of answers) {
    const q = await db.get(`SELECT answer FROM quiz_questions WHERE id = $1`, [ans.questionId]);
    if (q && q.answer == ans.selected) correct++;
  }
  const attemptId = uuidv4();
  await db.run(`INSERT INTO weekly_contest_attempts (id, contest_id, user_id, attempt_number, score, total_questions, time_used, submitted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [attemptId, contestId, userId, attemptNumber, correct, totalQuestions, timeUsed]);
  const points = correct * 5;
  await db.run(`INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [uuidv4(), userId, points, `每周竞赛得分${correct}/${totalQuestions}`, new Date().toISOString()]);
  for (let i = 0; i < answers.length; i++) {
    const ans = answers[i];
    const q = await db.get(`SELECT answer FROM quiz_questions WHERE id = $1`, [ans.questionId]);
    if (q && q.answer != ans.selected) {
      const today = new Date().toISOString().slice(0,10);
      const existing = await db.get(`SELECT * FROM wrong_questions WHERE user_id = $1 AND question_id = $2 AND question_type = 'choice'`, [userId, ans.questionId]);
      if (existing) await db.run(`UPDATE wrong_questions SET wrong_count = wrong_count + 1, last_wrong_date = $1 WHERE id = $2`, [today, existing.id]);
      else await db.run(`INSERT INTO wrong_questions (id, user_id, question_id, question_type, wrong_count, last_wrong_date) VALUES ($1, $2, $3, 'choice', 1, $4)`, [uuidv4(), userId, ans.questionId, today]);
    }
  }
  res.json({ score: correct, total: totalQuestions, rewardPoints: points });
});

router.get('/weekly/rank/:contestId', async (req, res) => {
  const ranks = await db.all(`
    SELECT u.username, a.score, a.total_questions, a.time_used, ROUND(CAST(a.score AS DECIMAL) / a.total_questions * 100, 1) as accuracy
    FROM weekly_contest_attempts a JOIN users u ON a.user_id = u.id WHERE a.contest_id = $1
    ORDER BY (a.score * 1.0 / a.total_questions) DESC, a.time_used ASC LIMIT 10`, [req.params.contestId]);
  res.json(ranks);
});

// ==================== 错题本 ====================

router.get('/wrong-questions', async (req, res) => {
  const userId = req.user.userId;
  const wrongs = await db.all(`
    SELECT w.id, w.question_id, w.question_type, w.wrong_count, 
           q.question, q.options, q.answer, q.explanation,
           f.sentence as fill_question, f.correct_word as fill_answer, f.hint as fill_hint
    FROM wrong_questions w
    LEFT JOIN quiz_questions q ON w.question_id = q.id AND w.question_type = 'choice'
    LEFT JOIN fill_questions f ON w.question_id = f.id AND w.question_type = 'fill'
    WHERE w.user_id = $1 AND w.question_type IN ('choice', 'fill')
    ORDER BY w.last_wrong_date DESC`, [userId]);
  const formatted = wrongs.map(w => {
    if (w.question_type === 'choice') return { id: w.id, question_id: w.question_id, type: 'choice', question: w.question, options: w.options ? JSON.parse(w.options) : [], answer: w.answer, explanation: w.explanation, wrong_count: w.wrong_count };
    else return { id: w.id, question_id: w.question_id, type: 'fill', question: w.fill_question, answer: w.fill_answer, hint: w.fill_hint, wrong_count: w.wrong_count };
  });
  res.json({ questions: formatted });
});

router.post('/wrong-questions/clear', async (req, res) => {
  const { answers } = req.body;
  const userId = req.user.userId;
  let clearedCount = 0;
  for (const ans of answers) {
    if (ans.questionType === 'choice') {
      const q = await db.get(`SELECT answer FROM quiz_questions WHERE id = $1`, [ans.questionId]);
      if (q && q.answer == ans.selected) {
        await db.run(`DELETE FROM wrong_questions WHERE user_id = $1 AND question_id = $2 AND question_type = 'choice'`, [userId, ans.questionId]);
        clearedCount++;
      }
    } else if (ans.questionType === 'fill') {
      const f = await db.get(`SELECT correct_word FROM fill_questions WHERE id = $1`, [ans.questionId]);
      if (f && f.correct_word.trim().toLowerCase() === String(ans.userAnswer).trim().toLowerCase()) {
        await db.run(`DELETE FROM wrong_questions WHERE user_id = $1 AND question_id = $2 AND question_type = 'fill'`, [userId, ans.questionId]);
        clearedCount++;
      }
    }
  }
  const reward = clearedCount * 10;
  if (reward > 0) {
    await db.run(`INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)`, [uuidv4(), userId, reward, `错题闯关答对${clearedCount}题`, new Date().toISOString()]);
  }
  res.json({ clearedCount, rewardPoints: reward });
});

router.post('/wrong-questions/record', async (req, res) => {
  const { questionId, userAnswer, questionType = 'choice' } = req.body;
  const userId = req.user.userId;
  let isCorrect = false;
  let correctAnswer = '';
  if (questionType === 'choice') {
    const q = await db.get(`SELECT answer FROM quiz_questions WHERE id = $1`, [questionId]);
    if (q) { correctAnswer = q.answer; isCorrect = (parseInt(q.answer) === parseInt(userAnswer)); }
  } else if (questionType === 'fill') {
    const f = await db.get(`SELECT correct_word FROM fill_questions WHERE id = $1`, [questionId]);
    if (f) { correctAnswer = f.correct_word; isCorrect = (f.correct_word.trim().toLowerCase() === String(userAnswer).trim().toLowerCase()); }
  }
  if (!isCorrect) {
    const today = new Date().toISOString().slice(0,10);
    const existing = await db.get(`SELECT * FROM wrong_questions WHERE user_id = $1 AND question_id = $2 AND question_type = $3`, [userId, questionId, questionType]);
    if (existing) await db.run(`UPDATE wrong_questions SET wrong_count = wrong_count + 1, last_wrong_date = $1 WHERE id = $2`, [today, existing.id]);
    else await db.run(`INSERT INTO wrong_questions (id, user_id, question_id, question_type, wrong_count, last_wrong_date) VALUES ($1, $2, $3, $4, 1, $5)`, [uuidv4(), userId, questionId, questionType, today]);
  }
  res.json({ recorded: true, correct: isCorrect, correctAnswer });
});

// ==================== 其他 ====================

router.post('/add-points', async (req, res) => {
  const { points, reason } = req.body;
  const userId = req.user.userId;
  await db.run(`INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)`, [uuidv4(), userId, points, reason, new Date().toISOString()]);
  res.json({ success: true });
});

module.exports = router;