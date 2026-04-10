// frontend/src/modules/game.js
import { fetchWithAuth } from '../utils/api';
import { appState } from './state';
import { escapeHtml, playSound, addPoints, updateTaskProgress, setActiveNavByView } from '../utils/helpers';

// 全局状态
let currentThemes = [];
let currentLevelQuestions = [];
let currentLevelAnswers = [];
let currentLevelIndex = 0;
let currentLevelId = null;

// 每日一练
let currentDailyQuestions = [];
let currentDailyAnswers = [];
let currentDailyScores = [];
let currentDailyQuizId = null;
let dailyScore = 0;

// 每周竞赛
let currentContestId = null;
let currentContestQuestions = [];
let currentContestAnswers = [];
let contestStartTime = null;
let contestTotalTime = 120;
let contestTimerInterval = null;
let currentAttemptNumber = 1;

// 错题本
let wrongQuestionsList = [];
let currentWrongIndex = 0;
let wrongClearStartCount = 0;
let wrongClearCorrectCount = 0;

// 刮刮乐
let scratchRemaining = 0;

// 趣味闯关
let currentFunQuestions = [];
let currentFunIndex = 0;
let currentFunScore = 0;
let currentFunLives = 3;
let currentFunTheme = '';
let currentFunDifficulty = 'medium';
let currentFunEvent = null;
let currentFunEventUsed = false;

// ==================== 辅助函数 ====================
function formatAnswerLabel(question, answerIndex) {
  if (!question.options) return answerIndex;
  const text = question.options[answerIndex];
  return `${String.fromCharCode(65 + answerIndex)}. ${text}`;
}

