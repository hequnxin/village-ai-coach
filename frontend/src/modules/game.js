// frontend/src/modules/game.js

import { fetchWithAuth } from '../utils/api';
import { appState, loadLevelProgress } from './state';
import { escapeHtml, playSound, addPoints, updateTaskProgress, setActiveNavByView, showCelebration, showPointsFloat } from '../utils/helpers';

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

// 趣味闯关
let currentFunQuestions = [];
let currentFunIndex = 0;
let currentFunScore = 0;
let currentFunLives = 3;
let currentFunTheme = '';
let currentFunDifficulty = 'medium';
let currentFunEvent = null;
let currentFunEventUsed = false;

// 翻牌配对
let memoryGameActive = false;
let memoryGameDifficulty = 'medium';
let memoryGameCards = [];
let memoryGameOpenedCards = [];
let memoryGameMatchedPairs = 0;
let memoryGameMoves = 0;
let memoryGameStartTime = null;
let memoryGameTimer = null;
let memoryGameGridCols = 4;
let memoryGameLockBoard = false;
let memoryGameTotalPairs = 0;
let memoryGameScore = 0;

// ==================== 辅助函数 ====================
function formatAnswerLabel(question, answerIndex) {
  if (!question.options) return answerIndex;
  const text = question.options[answerIndex];
  return `${String.fromCharCode(65 + answerIndex)}. ${text}`;
}

// 刷新侧边栏积分和成长曲线的通用函数
async function refreshPointsAndGrowth() {
  try {
    await loadLevelProgress(); // 更新侧边栏等级/积分
    if (typeof window.refreshGrowthChart === 'function') {
      window.refreshGrowthChart(); // 更新成长曲线（如果个人中心已打开）
    }
  } catch (err) {
    console.warn('刷新积分/曲线失败', err);
  }
}

