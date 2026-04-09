// routes/game.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../services/db');
const { chat } = require('../services/openai');
const { generateChoice, generateFill } = require('../services/questionGenerator');

const router = express.Router();

// ==================== 政策闯关（主题+关卡） ====================
router.get('/themes', async (req, res) => {
    const userId = req.user.userId;
    const themes = await db.all(`SELECT * FROM game_themes WHERE is_active = 1 ORDER BY sort_order`);
    for (const theme of themes) {
        const levels = await db.all(`SELECT * FROM game_levels WHERE theme_id = ? ORDER BY level_num`, [theme.id]);
        for (const level of levels) {
            const progress = await db.get(`SELECT completed, best_score FROM user_game_progress WHERE user_id = ? AND level_id = ?`, [userId, level.id]);
            level.completed = progress ? (progress.completed === 1) : false;
            level.bestScore = progress ? progress.best_score : 0;
        }
        theme.levels = levels;
    }
    res.json(themes);
});

router.get('/level/:levelId', async (req, res) => {
    const userId = req.user.userId;
    const level = await db.get(`SELECT * FROM game_levels WHERE id = ?`, [req.params.levelId]);
    if (!level) return res.status(404).json({ error: '关卡不存在' });
    // 检查解锁条件
    if (level.unlock_points > 0) {
        const totalPoints = await getUserTotalPoints(userId);
        if (totalPoints < level.unlock_points) {
            return res.status(403).json({ error: `需要${level.unlock_points}积分才能解锁` });
        }
    }
    const questionIds = await db.all(`SELECT question_id FROM game_level_questions WHERE level_id = ?`, [level.id]);
    if (questionIds.length === 0) return res.status(404).json({ error: '关卡无题目' });
    const placeholders = questionIds.map(() => '?').join(',');
    const questions = await db.all(`SELECT id, question, options, answer, explanation FROM quiz_questions WHERE id IN (${placeholders})`, questionIds.map(q => q.question_id));
    res.json(questions.map(q => ({ ...q, options: JSON.parse(q.options) })));
});