// ==================== 通用全屏答题组件（修复下一题按钮、得分累加、正确/错误高亮） ====================
function renderGenericQuiz(config) {
  const {
    questions,
    currentIndex,
    userAnswers,
    userScores,
    totalScore,
    title,
    onSubmit,
    onFinish,
    onBack,
    extraHeader = null,
    showPrev = true,
    showSubmit = true
  } = config;

  const dynamicContent = document.getElementById('dynamicContent');
  const q = questions[currentIndex];
  const isChoice = q.type === 'choice' || q.question_type === 'choice' || q.question_type === 'judge';
  const isSort = q.question_type === 'sort';
  const isLast = currentIndex === questions.length - 1;
  const isFirst = currentIndex === 0;
  const alreadyAnswered = userAnswers[currentIndex] !== undefined && userAnswers[currentIndex] !== null;
  const alreadyCorrect = userScores[currentIndex] === true;

  let optionsHtml = '';
  if (isSort) {
    const items = q.options.map((opt, idx) => ({ text: opt, originalIdx: idx }));
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    optionsHtml = `
      <div class="sort-options" id="sortContainer">
        ${shuffled.map((item, idx) => `
          <div class="sort-item" data-idx="${item.originalIdx}" data-pos="${idx}">
            ${escapeHtml(item.text)}
          </div>
        `).join('')}
      </div>
      <div class="sort-controls">
        <button id="sortUpBtn" class="summary-btn">↑ 上移</button>
        <button id="sortDownBtn" class="summary-btn">↓ 下移</button>
      </div>
    `;
  } else {
    optionsHtml = `
      <div class="quiz-options-list">
        ${q.options.map((opt, idx) => `
          <div class="quiz-option-item ${userAnswers[currentIndex] === idx ? 'selected' : ''}" data-opt="${idx}">
            <span class="option-prefix">${String.fromCharCode(65+idx)}.</span>
            ${escapeHtml(opt)}
          </div>
        `).join('')}
      </div>
    `;
  }

  dynamicContent.innerHTML = `
    <div class="fullscreen-quiz">
      <div class="quiz-header">
        <button class="back-btn" id="quizBackBtn">← 返回</button>
        <div class="quiz-title">${escapeHtml(title)}</div>
        <div class="quiz-progress">第 ${currentIndex+1} / ${questions.length} 题</div>
        <div class="quiz-score" id="quizScoreDisplay">得分: ${totalScore}</div>
        ${extraHeader ? extraHeader : ''}
      </div>
      <div class="quiz-body">
        <div class="question-text">${escapeHtml(q.question)}</div>
        ${optionsHtml}
        <div id="quizFeedbackArea" class="quiz-feedback-area"></div>
      </div>
      <div class="quiz-footer">
        <div class="action-buttons">
          ${showPrev && !isFirst ? `<button id="quizPrevBtn" class="action-btn">← 上一题</button>` : ''}
          ${showSubmit && !alreadyAnswered ? `<button id="quizSubmitBtn" class="action-btn submit">提交答案</button>` : ''}
          ${alreadyAnswered && !isLast ? `<button id="quizNextBtn" class="action-btn">下一题 →</button>` : ''}
          ${alreadyAnswered && isLast ? `<button id="quizFinishBtn" class="action-btn finish">完成闯关</button>` : ''}
        </div>
      </div>
    </div>
  `;

  document.getElementById('quizBackBtn').onclick = () => {
    if (onBack) onBack();
    else renderGameView();
  };

  if (!isSort) {
    const opts = document.querySelectorAll('.quiz-option-item');
    opts.forEach(opt => {
      opt.onclick = () => {
        if (alreadyAnswered) return;
        const selected = parseInt(opt.dataset.opt);
        userAnswers[currentIndex] = selected;
        opts.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
      };
    });
  } else {
    // 排序题交互（略，保持原有）
    let sortItems = document.querySelectorAll('.sort-item');
    let selectedSortItem = null;
    function updateSortOrder() {
      const container = document.getElementById('sortContainer');
      const items = Array.from(container.children);
      items.sort((a, b) => parseInt(a.dataset.pos) - parseInt(b.dataset.pos));
      items.forEach(item => container.appendChild(item));
      container.querySelectorAll('.sort-item').forEach((item, idx) => {
        item.dataset.pos = idx;
      });
    }
    sortItems.forEach(item => {
      item.onclick = () => {
        if (alreadyAnswered) return;
        sortItems.forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        selectedSortItem = item;
      };
    });
    const sortUpBtn = document.getElementById('sortUpBtn');
    const sortDownBtn = document.getElementById('sortDownBtn');
    if (sortUpBtn) {
      sortUpBtn.onclick = () => {
        if (!selectedSortItem || alreadyAnswered) return;
        const pos = parseInt(selectedSortItem.dataset.pos);
        if (pos > 0) {
          const prev = document.querySelector(`.sort-item[data-pos="${pos-1}"]`);
          if (prev) {
            prev.dataset.pos = pos;
            selectedSortItem.dataset.pos = pos-1;
            updateSortOrder();
            selectedSortItem = document.querySelector(`.sort-item[data-pos="${pos-1}"]`);
            selectedSortItem.classList.add('selected');
          }
        }
      };
    }
    if (sortDownBtn) {
      sortDownBtn.onclick = () => {
        if (!selectedSortItem || alreadyAnswered) return;
        const pos = parseInt(selectedSortItem.dataset.pos);
        const max = sortItems.length - 1;
        if (pos < max) {
          const next = document.querySelector(`.sort-item[data-pos="${pos+1}"]`);
          if (next) {
            next.dataset.pos = pos;
            selectedSortItem.dataset.pos = pos+1;
            updateSortOrder();
            selectedSortItem = document.querySelector(`.sort-item[data-pos="${pos+1}"]`);
            selectedSortItem.classList.add('selected');
          }
        }
      };
    }
  }

  const submitBtn = document.getElementById('quizSubmitBtn');
  if (submitBtn) {
    submitBtn.onclick = async () => {
      let userAnswer;
      if (isSort) {
        const items = Array.from(document.querySelectorAll('.sort-item'));
        userAnswer = items.map(item => parseInt(item.dataset.idx));
      } else {
        if (userAnswers[currentIndex] === undefined || userAnswers[currentIndex] === null) {
          alert('请选择答案');
          return;
        }
        userAnswer = userAnswers[currentIndex];
      }
      const result = await onSubmit(currentIndex, userAnswer);
      if (result) {
        const { correct, correctLabel, explanation, pointsGain, livesRemaining } = result;
        const feedbackDiv = document.getElementById('quizFeedbackArea');
        if (correct) {
          if (!userScores[currentIndex]) {
            userScores[currentIndex] = true;
            config.totalScore = (config.totalScore || 0) + (pointsGain || 10);
            // 更新得分显示
            const scoreDisplay = document.getElementById('quizScoreDisplay');
            if (scoreDisplay) scoreDisplay.textContent = `得分: ${config.totalScore}`;
          }
          feedbackDiv.innerHTML = `<div class="feedback-correct">✅ 回答正确！${pointsGain ? ` +${pointsGain} 积分` : ''}<br>${explanation ? '解析：'+escapeHtml(explanation) : ''}</div>`;
          playSound('complete');
        } else {
          feedbackDiv.innerHTML = `<div class="feedback-wrong">❌ 回答错误！正确答案是：${escapeHtml(correctLabel)}<br>${explanation ? '解析：'+escapeHtml(explanation) : ''}</div>`;
          playSound('error');
          if (livesRemaining !== undefined && livesRemaining <= 0) {
            alert('💀 生命值归零，闯关失败！');
            if (onFinish) onFinish(config.totalScore);
            return;
          }
        }
        if (!isSort) {
          const opts = document.querySelectorAll('.quiz-option-item');
          const correctIndex = q.answer;
          opts.forEach(opt => {
            const optVal = parseInt(opt.dataset.opt);
            if (optVal === correctIndex) opt.classList.add('correct');
            if (optVal === userAnswer && !correct) opt.classList.add('wrong');
          });
        } else {
          const correctOrder = q.answer;
          const correctOrderText = correctOrder.map(idx => q.options[idx]).join(' → ');
          feedbackDiv.innerHTML += `<div class="sort-correct-order">正确顺序：${escapeHtml(correctOrderText)}</div>`;
        }
        // 更新底部按钮
        const footer = document.querySelector('.quiz-footer .action-buttons');
        if (footer) {
          footer.innerHTML = '';
          if (showPrev && !isFirst) footer.innerHTML += `<button id="quizPrevBtn" class="action-btn">← 上一题</button>`;
          if (userAnswers[currentIndex] !== null && !isLast) footer.innerHTML += `<button id="quizNextBtn" class="action-btn">下一题 →</button>`;
          if (userAnswers[currentIndex] !== null && isLast) footer.innerHTML += `<button id="quizFinishBtn" class="action-btn finish">完成闯关</button>`;
          // 重新绑定事件
          const newPrev = document.getElementById('quizPrevBtn');
          if (newPrev) newPrev.onclick = () => {
            renderGenericQuiz({
              ...config,
              currentIndex: currentIndex - 1,
              userAnswers,
              userScores,
              totalScore: config.totalScore
            });
          };
          const newNext = document.getElementById('quizNextBtn');
          if (newNext) newNext.onclick = () => {
            renderGenericQuiz({
              ...config,
              currentIndex: currentIndex + 1,
              userAnswers,
              userScores,
              totalScore: config.totalScore
            });
          };
          const newFinish = document.getElementById('quizFinishBtn');
          if (newFinish) newFinish.onclick = () => {
            if (onFinish) onFinish(config.totalScore);
          };
        }
      }
    };
  }

  const prevBtn = document.getElementById('quizPrevBtn');
  if (prevBtn) {
    prevBtn.onclick = () => {
      renderGenericQuiz({
        ...config,
        currentIndex: currentIndex - 1,
        userAnswers,
        userScores,
        totalScore
      });
    };
  }

  const nextBtn = document.getElementById('quizNextBtn');
  if (nextBtn) {
    nextBtn.onclick = () => {
      renderGenericQuiz({
        ...config,
        currentIndex: currentIndex + 1,
        userAnswers,
        userScores,
        totalScore
      });
    };
  }

  const finishBtn = document.getElementById('quizFinishBtn');
  if (finishBtn) {
    finishBtn.onclick = () => {
      if (onFinish) onFinish(config.totalScore);
    };
  }
}
// ==================== 每日一练 ====================
async function startDailyQuiz() {
  const startBtn = document.getElementById('startDailyBtn');
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.textContent = '加载中...';
  }
  try {
    const res = await fetchWithAuth('/api/game/daily');
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || '加载每日练习失败');
      return;
    }
    const data = await res.json();
    if (data.completed) {
      alert(`今日已完成，得分 ${data.score}/${data.questions.length}`);
      return;
    }
    const questions = data.questions;
    const userAnswers = new Array(questions.length).fill(null);
    const userScores = new Array(questions.length).fill(false);
    let totalScore = 0;

    const onSubmit = async (index, userAnswer) => {
      const q = questions[index];
      let isCorrect = false;
      let correctLabel = '';
      if (q.type === 'choice') {
        const correctIndex = parseInt(q.answer);
        const userIndex = parseInt(userAnswer);
        isCorrect = (userIndex === correctIndex);
        correctLabel = formatAnswerLabel(q, correctIndex);
      } else {
        const correctStr = q.answer.trim().toLowerCase();
        const userStr = String(userAnswer).trim().toLowerCase();
        isCorrect = (userStr === correctStr);
        correctLabel = q.answer;
      }
      if (isCorrect) {
        if (!userScores[index]) {
          userScores[index] = true;
          totalScore += 10;
        }
      } else {
        await fetchWithAuth('/api/game/wrong-questions/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId: q.id, userAnswer })
        });
      }
      return { correct: isCorrect, correctLabel, explanation: q.explanation };
    };

    const onFinish = async (finalScore) => {
      const total = questions.length;
      const rewardPoints = finalScore;
      await fetchWithAuth('/api/game/daily/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quizId: data.quizId, score: finalScore / 10, total })
      });
      alert(`练习完成！得分 ${finalScore/10}/${total}，获得 ${rewardPoints} 积分`);
      addPoints(rewardPoints, '每日一练');
      updateTaskProgress('quiz', 1);
      await loadModuleStats();
    };

    renderGenericQuiz({
      questions,
      currentIndex: 0,
      userAnswers,
      userScores,
      totalScore,
      title: '每日一练',
      onSubmit,
      onFinish,
      onBack: () => renderGameView(),
      showPrev: true
    });
  } catch(e) {
    alert('加载每日练习失败');
  } finally {
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = '开始练习 →';
    }
  }
}