// ==================== 通用全屏答题组件 ====================
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
    showSubmit = true,
    isWrongClear = false
  } = config;

  const dynamicContent = document.getElementById('dynamicContent');
  const q = questions[currentIndex];
  const isChoice = q.type === 'choice' || q.question_type === 'choice' || q.question_type === 'judge';
  const isFill = q.type === 'fill';
  const isSort = q.question_type === 'sort';
  const isLast = currentIndex === questions.length - 1;
  const isFirst = currentIndex === 0;
  const alreadyAnswered = userAnswers[currentIndex] !== undefined && userAnswers[currentIndex] !== null;

  let optionsHtml = '';
  let fillValue = alreadyAnswered && isFill ? userAnswers[currentIndex] : '';

  if (isSort) {
    const correctOrder = q.answer;
    const items = q.options;
    const candidateOrders = [correctOrder];
    while (candidateOrders.length < 4) {
      const shuffled = [...correctOrder];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const isDuplicate = candidateOrders.some(order => order.length === shuffled.length && order.every((val, idx) => val === shuffled[idx]));
      if (!isDuplicate) candidateOrders.push(shuffled);
    }
    for (let i = candidateOrders.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidateOrders[i], candidateOrders[j]] = [candidateOrders[j], candidateOrders[i]];
    }
    optionsHtml = `
      <div class="sort-choice-options" style="display:flex; flex-direction:column; gap:12px; margin-top:16px;">
        ${candidateOrders.map((order, idx) => {
          const displayText = order.map(i => items[i]).join(' → ');
          const isSelected = (userAnswers[currentIndex] !== undefined && JSON.stringify(userAnswers[currentIndex]) === JSON.stringify(order));
          return `
            <div class="sort-choice-item ${isSelected ? 'selected' : ''}" data-order='${JSON.stringify(order)}' data-idx="${idx}" style="padding:10px 14px; background:#f5f5f5; border-radius:12px; cursor:pointer; transition:0.2s;">
              ${String.fromCharCode(65+idx)}. ${escapeHtml(displayText)}
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else if (isFill) {
    optionsHtml = `
      <div class="fill-answer-area">
        <label>答案：</label>
        <input type="text" id="fillInput" class="fill-input" placeholder="请输入答案" value="${escapeHtml(fillValue)}" ${alreadyAnswered ? 'disabled' : ''} style="width:100%; padding:10px; border-radius:8px; border:1px solid #ccc; margin-top:8px;">
        ${q.hint ? `<div class="fill-hint" style="color:#666; font-size:0.8rem; margin-top:4px;">💡 ${escapeHtml(q.hint)}</div>` : ''}
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
        <div class="quiz-score" id="quizScoreDisplay">本次得分: ${totalScore}</div>
        ${extraHeader ? extraHeader : ''}
      </div>
      <div class="quiz-body">
        <div class="question-text">${escapeHtml(q.question)}</div>
        ${optionsHtml}
        <div id="quizFeedbackArea" class="quiz-feedback-area"></div>
      </div>
      <div class="quiz-footer">
        <div class="action-buttons">
          <button id="quizPrevBtn" class="action-btn" style="display: ${!isFirst ? 'inline-block' : 'none'}">← 上一题</button>
          <button id="quizSubmitBtn" class="action-btn submit" style="display: ${!alreadyAnswered ? 'inline-block' : 'none'}">提交答案</button>
          <button id="quizNextBtn" class="action-btn" style="display: ${alreadyAnswered && !isLast ? 'inline-block' : 'none'}">下一题 →</button>
          <button id="quizFinishBtn" class="action-btn finish" style="display: ${alreadyAnswered && isLast ? 'inline-block' : 'none'}">完成闯关</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('quizBackBtn').onclick = () => {
    if (onBack) onBack();
    else renderGameView();
  };

  if (!isSort && !isFill) {
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
  } else if (isSort) {
    const sortItems = document.querySelectorAll('.sort-choice-item');
    sortItems.forEach(item => {
      item.onclick = () => {
        if (alreadyAnswered) return;
        const order = JSON.parse(item.dataset.order);
        userAnswers[currentIndex] = order;
        sortItems.forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
      };
    });
  }

  const submitBtn = document.getElementById('quizSubmitBtn');
  if (submitBtn) {
    submitBtn.onclick = async () => {
      let userAnswer;
      if (isSort) {
        if (userAnswers[currentIndex] === undefined || userAnswers[currentIndex] === null) {
          alert('请选择一个顺序选项');
          return;
        }
        userAnswer = userAnswers[currentIndex];
      } else if (isFill) {
        const fillInput = document.getElementById('fillInput');
        userAnswer = fillInput.value.trim();
        if (!userAnswer) {
          alert('请输入答案');
          return;
        }
        userAnswers[currentIndex] = userAnswer;
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
            const scoreDisplay = document.getElementById('quizScoreDisplay');
            if (scoreDisplay) scoreDisplay.textContent = `本次得分: ${config.totalScore}`;
          }
          feedbackDiv.innerHTML = `<div class="feedback-correct">✅ 回答正确！${pointsGain ? ` +${pointsGain} 分` : ''}<br>${explanation ? '解析：'+escapeHtml(explanation) : ''}</div>`;
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

        // 高亮处理
        if (!isSort && !isFill) {
          const opts = document.querySelectorAll('.quiz-option-item');
          const correctIndex = q.answer;
          opts.forEach(opt => {
            const optVal = parseInt(opt.dataset.opt);
            if (optVal === correctIndex) opt.classList.add('correct');
            if (optVal === userAnswer && !correct) opt.classList.add('wrong');
          });
        } else if (isFill) {
          const fillInput = document.getElementById('fillInput');
          if (fillInput && !correct) fillInput.style.borderColor = '#f44336';
        } else if (isSort) {
          const sortChoiceItems = document.querySelectorAll('.sort-choice-item');
          sortChoiceItems.forEach(item => {
            const order = JSON.parse(item.dataset.order);
            const isCorrectOrder = order.length === q.answer.length && order.every((val, idx) => val === q.answer[idx]);
            if (isCorrectOrder) item.classList.add('correct');
            if (item.classList.contains('selected') && !isCorrectOrder) item.classList.add('wrong');
          });
        }

        const prevBtn = document.getElementById('quizPrevBtn');
        const nextBtn = document.getElementById('quizNextBtn');
        const finishBtn = document.getElementById('quizFinishBtn');
        const submitButton = document.getElementById('quizSubmitBtn');
        if (submitButton) submitButton.style.display = 'none';
        if (!isLast && nextBtn) nextBtn.style.display = 'inline-block';
        if (isLast && finishBtn) finishBtn.style.display = 'inline-block';
        if (prevBtn) prevBtn.style.display = !isFirst ? 'inline-block' : 'none';
      }
    };
  }

  const prevBtn = document.getElementById('quizPrevBtn');
  if (prevBtn) {
    prevBtn.onclick = () => {
      renderGenericQuiz({ ...config, currentIndex: currentIndex - 1, userAnswers, userScores, totalScore: config.totalScore });
    };
  }
  const nextBtn = document.getElementById('quizNextBtn');
  if (nextBtn) {
    nextBtn.onclick = () => {
      renderGenericQuiz({ ...config, currentIndex: currentIndex + 1, userAnswers, userScores, totalScore: config.totalScore });
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
          await addPoints(5, `每日一练答对: ${q.question.substring(0, 30)}`);
          showPointsFloat(5, window.innerWidth/2, window.innerHeight/2);
        }
      } else {
        await fetchWithAuth('/api/game/wrong-questions/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId: q.id, userAnswer, questionType: q.type })
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
      alert(`练习完成！本次得分 ${finalScore/10}/${total}，获得 ${rewardPoints} 积分`);
      await updateTaskProgress('daily_quiz', 1);
      await loadModuleStats();
      // 刷新侧边栏积分和成长曲线
      await refreshPointsAndGrowth();
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
          await addPoints(3, `每周竞赛答对: ${q.question.substring(0, 30)}`);
          showPointsFloat(3, window.innerWidth/2, window.innerHeight/2);
        }
      } else {
        await fetchWithAuth('/api/game/wrong-questions/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId: q.id, userAnswer, questionType: 'choice' })
        });
      }
      return { correct: isCorrect, correctLabel, explanation: q.explanation };
    };

    const onFinish = async (finalScore) => {
      if (contestTimerInterval) {
        clearInterval(contestTimerInterval);
        contestTimerInterval = null;
      }
      const timeUsed = Math.floor((Date.now() - contestStartTime) / 1000);
      const answers = currentContestQuestions.map((_, i) => ({ questionId: currentContestQuestions[i].id, selected: userAnswers[i] }));
      const res = await fetchWithAuth('/api/game/weekly/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contestId: currentContestId, answers, timeUsed, attemptNumber: currentAttemptNumber })
      });
      const result = await res.json();
      if (result.score !== undefined) {
        alert(`竞赛完成！得分 ${result.score}/${result.total}，用时 ${Math.floor(timeUsed/60)}分${timeUsed%60}秒`);
        await updateTaskProgress('contest', 1);
        await loadModuleStats();
        // 刷新侧边栏积分和成长曲线
        await refreshPointsAndGrowth();
        const rankModal = document.querySelector('.modal');
        if (rankModal && rankModal.style.display === 'flex') {
          rankModal.remove();
          await showContestRanking();
        }
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
    contestTimerInterval = interval;
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

// ==================== 错题本 ====================
async function startWrongClear() {
  const res = await fetchWithAuth('/api/game/wrong-questions');
  const data = await res.json();
  let questions = data.questions || [];
  if (questions.length === 0) {
    alert('暂无错题');
    return;
  }
  let userAnswers = new Array(questions.length).fill(null);
  let userScores = new Array(questions.length).fill(false);
  let totalScore = 0;
  let clearedCount = 0;
  let remainingCount = questions.length;

  async function updateWrongStats() {
    const newRes = await fetchWithAuth('/api/game/wrong-questions');
    const newData = await newRes.json();
    const newCount = newData.questions?.length || 0;
    const wrongStats = document.getElementById('wrongStats');
    if (wrongStats) wrongStats.innerHTML = `共有 ${newCount} 道错题`;
    remainingCount = newCount;
  }

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
        const clearRes = await fetchWithAuth('/api/game/wrong-questions/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: [{ questionId: q.question_id, questionType: q.type, userAnswer: q.type === 'choice' ? parseInt(userAnswer) : userAnswer }] })
        });
        const clearData = await clearRes.json();
        if (clearData.clearedCount > 0) {
          clearedCount++;
          totalScore += 10;
          // 刷新侧边栏积分和成长曲线
          await refreshPointsAndGrowth();
          remainingCount--;
          questions.splice(index, 1);
          userAnswers.splice(index, 1);
          userScores.splice(index, 1);
          await updateWrongStats();
          if (questions.length === 0) {
            alert(`错题闯关结束！本次共答对 ${clearedCount} 题，获得 ${totalScore} 积分，所有错题已消灭！`);
            await loadModuleStats();
            renderGameView();
            return { correct: true, correctLabel, explanation: q.explanation };
          } else {
            renderGenericQuiz({
              questions,
              currentIndex: index,
              userAnswers,
              userScores,
              totalScore,
              title: `错题闯关 (剩余${remainingCount}题)`,
              onSubmit,
              onFinish,
              onBack: () => renderGameView(),
              showPrev: true,
              isWrongClear: true
            });
            return { correct: true, correctLabel, explanation: q.explanation };
          }
        }
      }
    } else {
      await fetchWithAuth('/api/game/wrong-questions/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: q.question_id, userAnswer, questionType: q.type })
      });
    }
    return { correct: isCorrect, correctLabel, explanation: q.explanation };
  };

  const onFinish = async (finalScore) => {
    alert(`错题闯关结束！本次共答对 ${clearedCount} 题，获得 ${finalScore} 积分，剩余 ${remainingCount} 道错题`);
    await loadModuleStats();
    renderGameView();
  };

  const originalRender = renderGenericQuiz;
  const customRender = (cfg) => {
    const extra = `<button id="exitWrongClearBtn" class="summary-btn" style="background:#f44336; color:white; margin-left:10px;">结束闯关</button>`;
    const newExtraHeader = cfg.extraHeader ? cfg.extraHeader + extra : extra;
    originalRender({ ...cfg, extraHeader: newExtraHeader, title: `错题闯关 (剩余${remainingCount}题)` });
    setTimeout(() => {
      const exitBtn = document.getElementById('exitWrongClearBtn');
      if (exitBtn) {
        exitBtn.onclick = () => {
          if (confirm(`确定结束闯关？已消灭 ${clearedCount} 题，剩余 ${remainingCount} 题，可获得 ${totalScore} 积分。`)) {
            onFinish(totalScore);
          }
        };
      }
    }, 100);
  };
  window._originalRenderGenericQuiz = renderGenericQuiz;
  window.renderGenericQuiz = customRender;
  customRender({
    questions,
    currentIndex: 0,
    userAnswers,
    userScores,
    totalScore,
    title: `错题闯关 (剩余${remainingCount}题)`,
    onSubmit,
    onFinish,
    onBack: () => renderGameView(),
    showPrev: true,
    isWrongClear: true
  });
  setTimeout(() => {
    window.renderGenericQuiz = window._originalRenderGenericQuiz;
  }, 100);
}

// ==================== 翻牌配对 ====================
async function startMemoryGame() {
  const difficulty = await new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content" style="width:300px;">
        <h3>🎮 选择难度</h3>
        <div style="display:flex; flex-direction:column; gap:12px; margin:20px 0;">
          <button id="diffEasy" class="action-btn" style="background:#4caf50;">🌱 简单 (8对)</button>
          <button id="diffMedium" class="action-btn" style="background:#ff9800;">⚡ 中等 (12对)</button>
          <button id="diffHard" class="action-btn" style="background:#f44336;">🔥 困难 (18对)</button>
        </div>
        <button id="cancelBtn" class="summary-btn">取消</button>
      </div>
    `;
    document.body.appendChild(modal);
    const closeModal = () => modal.remove();
    modal.querySelector('#diffEasy').onclick = () => { closeModal(); resolve('easy'); };
    modal.querySelector('#diffMedium').onclick = () => { closeModal(); resolve('medium'); };
    modal.querySelector('#diffHard').onclick = () => { closeModal(); resolve('hard'); };
    modal.querySelector('#cancelBtn').onclick = closeModal;
    modal.onclick = (e) => { if(e.target === modal) closeModal(); };
  });
  if (!difficulty) return;
  memoryGameActive = true;
  memoryGameDifficulty = difficulty;
  memoryGameOpenedCards = [];
  memoryGameMatchedPairs = 0;
  memoryGameMoves = 0;
  memoryGameScore = 0;
  memoryGameLockBoard = false;
  if (memoryGameTimer) clearInterval(memoryGameTimer);
  memoryGameStartTime = Date.now();
  try {
    const res = await fetchWithAuth(`/api/game/memory-pairs?difficulty=${difficulty}`);
    const data = await res.json();
    memoryGameCards = data.cards;
    memoryGameTotalPairs = data.pairCount;
    memoryGameGridCols = data.gridCols;
    renderMemoryGame();
    startMemoryGameTimer();
  } catch(e) {
    alert('加载失败');
    memoryGameActive = false;
  }
}