router.post('/level/submit', async (req, res) => {
    const { levelId, answers } = req.body;
    const userId = req.user.userId;
    const level = await db.get(`SELECT * FROM game_levels WHERE id = ?`, [levelId]);
    if (!level) return res.status(404).json({ error: '关卡不存在' });
    let correctCount = 0;
    for (const ans of answers) {
        const q = await db.get(`SELECT answer FROM quiz_questions WHERE id = ?`, [ans.questionId]);
        if (q && q.answer === ans.selected) correctCount++;
    }
    const totalScore = correctCount * 10;
    const maxScore = level.question_count * 10;
    const passed = totalScore >= (level.passing_score / 100) * maxScore;
    const existing = await db.get(`SELECT * FROM user_game_progress WHERE user_id = ? AND level_id = ?`, [userId, levelId]);
    if (existing) {
        if (existing.completed) return res.json({ passed: true, alreadyCompleted: true, reward: 0 });
        await db.run(`UPDATE user_game_progress SET completed = ?, best_score = ?, attempts = attempts + 1, completed_at = ? WHERE id = ?`,
            [passed ? 1 : 0, Math.max(existing.best_score, totalScore), passed ? new Date().toISOString() : null, existing.id]);
    } else {
        await db.run(`INSERT INTO user_game_progress (id, user_id, level_id, completed, best_score, attempts, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [uuidv4(), userId, levelId, passed ? 1 : 0, totalScore, 1, passed ? new Date().toISOString() : null]);
    }
    let reward = 0;
    if (passed && (!existing || !existing.completed)) {
        reward = level.reward_points;
        await db.run(`INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES (?, ?, ?, ?, ?)`,
            [uuidv4(), userId, reward, `通关关卡：${level.name}`, new Date().toISOString()]);
    }
    res.json({ passed, totalScore, maxScore, reward });
});

// ==================== 每日一练 ====================
router.get('/daily', async (req, res) => {
    const userId = req.user.userId;
    const today = new Date().toISOString().slice(0, 10);
    let daily = await db.get(`SELECT * FROM daily_quiz WHERE user_id = ? AND quiz_date = ?`, [userId, today]);
    if (daily && daily.completed) {
        const questions = await db.all(`SELECT q.id, q.question, q.options, q.answer, q.explanation FROM daily_quiz_questions dq JOIN quiz_questions q ON dq.question_id = q.id WHERE dq.quiz_id = ?`, [daily.id]);
        return res.json({ quizId: daily.id, questions: questions.map(q => ({ ...q, options: JSON.parse(q.options) })), completed: true, score: daily.score });
    }
    // 从 quiz_questions 随机取5题
    let questions = await db.all(`SELECT id, question, options, answer, explanation FROM quiz_questions ORDER BY RANDOM() LIMIT 5`);
    if (questions.length === 0) {
        // 动态生成
        const knowledge = await db.all(`SELECT id, title, content, type, category FROM knowledge WHERE status = 'approved' ORDER BY RANDOM() LIMIT 5`);
        if (knowledge.length === 0) return res.status(404).json({ error: '无可用题目' });
        for (const k of knowledge) {
            const choice = await generateChoice(k, true);
            if (choice) {
                const qid = `dyn_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                await db.run(`INSERT INTO quiz_questions (id, type, question, options, answer, explanation, category, theme, difficulty, created_at) VALUES (?, 'choice', ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [qid, choice.question, JSON.stringify(choice.options), choice.answer, choice.explanation, k.category, k.type, 1, new Date().toISOString()]);
                questions.push({ id: qid, question: choice.question, options: JSON.stringify(choice.options), answer: choice.answer, explanation: choice.explanation });
            }
        }
    }
    const quizId = uuidv4();
    await db.run(`INSERT INTO daily_quiz (id, user_id, quiz_date, score, completed, created_at) VALUES (?, ?, ?, 0, 0, ?)`, [quizId, userId, today, new Date().toISOString()]);
    for (const q of questions) {
        await db.run(`INSERT INTO daily_quiz_questions (id, quiz_id, question_id) VALUES (?, ?, ?)`, [uuidv4(), quizId, q.id]);
    }
    res.json({ quizId, questions: questions.map(q => ({ ...q, options: JSON.parse(q.options) })), completed: false });
});

router.post('/daily/submit', async (req, res) => {
    const { quizId, answers } = req.body;
    const userId = req.user.userId;
    const daily = await db.get(`SELECT * FROM daily_quiz WHERE id = ? AND user_id = ?`, [quizId, userId]);
    if (!daily || daily.completed) return res.status(400).json({ error: '无效或已提交' });
    let score = 0;
    for (const ans of answers) {
        const q = await db.get(`SELECT answer FROM quiz_questions WHERE id = ?`, [ans.questionId]);
        if (q && q.answer === ans.selected) score++;
    }
    await db.run(`UPDATE daily_quiz SET score = ?, completed = 1 WHERE id = ?`, [score, quizId]);
    const rewardPoints = score * 10 + (score === answers.length ? 20 : 0);
    await db.run(`INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), userId, rewardPoints, `每日一练得分${score}/${answers.length}`, new Date().toISOString()]);
    res.json({ score, total: answers.length, rewardPoints });
});