// ==================== 每周竞赛 ====================
async function startWeeklyContest() {
  const startBtn = document.getElementById('startContestBtn');
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.textContent = '加载中...';
  }
  try {
    const res = await fetchWithAuth('/api/game/weekly/current');
    if (!res.ok) {
      if (res.status === 403) {
        const err = await res.json();
        alert(err.error || '本周参赛次数已达上限');
        return;
      }
      const err = await res.json();
      alert(err.error || '竞赛加载失败，请稍后重试');
      return;
    }
    const data = await res.json();
    currentContestId = data.contestId;
    currentContestQuestions = data.questions;
    currentContestAnswers = new Array(currentContestQuestions.length).fill(null);
    contestStartTime = Date.now();
    currentAttemptNumber = data.attemptNumber;

    const userAnswers = new Array(currentContestQuestions.length).fill(null);
    const userScores = new Array(currentContestQuestions.length).fill(false);
    let totalScore = 0;

    const onSubmit = async (index, userAnswer) => {
      const q = currentContestQuestions[index];
      const correctIndex = parseInt(q.answer);
      const userIndex = parseInt(userAnswer);
      const isCorrect = (userIndex === correctIndex);
      const correctLabel = formatAnswerLabel(q, correctIndex);
      if (isCorrect) {
        if (!userScores[index]) {
          userScores[index] = true;
          totalScore += 10;
        }
      } else {
        await fetchWithAuth('/api/game/wrong-questions/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId: q.id, userAnswer })
        });
      }
      return { correct: isCorrect, correctLabel, explanation: q.explanation };
    };

    const onFinish = async (finalScore) => {
      const timeUsed = Math.floor((Date.now() - contestStartTime) / 1000);
      const answers = currentContestQuestions.map((_, i) => ({ questionId: currentContestQuestions[i].id, selected: userAnswers[i] }));
      const res = await fetchWithAuth('/api/game/weekly/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contestId: currentContestId, answers, timeUsed, attemptNumber: currentAttemptNumber })
      });
      const result = await res.json();
      if (result.score !== undefined) {
        alert(`竞赛完成！得分 ${result.score}/${result.total}，用时 ${Math.floor(timeUsed/60)}分${timeUsed%60}秒，获得 ${result.rewardPoints} 积分`);
        addPoints(result.rewardPoints, '每周竞赛');
      } else {
        alert('竞赛提交失败，请重试');
      }
      await loadModuleStats();
    };

    let interval = null;
    function updateTimerDisplay() {
      const elapsed = Math.floor((Date.now() - contestStartTime) / 1000);
      const remaining = Math.max(0, contestTotalTime - elapsed);
      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      const timerSpan = document.getElementById('contestTimer');
      if (timerSpan) timerSpan.textContent = `${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;
      if (remaining <= 0 && interval) {
        clearInterval(interval);
        alert('时间到！自动提交竞赛');
        onFinish(totalScore);
      }
    }
    interval = setInterval(updateTimerDisplay, 1000);
    updateTimerDisplay();

    renderGenericQuiz({
      questions: currentContestQuestions,
      currentIndex: 0,
      userAnswers,
      userScores,
      totalScore,
      title: `每周竞赛 (第${currentAttemptNumber}/3次)`,
      onSubmit,
      onFinish,
      onBack: () => { if (interval) clearInterval(interval); renderGameView(); },
      extraHeader: `<div class="contest-timer" id="contestTimer">02:00</div>`,
      showPrev: true
    });
  } catch(e) {
    alert('加载竞赛失败');
  } finally {
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = '参加竞赛 →';
    }
  }
}

// ==================== 趣味闯关 ====================
async function showFunLevelsModal() {
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="fullscreen-fun-selector">
      <div class="fun-selector-header">
        <button class="back-btn" id="funBackBtn">← 返回</button>
        <h2>🎮 趣味闯关</h2>
      </div>
      <div class="fun-selector-body">
        <div class="difficulty-selector">
          <button class="difficulty-btn" data-diff="easy">🌱 简单 (3题)</button>
          <button class="difficulty-btn" data-diff="medium">⚡ 中等 (5题)</button>
          <button class="difficulty-btn" data-diff="hard">🔥 困难 (8题)</button>
        </div>
        <div class="timing-mode">
          <label>
            <input type="checkbox" id="timingModeCheckbox"> ⏱️ 限时模式（每题15秒）
          </label>
        </div>
        <div class="themes-grid" id="funThemesGrid">加载中...</div>
      </div>
    </div>
  `;

  document.getElementById('funBackBtn').onclick = () => renderGameView();

  const themesRes = await fetchWithAuth('/api/game/policy-themes');
  const themes = await themesRes.json();
  const grid = document.getElementById('funThemesGrid');
  grid.innerHTML = themes.map(theme => `
    <div class="fun-theme-card" data-theme="${theme.name}" data-id="${theme.id}">
      <div class="theme-icon">${theme.icon}</div>
      <div class="theme-name">${theme.name}</div>
      <div class="theme-desc">${theme.description}</div>
      <div class="theme-status">${theme.completed ? '✅ 已通关' : '🔓 未挑战'}</div>
    </div>
  `).join('');

  let selectedDifficulty = 'medium';
  document.querySelectorAll('.difficulty-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.difficulty-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedDifficulty = btn.dataset.diff;
    };
  });
  document.querySelector('.difficulty-btn[data-diff="medium"]').classList.add('active');

  document.querySelectorAll('.fun-theme-card').forEach(card => {
    card.onclick = async () => {
      const theme = card.dataset.theme;
      const themeId = card.dataset.id;
      const timingMode = document.getElementById('timingModeCheckbox').checked;
      await startFunChallengeFullscreen(theme, themeId, selectedDifficulty, timingMode);
    };
  });
}