function startMemoryGameTimer() {
  if (memoryGameTimer) clearInterval(memoryGameTimer);
  memoryGameTimer = setInterval(() => {
    if (!memoryGameActive) return;
    const elapsed = Math.floor((Date.now() - memoryGameStartTime) / 1000);
    const timerSpan = document.getElementById('memoryGameTimer');
    if (timerSpan) timerSpan.textContent = `⏰ ${Math.floor(elapsed/60)}:${(elapsed%60).toString().padStart(2,'0')}`;
  }, 1000);
}

function renderMemoryGame() {
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="memory-game-container" style="padding:20px; background:#f5f7fa; min-height:100%;">
      <div class="memory-game-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; background:white; padding:12px 20px; border-radius:16px;">
        <button class="back-btn" id="memoryBackBtn">← 返回</button>
        <h2>🧠 翻牌配对 · ${memoryGameDifficulty === 'easy' ? '简单' : memoryGameDifficulty === 'medium' ? '中等' : '困难'}</h2>
        <div style="display:flex; gap:20px;">
          <div>配对: ${memoryGameMatchedPairs} / ${memoryGameTotalPairs}</div>
          <div>步数: ${memoryGameMoves}</div>
          <div id="memoryGameTimer">⏰ 00:00</div>
          <div>得分: <span id="memoryGameScore">0</span></div>
        </div>
      </div>
      <div class="memory-game-grid" style="display:grid; grid-template-columns:repeat(${memoryGameGridCols},1fr); gap:12px; max-width:800px; margin:0 auto;">
        ${memoryGameCards.map((card, idx) => `
          <div class="memory-card ${card.matched ? 'matched' : ''} ${memoryGameOpenedCards.includes(idx) ? 'open' : ''}" data-idx="${idx}" data-pair="${card.pairId}" data-type="${card.type}" style="background:white; border-radius:12px; padding:12px; text-align:center; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.1); transition:all 0.2s; min-height:80px; display:flex; align-items:center; justify-content:center;">
            <div class="memory-card-front" style="display:${memoryGameOpenedCards.includes(idx) || card.matched ? 'block' : 'none'}">
              ${escapeHtml(card.text)}
            </div>
            <div class="memory-card-back" style="display:${memoryGameOpenedCards.includes(idx) || card.matched ? 'none' : 'block'}; font-size:2rem;">❓</div>
          </div>
        `).join('')}
      </div>
      ${memoryGameMatchedPairs === memoryGameTotalPairs ? '<div class="memory-game-complete" style="text-align:center; margin-top:20px;"><button id="memoryFinishBtn" class="submit-btn">领取奖励</button></div>' : ''}
    </div>
  `;
  document.getElementById('memoryBackBtn').onclick = () => {
    memoryGameActive = false;
    if (memoryGameTimer) clearInterval(memoryGameTimer);
    renderGameView();
  };
  const cards = document.querySelectorAll('.memory-card');
  cards.forEach(card => {
    card.onclick = () => {
      if (memoryGameLockBoard) return;
      const idx = parseInt(card.dataset.idx);
      const cardData = memoryGameCards[idx];
      if (cardData.matched) return;
      if (memoryGameOpenedCards.includes(idx)) return;
      if (memoryGameOpenedCards.length === 2) return;
      memoryGameOpenedCards.push(idx);
      renderMemoryGame();
      if (memoryGameOpenedCards.length === 2) {
        memoryGameLockBoard = true;
        memoryGameMoves++;
        const [idx1, idx2] = memoryGameOpenedCards;
        const card1 = memoryGameCards[idx1];
        const card2 = memoryGameCards[idx2];
        if (card1.pairId === card2.pairId && card1.type !== card2.type) {
          memoryGameCards[idx1].matched = true;
          memoryGameCards[idx2].matched = true;
          memoryGameMatchedPairs++;
          const elapsed = Math.floor((Date.now() - memoryGameStartTime) / 1000);
          const timeBonus = Math.max(0, 60 - elapsed) * 2;
          const moveBonus = Math.max(0, 30 - memoryGameMoves) * 5;
          memoryGameScore = memoryGameMatchedPairs * 100 + timeBonus + moveBonus;
          document.getElementById('memoryGameScore').innerText = memoryGameScore;
          playSound('complete');
          memoryGameOpenedCards = [];
          memoryGameLockBoard = false;
          if (memoryGameMatchedPairs === memoryGameTotalPairs) {
            clearInterval(memoryGameTimer);
            const finishBtn = document.getElementById('memoryFinishBtn');
            if (finishBtn) finishBtn.onclick = finishMemoryGame;
          }
          renderMemoryGame();
        } else {
          playSound('error');
          setTimeout(() => {
            memoryGameOpenedCards = [];
            memoryGameLockBoard = false;
            renderMemoryGame();
          }, 800);
        }
      }
    };
  });
  const finishBtn = document.getElementById('memoryFinishBtn');
  if (finishBtn) finishBtn.onclick = finishMemoryGame;
}

async function finishMemoryGame() {
  const elapsed = Math.floor((Date.now() - memoryGameStartTime) / 1000);
  const res = await fetchWithAuth('/api/game/memory-submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      difficulty: memoryGameDifficulty,
      score: memoryGameScore,
      timeUsed: elapsed,
      moves: memoryGameMoves,
      matchedCount: memoryGameMatchedPairs,
      totalPairs: memoryGameTotalPairs
    })
  });
  const data = await res.json();
  const rewardPoints = data.rewardPoints;
  alert(`🎉 游戏完成！得分：${memoryGameScore}，步数：${memoryGameMoves}，用时：${Math.floor(elapsed/60)}:${(elapsed%60).toString().padStart(2,'0')}，获得 ${rewardPoints} 积分`);
  await addPoints(rewardPoints, '翻牌配对');
  await updateTaskProgress('memory', 1);
  showCelebration(window.innerWidth/2, window.innerHeight/2);
  // 刷新侧边栏积分和成长曲线
  await refreshPointsAndGrowth();
  memoryGameActive = false;
  renderGameView();
}

async function showMemoryRanking() {
  const difficulty = await new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content" style="width:300px;">
        <h3>🏆 排行榜</h3>
        <div style="display:flex; flex-direction:column; gap:12px; margin:20px 0;">
          <button id="rankEasy" class="action-btn">简单模式</button>
          <button id="rankMedium" class="action-btn">中等模式</button>
          <button id="rankHard" class="action-btn">困难模式</button>
        </div>
        <button id="cancelBtn" class="summary-btn">取消</button>
      </div>
    `;
    document.body.appendChild(modal);
    const closeModal = () => modal.remove();
    modal.querySelector('#rankEasy').onclick = () => { closeModal(); resolve('easy'); };
    modal.querySelector('#rankMedium').onclick = () => { closeModal(); resolve('medium'); };
    modal.querySelector('#rankHard').onclick = () => { closeModal(); resolve('hard'); };
    modal.querySelector('#cancelBtn').onclick = closeModal;
    modal.onclick = (e) => { if(e.target === modal) closeModal(); };
  });
  if (!difficulty) return;
  const res = await fetchWithAuth(`/api/game/memory-rank?difficulty=${difficulty}`);
  const ranks = await res.json();
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content" style="width:400px;">
      <button class="modal-close">&times;</button>
      <h3>🏆 ${difficulty === 'easy' ? '简单' : difficulty === 'medium' ? '中等' : '困难'} 模式排行榜</h3>
      <div style="margin-top:16px;">
        ${ranks.length === 0 ? '<div>暂无数据</div>' : `
          <div style="display:grid; grid-template-columns: 50px 1fr 80px 80px; gap:8px; font-weight:bold; border-bottom:1px solid #ccc; padding-bottom:8px;">
            <div>排名</div><div>用户</div><div>最高分</div><div>最佳时间</div>
          </div>
          ${ranks.map((r, idx) => `
            <div style="display:grid; grid-template-columns: 50px 1fr 80px 80px; gap:8px; padding:8px 0; border-bottom:1px solid #eee;">
              <div>${idx+1}</div><div>${escapeHtml(r.username)}</div><div>${r.best_score}</div><div>${Math.floor(r.best_time/60)}:${(r.best_time%60).toString().padStart(2,'0')}</div>
            </div>
          `).join('')}
        `}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.modal-close').onclick = () => modal.remove();
  modal.onclick = (e) => { if(e.target === modal) modal.remove(); };
}
// ==================== 每周竞赛排行榜 ====================
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
    const currentUsername = appState.username;
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
              const isCurrentUser = (r.username === currentUsername);
              return `<div style="display:grid; grid-template-columns: 60px 1fr 80px 80px; gap:8px; padding:8px 0; border-bottom:1px solid #eee; ${isCurrentUser ? 'background:#e8f5e9; font-weight:bold;' : ''}">
                <div>${idx+1}</div><div>${escapeHtml(r.username)}</div><div>${r.accuracy}%</div><div>${timeStr}</div>
              </div>`;
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
          <div class="module-icon">🏆</div><div class="module-title">趣味闯关</div><div class="module-desc">主题挑战，随机事件，生命值系统</div><div class="module-stats" id="funStats">点击进入</div><button class="module-btn" id="openFunBtn">开始闯关 →</button>
        </div>
        <div class="game-module module-daily animate-scale-up" style="animation-delay:0.1s">
          <div class="module-icon">📖</div><div class="module-title">每日一练</div><div class="module-desc">选择题+填空题，每日更新</div><div class="module-stats" id="dailyStats">今日未开始</div><button class="module-btn" id="startDailyBtn">开始练习 →</button>
        </div>
        <div class="game-module module-contest animate-scale-up" style="animation-delay:0.2s">
          <div class="module-icon">🏅</div><div class="module-title">每周竞赛</div><div class="module-desc">限时2分钟，每周3次</div><div class="module-stats" id="contestStats">本周未参加</div><div style="display: flex; gap: 8px;"><button class="module-btn" id="startContestBtn">参加竞赛 →</button><button class="module-btn" id="rankContestBtn" style="background: #ff9800;">🏆 排行榜</button></div>
        </div>
        <div class="game-module module-memory animate-scale-up" style="animation-delay:0.3s">
          <div class="module-icon">🧠</div><div class="module-title">翻牌配对</div><div class="module-desc">记忆挑战，配对术语与描述</div><div class="module-stats" id="memoryStats">点击开始</div><button class="module-btn" id="startMemoryBtn">开始游戏 →</button><button class="module-btn" id="memoryRankBtn" style="margin-top:8px; background:#ff9800;">🏆 排行榜</button>
        </div>
        <div class="game-module module-wrong animate-scale-up" style="animation-delay:0.4s">
          <div class="module-icon">❌</div><div class="module-title">错题本</div><div class="module-desc">消灭错题，查漏补缺</div><div class="module-stats" id="wrongStats">加载中...</div><button class="module-btn" id="startWrongClearBtn">错题闯关 →</button>
        </div>
      </div>
    </div>
  `;
  await loadModuleStats();
  const safeBind = (id, handler) => {
    const el = document.getElementById(id);
    if (el) el.onclick = handler;
    else console.warn(`[renderGameView] 元素 #${id} 不存在`);
  };
  safeBind('openFunBtn', () => showFunLevelsModal());
  safeBind('startDailyBtn', startDailyQuiz);
  safeBind('startContestBtn', startWeeklyContest);
  safeBind('startMemoryBtn', startMemoryGame);
  safeBind('memoryRankBtn', showMemoryRanking);
  safeBind('startWrongClearBtn', startWrongClear);
  const rankBtn = document.getElementById('rankContestBtn');
  if (rankBtn) rankBtn.onclick = showContestRanking;
  setActiveNavByView('game');
}