// ==================== 填空每日练 ====================
router.get('/fill-daily', async (req, res) => {
    const userId = req.user.userId;
    const today = new Date().toISOString().slice(0, 10);
    let fillDaily = await db.get(`SELECT * FROM fill_daily WHERE user_id = ? AND date = ?`, [userId, today]);
    if (fillDaily && fillDaily.completed) {
        const questions = JSON.parse(fillDaily.questions);
        return res.json({ questions, completed: true, score: fillDaily.score });
    }
    let questions = await db.all(`SELECT id, sentence, correct_word, hint FROM fill_questions ORDER BY RANDOM() LIMIT 5`);
    if (questions.length === 0) {
        const knowledge = await db.all(`SELECT id, title, content, type FROM knowledge WHERE status = 'approved' ORDER BY RANDOM() LIMIT 5`);
        if (knowledge.length === 0) return res.status(404).json({ error: '无知识库' });
        for (const k of knowledge) {
            const fill = await generateFill(k, true);
            if (fill) {
                const fid = `dyn_fill_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                await db.run(`INSERT INTO fill_questions (id, sentence, correct_word, hint, category) VALUES (?, ?, ?, ?, ?)`,
                    [fid, fill.sentence, fill.correct_word, fill.hint, k.type]);
                questions.push({ id: fid, sentence: fill.sentence, correct_word: fill.correct_word, hint: fill.hint });
            }
        }
    }
    const fillId = uuidv4();
    await db.run(`INSERT INTO fill_daily (id, user_id, date, questions, completed, score) VALUES (?, ?, ?, ?, 0, 0)`,
        [fillId, userId, today, JSON.stringify(questions)]);
    res.json({ questions: questions.map(q => ({ id: q.id, sentence: q.sentence, hint: q.hint })), completed: false });
});

router.post('/fill-daily/submit', async (req, res) => {
    const { answers } = req.body;
    const userId = req.user.userId;
    const today = new Date().toISOString().slice(0, 10);
    const fillDaily = await db.get(`SELECT * FROM fill_daily WHERE user_id = ? AND date = ? AND completed = 0`, [userId, today]);
    if (!fillDaily) return res.status(400).json({ error: '今日填空已完成或不存在' });
    const questions = JSON.parse(fillDaily.questions);
    let correctCount = 0;
    for (let i = 0; i < questions.length; i++) {
        if (answers[i] && answers[i].trim().toLowerCase() === questions[i].correct_word.toLowerCase()) correctCount++;
    }
    const rewardPoints = correctCount * 5;
    await db.run(`UPDATE fill_daily SET completed = 1, score = ? WHERE id = ?`, [correctCount, fillDaily.id]);
    if (rewardPoints > 0) {
        await db.run(`INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES (?, ?, ?, ?, ?)`,
            [uuidv4(), userId, rewardPoints, `填空每日练答对${correctCount}题`, new Date().toISOString()]);
    }
    res.json({ correctCount, total: questions.length, rewardPoints });
});

// ==================== 每周竞赛 ====================
router.get('/weekly/current', async (req, res) => {
    const now = new Date();
    const day = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - day + (day === 0 ? -6 : 1));
    weekStart.setHours(0, 0, 0, 0);
    const startStr = weekStart.toISOString().slice(0, 10);
    let contest = await db.get(`SELECT * FROM weekly_contest WHERE week_start = ?`, [startStr]);
    let questions = [];
    if (contest) {
        const questionIds = JSON.parse(contest.questions);
        if (questionIds.length) {
            const placeholders = questionIds.map(() => '?').join(',');
            questions = await db.all(`SELECT id, question, options, answer FROM quiz_questions WHERE id IN (${placeholders})`, questionIds);
        }
    }
    if (questions.length === 0) {
        // 动态生成10道题
        const knowledge = await db.all(`SELECT id, title, content, type, category FROM knowledge WHERE status = 'approved' ORDER BY RANDOM() LIMIT 10`);
        if (knowledge.length === 0) return res.status(404).json({ error: '无知识库' });
        for (const k of knowledge) {
            const choice = await generateChoice(k, true);
            if (choice) {
                const qid = `week_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                await db.run(`INSERT INTO quiz_questions (id, type, question, options, answer, explanation, category, theme, difficulty, created_at) VALUES (?, 'choice', ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [qid, choice.question, JSON.stringify(choice.options), choice.answer, choice.explanation, k.category, k.type, 1, new Date().toISOString()]);
                questions.push({ id: qid, question: choice.question, options: JSON.stringify(choice.options), answer: choice.answer });
            }
        }
        const contestId = uuidv4();
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        const endStr = weekEnd.toISOString().slice(0, 10);
        await db.run(`INSERT INTO weekly_contest (id, week_start, week_end, questions, status) VALUES (?, ?, ?, ?, 'active')`,
            [contestId, startStr, endStr, JSON.stringify(questions.map(q => q.id))]);
        contest = { id: contestId };
    }
    res.json({ contestId: contest.id, questions: questions.map(q => ({ ...q, options: JSON.parse(q.options) })) });
});

router.post('/weekly/submit', async (req, res) => {
    const { contestId, answers, timeUsed } = req.body;
    const userId = req.user.userId;
    const contest = await db.get(`SELECT * FROM weekly_contest WHERE id = ? AND status = 'active'`, [contestId]);
    if (!contest) return res.status(400).json({ error: '竞赛已结束' });
    let correct = 0;
    for (const ans of answers) {
        const q = await db.get(`SELECT answer FROM quiz_questions WHERE id = ?`, [ans.questionId]);
        if (q && q.answer === ans.selected) correct++;
    }
    const existing = await db.get(`SELECT * FROM weekly_contest_scores WHERE contest_id = ? AND user_id = ?`, [contestId, userId]);
    if (existing) {
        await db.run(`UPDATE weekly_contest_scores SET score = ?, time_used = ?, submitted_at = ? WHERE id = ?`,
            [correct, timeUsed, new Date().toISOString(), existing.id]);
    } else {
        await db.run(`INSERT INTO weekly_contest_scores (id, contest_id, user_id, score, time_used, submitted_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [uuidv4(), contestId, userId, correct, timeUsed, new Date().toISOString()]);
    }
    const points = correct * 5;
    await db.run(`INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), userId, points, `每周竞赛得分${correct}`, new Date().toISOString()]);
    res.json({ score: correct, total: answers.length, rewardPoints: points });
});

router.get('/weekly/rank/:contestId', async (req, res) => {
    const ranks = await db.all(
        `SELECT u.username, w.score, w.time_used FROM weekly_contest_scores w JOIN users u ON w.user_id = u.id WHERE w.contest_id = ? ORDER BY w.score DESC, w.time_used ASC LIMIT 10`,
        [req.params.contestId]
    );
    res.json(ranks);
});

// ==================== 错题本 ====================
router.get('/wrong-questions', async (req, res) => {
    const userId = req.user.userId;
    const wrongs = await db.all(
        `SELECT w.question_id, w.wrong_count, q.question, q.options, q.answer, q.explanation FROM wrong_questions w JOIN quiz_questions q ON w.question_id = q.id WHERE w.user_id = ?`,
        [userId]
    );
    res.json(wrongs.map(w => ({ ...w, options: JSON.parse(w.options) })));
});

router.post('/wrong-questions/clear', async (req, res) => {
    const { answers } = req.body;
    const userId = req.user.userId;
    let clearedCount = 0;
    for (const ans of answers) {
        const q = await db.get(`SELECT answer FROM quiz_questions WHERE id = ?`, [ans.questionId]);
        if (q && q.answer === ans.selected) {
            await db.run(`DELETE FROM wrong_questions WHERE user_id = ? AND question_id = ?`, [userId, ans.questionId]);
            clearedCount++;
        }
    }
    const reward = clearedCount * 10;
    if (reward > 0) {
        await db.run(`INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES (?, ?, ?, ?, ?)`,
            [uuidv4(), userId, reward, `错题闯关答对${clearedCount}题`, new Date().toISOString()]);
    }
    res.json({ clearedCount, rewardPoints: reward });
});

router.post('/wrong-questions/record', async (req, res) => {
    const { questionId, userAnswer } = req.body;
    const userId = req.user.userId;
    const q = await db.get(`SELECT answer FROM quiz_questions WHERE id = ?`, [questionId]);
    if (!q) return res.status(404).json({ error: '题目不存在' });
    const isCorrect = (q.answer === userAnswer);
    if (!isCorrect) {
        const today = new Date().toISOString().slice(0, 10);
        const existing = await db.get(`SELECT * FROM wrong_questions WHERE user_id = ? AND question_id = ?`, [userId, questionId]);
        if (existing) {
            await db.run(`UPDATE wrong_questions SET wrong_count = wrong_count + 1, last_wrong_date = ? WHERE id = ?`, [today, existing.id]);
        } else {
            await db.run(`INSERT INTO wrong_questions (id, user_id, question_id, wrong_count, last_wrong_date) VALUES (?, ?, ?, 1, ?)`,
                [uuidv4(), userId, questionId, today]);
        }
    }
    res.json({ recorded: true });
});

// ==================== 刮刮乐 ====================
router.get('/scratch/generate', async (req, res) => {
    const userId = req.user.userId;
    const today = new Date().toISOString().slice(0, 10);
    const count = (await db.get(`SELECT COUNT(*) as c FROM scratch_cards WHERE user_id = ? AND date(created_at) = ?`, [userId, today])).c;
    if (count >= 5) return res.status(429).json({ error: '今日刮刮卡次数已达上限' });
    const question = await db.get(`SELECT id, question, options, answer FROM quiz_questions ORDER BY RANDOM() LIMIT 1`);
    if (!question) return res.status(404).json({ error: '无题目' });
    const cardId = uuidv4();
    await db.run(`INSERT INTO scratch_cards (id, user_id, question_id, answer, reward_points, created_at) VALUES (?, ?, ?, ?, 0, ?)`,
        [cardId, userId, question.id, question.answer, new Date().toISOString()]);
    res.json({ cardId, question: question.question, options: JSON.parse(question.options) });
});

router.post('/scratch/submit', async (req, res) => {
    const { cardId, selected } = req.body;
    const userId = req.user.userId;
    const card = await db.get(`SELECT * FROM scratch_cards WHERE id = ? AND user_id = ? AND is_used = 0`, [cardId, userId]);
    if (!card) return res.status(400).json({ error: '无效刮刮卡' });
    const isCorrect = (card.answer === selected);
    let reward = 0;
    if (isCorrect) {
        reward = Math.floor(Math.random() * 20) + 10;
        await db.run(`UPDATE scratch_cards SET is_used = 1, reward_points = ?, used_at = ? WHERE id = ?`, [reward, new Date().toISOString(), cardId]);
        await db.run(`INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES (?, ?, ?, ?, ?)`,
            [uuidv4(), userId, reward, '刮刮乐奖励', new Date().toISOString()]);
    } else {
        await db.run(`UPDATE scratch_cards SET is_used = 1, used_at = ? WHERE id = ?`, [new Date().toISOString(), cardId]);
    }
    res.json({ correct: isCorrect, rewardPoints: reward });
});

// ==================== 辅助函数 ====================
async function getUserTotalPoints(userId) {
    const sessionCount = (await db.get(`SELECT COUNT(*) as c FROM sessions WHERE user_id = ?`, [userId])).c;
    const favoriteCount = (await db.get(`SELECT COUNT(*) as c FROM favorites WHERE user_id = ?`, [userId])).c;
    const favoriteSessionCount = (await db.get(`SELECT COUNT(*) as c FROM sessions WHERE user_id = ? AND favorite = 1`, [userId])).c;
    const approvedUploads = (await db.get(`SELECT COUNT(*) as c FROM knowledge WHERE submitted_by = (SELECT username FROM users WHERE id = ?) AND status = 'approved'`, [userId])).c;
    const basePoints = sessionCount * 10 + favoriteCount * 2 + favoriteSessionCount * 5 + approvedUploads * 20;
    const rewardPointsRow = await db.get(`SELECT SUM(points) as sum FROM user_points WHERE user_id = ?`, [userId]);
    const rewardPoints = rewardPointsRow.sum || 0;
    return basePoints + rewardPoints;
}

// 状态接口（用于游戏大厅）
router.get('/daily/status', async (req, res) => {
    const userId = req.user.userId;
    const today = new Date().toISOString().slice(0,10);
    const daily = await db.get(`SELECT score, completed FROM daily_quiz WHERE user_id = ? AND quiz_date = ?`, [userId, today]);
    if (daily && daily.completed) res.json({ completed: true, score: daily.score, total: 5 });
    else res.json({ completed: false });
});
router.get('/fill-daily/status', async (req, res) => {
    const userId = req.user.userId;
    const today = new Date().toISOString().slice(0,10);
    const fill = await db.get(`SELECT score, completed FROM fill_daily WHERE user_id = ? AND date = ?`, [userId, today]);
    if (fill && fill.completed) res.json({ completed: true, score: fill.score, total: 5 });
    else res.json({ completed: false });
});
router.get('/weekly/status', async (req, res) => {
    const userId = req.user.userId;
    const now = new Date();
    const day = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - day + (day === 0 ? -6 : 1));
    weekStart.setHours(0,0,0,0);
    const startStr = weekStart.toISOString().slice(0,10);
    const contest = await db.get(`SELECT id FROM weekly_contest WHERE week_start = ?`, [startStr]);
    if (contest) {
        const score = await db.get(`SELECT score FROM weekly_contest_scores WHERE contest_id = ? AND user_id = ?`, [contest.id, userId]);
        if (score) res.json({ participated: true, score: score.score });
        else res.json({ participated: false });
    } else res.json({ participated: false });
});

module.exports = router;