async function startFunChallengeFullscreen(theme, themeId, difficulty, timingMode) {
  let questionCount = 3;
  if (difficulty === 'medium') questionCount = 5;
  if (difficulty === 'hard') questionCount = 8;

  const res = await fetchWithAuth(`/api/game/fun-level-questions?theme=${encodeURIComponent(theme)}&difficulty=${difficulty}&count=${questionCount}`);
  const data = await res.json();
  let questions = data.questions;
  questions = questions.map(q => ({ ...q, question_type: q.question_type || 'choice' }));

  const userAnswers = new Array(questions.length).fill(null);
  const userScores = new Array(questions.length).fill(false);
  let totalScore = 0;
  let lives = 3;
  let eventActive = data.event;
  let eventUsed = false;

  const onSubmit = async (index, userAnswer) => {
    const q = questions[index];
    let isCorrect = false;
    let correctLabel = '';
    let pointsGain = 10;
    if (difficulty === 'hard') pointsGain += 5;
    if (eventActive === 'double' && !eventUsed && isCorrect) pointsGain *= 2;

    if (q.question_type === 'choice' || q.question_type === 'judge') {
      const correctIndex = parseInt(q.answer);
      const userIndex = parseInt(userAnswer);
      isCorrect = (userIndex === correctIndex);
      correctLabel = formatAnswerLabel(q, correctIndex);
    } else if (q.question_type === 'sort') {
      const correctOrder = q.answer;
      if (Array.isArray(userAnswer) && userAnswer.length === correctOrder.length) {
        isCorrect = userAnswer.every((val, idx) => val === correctOrder[idx]);
      }
      correctLabel = '正确顺序：' + correctOrder.map(idx => q.options[idx]).join(' → ');
    }

    if (isCorrect) {
      if (!userScores[index]) {
        userScores[index] = true;
        totalScore += pointsGain;
      }
    } else {
      lives--;
      await fetchWithAuth('/api/game/wrong-questions/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: q.id, userAnswer: JSON.stringify(userAnswer) })
      });
      if (lives <= 0) {
        alert('💀 生命值归零，闯关失败！');
        onFinish(totalScore);
        return { correct: false, correctLabel, explanation: q.explanation, pointsGain, livesRemaining: lives };
      }
    }
    return { correct: isCorrect, correctLabel, explanation: q.explanation, pointsGain, livesRemaining: lives };
  };

  const onFinish = async (finalScore) => {
    const total = questions.length;
    const passingScore = Math.ceil(total * 0.6);
    const passed = (totalScore / 10) >= passingScore;
    const reward = passed ? 50 : 0;
    await fetchWithAuth('/api/game/policy-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeId, score: totalScore / 10, total })
    });
    if (reward) addPoints(reward, '趣味闯关');
    alert(`闯关结束！得分 ${totalScore/10}/${total}，${passed ? '通关成功！' : '再接再厉！'}${reward ? ` 获得 ${reward} 积分` : ''}`);
  };

  let timerInterval = null;
  let timeLeft = 15;
  function updateTimerDisplay() {
    if (!timingMode) return;
    const timerSpan = document.getElementById('questionTimer');
    if (timerSpan) timerSpan.textContent = `⏱️ ${timeLeft}s`;
  }
  function startTimer(index, onTimeout) {
    if (!timingMode) return;
    if (timerInterval) clearInterval(timerInterval);
    timeLeft = 15;
    updateTimerDisplay();
    timerInterval = setInterval(() => {
      if (timeLeft <= 1) {
        clearInterval(timerInterval);
        onTimeout(index);
      } else {
        timeLeft--;
        updateTimerDisplay();
      }
    }, 1000);
  }
  function clearTimer() {
    if (timerInterval) clearInterval(timerInterval);
  }

  const customRender = (cfg) => {
    const extra = `
      <div class="fun-lives" id="funLivesDisplay">❤️ ${lives}</div>
      ${timingMode ? `<div class="question-timer" id="questionTimer">⏱️ 15s</div>` : ''}
      ${eventActive && !eventUsed && cfg.currentIndex === 0 ? `<div class="fun-event">${eventActive === 'double' ? '🎁 双倍积分事件！' : (eventActive === 'hint' ? '💡 提示事件！' : '⏭️ 免答事件！')}</div>` : ''}
    `;
    renderGenericQuiz({
      ...cfg,
      extraHeader: extra,
      onSubmit: async (idx, ans) => {
        clearTimer();
        const result = await onSubmit(idx, ans);
        const livesDisplay = document.getElementById('funLivesDisplay');
        if (livesDisplay && result.livesRemaining !== undefined) {
          livesDisplay.textContent = `❤️ ${result.livesRemaining}`;
        }
        return result;
      }
    });
    if (eventActive === 'hint' && !eventUsed && !userAnswers[cfg.currentIndex]) {
      setTimeout(() => {
        const hintBtn = document.getElementById('hintBtn');
        if (hintBtn) {
          hintBtn.onclick = () => {
            const correctAnswer = questions[cfg.currentIndex].question_type === 'sort'
              ? questions[cfg.currentIndex].answer.map(idx => questions[cfg.currentIndex].options[idx]).join(' → ')
              : formatAnswerLabel(questions[cfg.currentIndex], questions[cfg.currentIndex].answer);
            alert(`💡 提示：正确答案是 "${correctAnswer}"`);
            eventUsed = true;
            hintBtn.disabled = true;
          };
        }
      }, 100);
    }
    if (eventActive === 'skip' && !eventUsed && !userAnswers[cfg.currentIndex]) {
      setTimeout(() => {
        const skipBtn = document.getElementById('skipBtn');
        if (skipBtn) {
          skipBtn.onclick = () => {
            eventUsed = true;
            userScores[cfg.currentIndex] = false;
            userAnswers[cfg.currentIndex] = null;
            if (cfg.currentIndex + 1 < questions.length) {
              customRender({ ...cfg, currentIndex: cfg.currentIndex + 1 });
            } else {
              onFinish(totalScore);
            }
          };
        }
      }, 100);
    }
    if (timingMode && !userAnswers[cfg.currentIndex]) {
      startTimer(cfg.currentIndex, (idx) => {
        alert('⏰ 时间到！本题自动判错');
        onSubmit(idx, null).then(result => {
          if (result && !result.correct) {
            lives = result.livesRemaining;
            if (lives <= 0) {
              alert('💀 生命值归零，闯关失败！');
              onFinish(totalScore);
              return;
            }
            customRender({ ...cfg, currentIndex: idx });
          }
        });
      });
    }
  };

  customRender({
    questions,
    currentIndex: 0,
    userAnswers,
    userScores,
    totalScore,
    title: `趣味闯关 · ${theme} · ${difficulty === 'easy' ? '简单' : difficulty === 'medium' ? '中等' : '困难'}`,
    onSubmit,
    onFinish,
    onBack: () => { clearTimer(); renderGameView(); },
    showPrev: true
  });
}
// ==================== 政策连连看（改进配对内容、增加视觉反馈） ====================
async function startMatchGame() {
  const difficulty = 'medium';
  const res = await fetchWithAuth(`/api/game/match-game?difficulty=${difficulty}`);
  const data = await res.json();
  const pairs = data.pairs;
  const totalPairs = data.pairCount;

  let selectedCard = null;
  let matchedPairs = 0;
  let lock = false;

  function renderMatchGame() {
    const dynamicContent = document.getElementById('dynamicContent');
    dynamicContent.innerHTML = `
      <div class="fullscreen-match">
        <div class="match-header">
          <button class="back-btn" id="matchBackBtn">← 返回</button>
          <h2>🔗 政策连连看</h2>
          <div>配对进度: ${matchedPairs} / ${totalPairs}</div>
        </div>
        <div class="match-grid">
          ${pairs.map((card, idx) => `
            <div class="match-card ${card.matched ? 'matched' : ''}" data-idx="${idx}" data-pair="${card.pairId}" data-type="${card.type}">
              <div class="match-card-content">${escapeHtml(card.text)}</div>
            </div>
          `).join('')}
        </div>
        <div class="match-footer">
          ${matchedPairs === totalPairs ? '<button id="matchFinishBtn" class="submit-btn">领取奖励</button>' : ''}
        </div>
      </div>
    `;

    document.getElementById('matchBackBtn').onclick = () => renderGameView();

    const cards = document.querySelectorAll('.match-card');
    cards.forEach(card => {
      card.onclick = () => {
        if (lock) return;
        if (card.classList.contains('matched')) return;
        if (selectedCard === null) {
          selectedCard = card;
          card.classList.add('selected');
        } else {
          if (selectedCard === card) {
            selectedCard.classList.remove('selected');
            selectedCard = null;
            return;
          }
          lock = true;
          const firstPair = selectedCard.dataset.pair;
          const secondPair = card.dataset.pair;
          const firstType = selectedCard.dataset.type;
          const secondType = card.dataset.type;

          if (firstPair === secondPair && firstType !== secondType) {
            selectedCard.classList.add('matched');
            card.classList.add('matched');
            selectedCard.classList.remove('selected');
            matchedPairs++;
            const progressDiv = document.querySelector('.match-header div:last-child');
            if (progressDiv) progressDiv.textContent = `配对进度: ${matchedPairs} / ${totalPairs}`;
            if (matchedPairs === totalPairs) {
              const footer = document.querySelector('.match-footer');
              footer.innerHTML = '<button id="matchFinishBtn" class="submit-btn">领取奖励</button>';
              document.getElementById('matchFinishBtn').onclick = finishMatch;
            }
            playSound('complete');
          } else {
            selectedCard.classList.add('error');
            card.classList.add('error');
            setTimeout(() => {
              selectedCard.classList.remove('error', 'selected');
              card.classList.remove('error');
            }, 500);
            playSound('error');
          }
          selectedCard = null;
          setTimeout(() => { lock = false; }, 500);
        }
      };
    });
  }

  async function finishMatch() {
    const res = await fetchWithAuth('/api/game/match-game/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: matchedPairs, total: totalPairs })
    });
    const result = await res.json();
    alert(`恭喜完成连连看！获得 ${result.reward} 积分`);
    addPoints(result.reward, '连连看');
    renderGameView();
  }

  renderMatchGame();
}