export { startWrongClear };

async function loadModuleStats() {
  try {
    const dailyRes = await fetchWithAuth('/api/game/daily/status');
    if (dailyRes.ok) {
      const dailyData = await dailyRes.json();
      const dailyStats = document.getElementById('dailyStats');
      if (dailyStats) dailyStats.innerHTML = dailyData.completed ? `今日已完成 (${dailyData.score}/${dailyData.total})` : '今日未开始';
    }
  } catch(e) { console.error('每日一练状态加载失败', e); }
  try {
    const wrongRes = await fetchWithAuth('/api/game/wrong-questions');
    if (wrongRes.ok) {
      const data = await wrongRes.json();
      const wrongStats = document.getElementById('wrongStats');
      if (wrongStats) wrongStats.innerHTML = `共有 ${data.questions?.length || 0} 道错题`;
    }
  } catch(e) { console.error('错题本加载失败', e); }
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
    }
  } catch(e) { console.error('每周竞赛状态加载失败', e); }
}

// ==================== 趣味闯关主题选择 ====================
async function showFunLevelsModal() {
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="fullscreen-fun-selector">
      <div class="fun-selector-header">
        <button class="back-btn" id="funBackBtn">← 返回</button>
        <h2>🎮 趣味闯关</h2>
        <button id="rulesBtn" class="summary-btn" style="margin-left:auto;">📜 规则说明</button>
      </div>
      <div class="fun-selector-body">
        <div class="difficulty-selector">
          <button class="difficulty-btn" data-diff="easy">🌱 简单 (5题)</button>
          <button class="difficulty-btn" data-diff="medium">⚡ 中等 (8题)</button>
          <button class="difficulty-btn" data-diff="hard">🔥 困难 (12题)</button>
        </div>
        <div class="timing-mode">
          <label><input type="checkbox" id="timingModeCheckbox"> ⏱️ 限时模式（每题15秒）</label>
        </div>
        <div class="themes-grid" id="funThemesGrid">加载中...</div>
      </div>
    </div>
  `;
  document.getElementById('funBackBtn').onclick = () => renderGameView();

  document.getElementById('rulesBtn').onclick = () => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content" style="width:320px; text-align:left;">
        <button class="modal-close" style="position:absolute;right:12px;top:12px;">&times;</button>
        <h3>🎯 趣味闯关规则</h3>
        <div style="font-size:14px; line-height:1.6;">
          <p><strong>📌 题目数量：</strong><br>简单 5题 · 中等 8题 · 困难 12题</p>
          <p><strong>💯 得分规则：</strong><br>每题基础分10分，困难模式每题+5分。<br>答对得全分，答错不得分。<br>每答对一题额外获得1积分（简单/中等）或2积分（困难）。</p>
          <p><strong>❤️ 生命值：</strong><br>初始3点，答错扣1点，归零则闯关失败。</p>
          <p><strong>🎁 随机事件：</strong><br>每轮随机出现（双倍积分、提示、免答）。</p>
          <p><strong>🏆 通关奖励：</strong><br>达到总分60%即可通关，获得30积分。</p>
          <p><strong>⚡ 限时模式：</strong><br>每题15秒倒计时，超时自动判错。</p>
        </div>
        <button id="closeRuleBtn" class="action-btn" style="margin-top:12px; width:100%;">知道了</button>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.modal-close').onclick = () => modal.remove();
    modal.querySelector('#closeRuleBtn').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  };

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

// ==================== 趣味闯关主逻辑 ====================
async function startFunChallengeFullscreen(theme, themeId, difficulty, timingMode) {
  let questionCount = difficulty === 'easy' ? 5 : (difficulty === 'medium' ? 8 : 12);
  const res = await fetchWithAuth(`/api/game/fun-level-questions?theme=${encodeURIComponent(theme)}&difficulty=${difficulty}&count=${questionCount}`);
  const data = await res.json();
  let questions = data.questions;
  questions = questions.map(q => ({ ...q, question_type: q.question_type || 'choice' }));

  const userAnswers = new Array(questions.length).fill(null);
  const userScores = new Array(questions.length).fill(false);
  let totalScoreObj = { value: 0 };   // 改为对象
  let livesObj = { value: 3 };        // 改为对象
  let eventActive = data.event;
  let eventUsed = false;
  let isFinishing = false;

  const onSubmit = async (index, userAnswer) => {
    const q = questions[index];
    let isCorrect = false;
    let correctLabel = '';
    let pointsGain = 10;
    let basePointsReward = 1;
    if (difficulty === 'hard') {
      pointsGain += 5;
      basePointsReward = 2;
    }
    if (eventActive === 'double' && !eventUsed && isCorrect) {
      pointsGain *= 2;
      basePointsReward *= 2;
    }

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
    } else if (q.type === 'fill') {
      const correctStr = q.answer.trim().toLowerCase();
      const userStr = String(userAnswer).trim().toLowerCase();
      isCorrect = (userStr === correctStr);
      correctLabel = q.answer;
    }

    if (isCorrect) {
      if (!userScores[index]) {
        userScores[index] = true;
        totalScoreObj.value += pointsGain;
        await addPoints(basePointsReward, `趣味闯关答对: ${q.question.substring(0, 30)}`);
        showPointsFloat(basePointsReward, window.innerWidth/2, window.innerHeight/2);
      }
    } else {
      livesObj.value--;
      await fetchWithAuth('/api/game/wrong-questions/record', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: q.id, userAnswer: String(userAnswer), questionType: q.type || 'choice' })
      });
      if (livesObj.value <= 0 && !isFinishing) {
        isFinishing = true;
        alert('💀 生命值归零，闯关失败！');
        onFinish(totalScoreObj.value);
        return { correct: false, correctLabel, explanation: q.explanation, pointsGain, livesRemaining: livesObj.value };
      }
    }
    return { correct: isCorrect, correctLabel, explanation: q.explanation, pointsGain, livesRemaining: livesObj.value };
  };

  const onFinish = async (finalScore) => {
    if (isFinishing) return;
    isFinishing = true;
    const total = questions.length;
    const maxPossibleScore = total * (difficulty === 'hard' ? 15 : 10);
    const passed = (totalScoreObj.value / maxPossibleScore) >= 0.6;
    const reward = passed ? 30 : 0;
    await fetchWithAuth('/api/game/policy-submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeId, score: totalScoreObj.value / (difficulty === 'hard' ? 15 : 10), total })
    });
    if (reward) {
      await addPoints(reward, '趣味闯关通关奖励');
      showPointsFloat(reward, window.innerWidth/2, window.innerHeight/2);
      // 刷新侧边栏积分和成长曲线
      await refreshPointsAndGrowth();
    }
    if (passed) {
      await updateTaskProgress('fun', 1);
      showCelebration(window.innerWidth/2, window.innerHeight/2);
    }
    alert(`闯关结束！本次得分 ${totalScoreObj.value}/${maxPossibleScore}，${passed ? '通关成功！' : '再接再厉！'}${reward ? ` 获得 ${reward} 积分` : ''}`);
  };

  let timerInterval = null;
  let timeLeft = 15;
  function updateTimerDisplay() {
    if (!timingMode) return;
    const timerSpan = document.getElementById('questionTimer');
    if (timerSpan) timerSpan.textContent = `⏱️ ${timeLeft}s`;
  }
  function startTimer(idx, onTimeout) {
    if (!timingMode) return;
    if (timerInterval) clearInterval(timerInterval);
    timeLeft = 15;
    updateTimerDisplay();
    timerInterval = setInterval(() => {
      if (timeLeft <= 1) {
        clearInterval(timerInterval);
        onTimeout(idx);
      } else {
        timeLeft--;
        updateTimerDisplay();
      }
    }, 1000);
  }
  function clearTimer() { if (timerInterval) clearInterval(timerInterval); }

  const customRender = (cfg) => {
    const extra = `
      <div class="fun-lives" id="funLivesDisplay">❤️ ${livesObj.value}</div>
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
          livesObj.value = result.livesRemaining;
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
              : (questions[cfg.currentIndex].type === 'fill' ? questions[cfg.currentIndex].answer : formatAnswerLabel(questions[cfg.currentIndex], questions[cfg.currentIndex].answer));
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
            if (cfg.currentIndex + 1 < questions.length) customRender({ ...cfg, currentIndex: cfg.currentIndex + 1 });
            else onFinish(totalScoreObj.value);
          };
        }
      }, 100);
    }
    if (timingMode && !userAnswers[cfg.currentIndex]) {
      startTimer(cfg.currentIndex, (idx) => {
        alert('⏰ 时间到！本题自动判错');
        onSubmit(idx, null).then(result => {
          if (result && !result.correct) {
            livesObj.value = result.livesRemaining;
            if (livesObj.value <= 0) {
              alert('💀 生命值归零，闯关失败！');
              onFinish(totalScoreObj.value);
              return;
            }
          }
          customRender({ ...cfg, currentIndex: idx });
        });
      });
    }
  };
  customRender({
    questions,
    currentIndex: 0,
    userAnswers,
    userScores,
    totalScore: totalScoreObj.value,
    title: `趣味闯关 · ${theme} · ${difficulty === 'easy' ? '简单' : difficulty === 'medium' ? '中等' : '困难'}`,
    onSubmit,
    onFinish,
    onBack: () => { clearTimer(); renderGameView(); },
    showPrev: true
  });
}