// ==================== 错题本（全屏版本） ====================
async function startWrongClear() {
  const res = await fetchWithAuth('/api/game/wrong-questions');
  const wrongs = await res.json();
  if (wrongs.length === 0) {
    alert('暂无错题');
    return;
  }
  const questions = wrongs.map(w => ({
    id: w.question_id,
    type: 'choice',
    question: w.question,
    options: w.options,
    answer: w.answer,
    explanation: w.explanation
  }));
  const userAnswers = new Array(questions.length).fill(null);
  const userScores = new Array(questions.length).fill(false);
  let totalScore = 0;
  let clearedCount = 0;

  const onSubmit = async (index, userAnswer) => {
    const q = questions[index];
    const correctIndex = parseInt(q.answer);
    const userIndex = parseInt(userAnswer);
    const isCorrect = (userIndex === correctIndex);
    const correctLabel = formatAnswerLabel(q, correctIndex);
    if (isCorrect) {
      if (!userScores[index]) {
        userScores[index] = true;
        const res = await fetchWithAuth('/api/game/wrong-questions/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: [{ questionId: q.id, selected: userIndex }] })
        });
        const result = await res.json();
        if (result.clearedCount > 0) {
          clearedCount++;
          totalScore += 10;
        }
      }
    } else {
      await fetchWithAuth('/api/game/wrong-questions/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: q.id, userAnswer })
      });
    }
    return { correct: isCorrect, correctLabel, explanation: q.explanation };
  };

  const onFinish = async (finalScore) => {
    alert(`错题闯关结束！本次共答对 ${clearedCount} 题，获得 ${finalScore} 积分`);
    addPoints(finalScore, '错题闯关');
    await loadModuleStats();
    renderGameView();
  };

  renderGenericQuiz({
    questions,
    currentIndex: 0,
    userAnswers,
    userScores,
    totalScore,
    title: '错题闯关',
    onSubmit,
    onFinish,
    onBack: () => renderGameView(),
    showPrev: true
  });
}

// ==================== 刮刮乐 ====================
async function updateScratchRemaining() {
  try {
    const res = await fetchWithAuth('/api/game/scratch/today-count');
    if (res.ok) {
      const data = await res.json();
      const count = data.count;
      scratchRemaining = Math.max(0, 5 - count);
      const today = new Date().toISOString().slice(0,10);
      if (count === 0) {
        localStorage.removeItem('scratch_count');
        localStorage.removeItem('scratch_date');
      } else {
        localStorage.setItem('scratch_date', today);
        localStorage.setItem('scratch_count', count);
      }
    } else {
      const today = new Date().toISOString().slice(0,10);
      const storedDate = localStorage.getItem('scratch_date');
      let count = parseInt(localStorage.getItem('scratch_count')) || 0;
      if (storedDate !== today) {
        count = 0;
        localStorage.setItem('scratch_date', today);
        localStorage.setItem('scratch_count', '0');
      }
      scratchRemaining = Math.max(0, 5 - count);
    }
  } catch(e) {
    console.warn('获取刮刮乐次数失败', e);
    const today = new Date().toISOString().slice(0,10);
    const storedDate = localStorage.getItem('scratch_date');
    let count = parseInt(localStorage.getItem('scratch_count')) || 0;
    if (storedDate !== today) {
      count = 0;
      localStorage.setItem('scratch_date', today);
      localStorage.setItem('scratch_count', '0');
    }
    scratchRemaining = Math.max(0, 5 - count);
  }
  const statsSpan = document.getElementById('scratchStats');
  if (statsSpan) statsSpan.innerHTML = `剩余次数: ${scratchRemaining}`;
  const btn = document.getElementById('getScratchBtn');
  if (btn) btn.disabled = scratchRemaining <= 0;
}

async function getScratchCard() {
  if (scratchRemaining <= 0) {
    alert('今日刮刮卡次数已用完');
    return;
  }
  try {
    const res = await fetchWithAuth('/api/game/scratch/generate');
    if (!res.ok) {
      if (res.status === 429) {
        alert('今日次数已用完');
        await updateScratchRemaining();
        return;
      }
      throw new Error('生成失败');
    }
    const card = await res.json();
    renderScratchCard(card);
  } catch(e) {
    alert(e.message);
  }
}

function renderScratchCard(card) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content" style="width:500px;">
      <button class="modal-close">&times;</button>
      <div id="scratchSurface" class="scratch-card">
        <div class="scratch-cover">🎫 点击刮开涂层 🎫</div>
      </div>
      <div id="scratchAgainBtn" class="submit-btn" style="margin-top:12px; display:none;">再刮一张</div>
    </div>
  `;
  document.body.appendChild(modal);
  const closeModal = () => document.body.removeChild(modal);
  modal.querySelector('.modal-close').onclick = closeModal;
  modal.onclick = (e) => { if(e.target===modal) closeModal(); };

  const surface = modal.querySelector('#scratchSurface');
  const againBtn = modal.querySelector('#scratchAgainBtn');
  surface.onclick = () => {
    surface.innerHTML = `
      <div class="scratch-question">
        <div class="question-text">${escapeHtml(card.question)}</div>
        <div class="scratch-options">
          ${card.options.map((opt, idx) => `<div class="scratch-option" data-opt="${idx}">${String.fromCharCode(65+idx)}. ${escapeHtml(opt)}</div>`).join('')}
        </div>
      </div>
    `;
    const opts = surface.querySelectorAll('.scratch-option');
    opts.forEach(opt => {
      opt.onclick = async () => {
        const selected = parseInt(opt.dataset.opt);
        const res = await fetchWithAuth('/api/game/scratch/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId: card.cardId, selected })
        });
        const result = await res.json();
        if (result.correct) {
          surface.innerHTML = `<div class="scratch-reward">🎉 刮中奖励！获得 ${result.rewardPoints} 积分 🎉</div>`;
          addPoints(result.rewardPoints, '刮刮乐');
        } else {
          surface.innerHTML = `<div class="scratch-reward">😢 很遗憾，答案错误，下次再试试吧</div>`;
        }
        const today = new Date().toISOString().slice(0,10);
        let count = parseInt(localStorage.getItem('scratch_count')) || 0;
        count++;
        localStorage.setItem('scratch_count', count);
        localStorage.setItem('scratch_date', today);
        await updateScratchRemaining();
        if (scratchRemaining > 0) againBtn.style.display = 'block';
        else againBtn.style.display = 'none';
      };
    });
  };
  againBtn.onclick = () => { closeModal(); getScratchCard(); };
  updateScratchRemaining();
}

// ==================== 排行榜 ====================
async function showContestRanking() {
  try {
    const now = new Date();
    const day = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - day + (day === 0 ? -6 : 1));
    weekStart.setHours(0,0,0,0);
    const startStr = weekStart.toISOString().slice(0,10);

    const contestRes = await fetchWithAuth(`/api/game/weekly/current`);
    if (!contestRes.ok) throw new Error('获取竞赛信息失败');
    const contestData = await contestRes.json();
    const contestId = contestData.contestId;

    const rankRes = await fetchWithAuth(`/api/game/weekly/rank/${contestId}`);
    if (!rankRes.ok) throw new Error('获取排行榜失败');
    const ranks = await rankRes.json();

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content" style="width:400px;">
        <button class="modal-close">&times;</button>
        <h3>🏆 本周竞赛排行榜</h3>
        <div style="margin-top:16px;">
          ${ranks.length === 0 ? '<div>暂无排名数据</div>' : `
            <div style="display:grid; grid-template-columns: 60px 1fr 80px 80px; gap:8px; font-weight:bold; border-bottom:1px solid #ccc; padding-bottom:8px; margin-bottom:8px;">
              <div>排名</div><div>用户</div><div>正确率</div><div>用时</div>
            </div>
            ${ranks.map((r, idx) => {
              const minutes = Math.floor(r.time_used / 60);
              const seconds = r.time_used % 60;
              const timeStr = `${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;
              return `
                <div style="display:grid; grid-template-columns: 60px 1fr 80px 80px; gap:8px; padding:8px 0; border-bottom:1px solid #eee;">
                  <div>${idx+1}</div>
                  <div>${escapeHtml(r.username)}</div>
                  <div>${r.accuracy}%</div>
                  <div>${timeStr}</div>
                </div>
              `;
            }).join('')}
          `}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.modal-close').onclick = () => document.body.removeChild(modal);
    modal.onclick = (e) => { if(e.target===modal) document.body.removeChild(modal); };
  } catch(e) {
    console.error('排行榜加载失败', e);
    alert('加载排行榜失败');
  }
}

// ==================== 主渲染 ====================
export async function renderGameView() {
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="game-lobby">
      <div class="game-lobby-header animate-fade-in">
        <h1>🎮 挑战中心</h1>
        <p>积分挑战，赢取勋章</p>
      </div>
      <div class="game-grid">
        <div class="game-module module-fun animate-scale-up">
          <div class="module-icon">🏆</div>
          <div class="module-title">趣味闯关</div>
          <div class="module-desc">主题挑战，随机事件，生命值系统</div>
          <div class="module-stats" id="funStats">点击进入</div>
          <button class="module-btn" id="openFunBtn">开始闯关 →</button>
        </div>
        <div class="game-module module-daily animate-scale-up" style="animation-delay:0.1s">
          <div class="module-icon">📖</div>
          <div class="module-title">每日一练</div>
          <div class="module-desc">选择题+填空题，每日更新</div>
          <div class="module-stats" id="dailyStats">今日未开始</div>
          <button class="module-btn" id="startDailyBtn">开始练习 →</button>
        </div>
        <div class="game-module module-contest animate-scale-up" style="animation-delay:0.2s">
          <div class="module-icon">🏅</div>
          <div class="module-title">每周竞赛</div>
          <div class="module-desc">限时2分钟，每周3次</div>
          <div class="module-stats" id="contestStats">本周未参加</div>
          <div style="display: flex; gap: 8px;">
            <button class="module-btn" id="startContestBtn">参加竞赛 →</button>
            <button class="module-btn" id="rankContestBtn" style="background: #ff9800;">🏆 排行榜</button>
          </div>
        </div>
        <div class="game-module module-match animate-scale-up" style="animation-delay:0.3s">
          <div class="module-icon">🔗</div>
          <div class="module-title">政策连连看</div>
          <div class="module-desc">配对政策名词与描述</div>
          <div class="module-stats" id="matchStats">匹配记忆，赢积分</div>
          <button class="module-btn" id="startMatchBtn">开始游戏 →</button>
        </div>
        <div class="game-module module-wrong animate-scale-up" style="animation-delay:0.4s">
          <div class="module-icon">❌</div>
          <div class="module-title">错题本</div>
          <div class="module-desc">消灭错题，查漏补缺</div>
          <div class="module-stats" id="wrongStats">加载中...</div>
          <button class="module-btn" id="startWrongClearBtn">错题闯关 →</button>
        </div>
        <div class="game-module module-scratch animate-scale-up" style="animation-delay:0.5s">
          <div class="module-icon">🎫</div>
          <div class="module-title">刮刮乐</div>
          <div class="module-desc">每日5次，刮出惊喜</div>
          <div class="module-stats" id="scratchStats">剩余次数: --</div>
          <button class="module-btn" id="getScratchBtn">刮一张 →</button>
        </div>
      </div>
    </div>
  `;

  await loadModuleStats();
  await updateScratchRemaining();

  document.getElementById('openFunBtn').onclick = () => showFunLevelsModal();
  document.getElementById('startDailyBtn').onclick = startDailyQuiz;
  document.getElementById('startContestBtn').onclick = startWeeklyContest;
  document.getElementById('startMatchBtn').onclick = startMatchGame;
  document.getElementById('startWrongClearBtn').onclick = startWrongClear;
  document.getElementById('getScratchBtn').onclick = getScratchCard;
  const rankBtn = document.getElementById('rankContestBtn');
  if (rankBtn) rankBtn.onclick = showContestRanking;

  setActiveNavByView('game');
}

async function loadModuleStats() {
  try {
    const dailyRes = await fetchWithAuth('/api/game/daily/status');
    if (dailyRes.ok) {
      const dailyData = await dailyRes.json();
      const dailyStats = document.getElementById('dailyStats');
      if (dailyStats) {
        if (dailyData.completed) {
          dailyStats.innerHTML = `今日已完成 (${dailyData.score}/${dailyData.total})`;
        } else {
          dailyStats.innerHTML = '今日未开始';
        }
      }
    } else {
      console.warn('获取每日一练状态失败');
    }
  } catch(e) {
    console.error('每日一练状态加载失败', e);
  }

  try {
    const wrongRes = await fetchWithAuth('/api/game/wrong-questions');
    if (wrongRes.ok) {
      const wrongs = await wrongRes.json();
      const wrongStats = document.getElementById('wrongStats');
      if (wrongStats) wrongStats.innerHTML = `共有 ${wrongs.length} 道错题`;
    }
  } catch(e) {
    console.error('错题本加载失败', e);
  }

  try {
    const contestRes = await fetchWithAuth('/api/game/weekly/status');
    if (contestRes.ok) {
      const contestData = await contestRes.json();
      const contestStats = document.getElementById('contestStats');
      if (contestStats) {
        if (contestData.participated) {
          const minutes = Math.floor(contestData.bestTime / 60);
          const seconds = contestData.bestTime % 60;
          const timeStr = `${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;
          contestStats.innerHTML = `最佳: ${contestData.bestScore}/${contestData.total}题, ${timeStr}<br>剩余次数: ${contestData.attemptsLeft}`;
        } else {
          contestStats.innerHTML = '本周未参加 (3次机会)';
        }
      }
    } else {
      console.warn('获取每周竞赛状态失败');
    }
  } catch(e) {
    console.error('每周竞赛状态加载失败', e);
  }
}