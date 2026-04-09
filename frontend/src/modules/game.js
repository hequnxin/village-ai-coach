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
let contestTotalTime = 120; // 2分钟
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

// ==================== 通用全屏答题组件（带上一题/下一题/解析/高亮） ====================
/**
 * 渲染全屏答题界面
 * @param {Object} config 配置对象
 * @param {Array} config.questions 题目列表 [{ id, type, question, options, answer, explanation, hint }]
 * @param {number} config.currentIndex 当前题号（0-based）
 * @param {Array} config.userAnswers 用户答案数组（长度与questions相同，未答为null）
 * @param {Array} config.userScores 每道题是否已得分（可选）
 * @param {number} config.totalScore 当前总分
 * @param {string} config.title 界面标题
 * @param {Function} config.onSubmit 提交答案回调 async (index, answer) => 返回 { correct, correctLabel, explanation }
 * @param {Function} config.onFinish 完成回调（返回总分）
 * @param {Function} config.onBack 返回回调
 * @param {number} config.questionPoints 每题基础分（默认10）
 * @param {boolean} config.showPrev 是否显示上一题按钮（默认true）
 */
function renderFullscreenQuiz(config) {
  const {
    questions,
    currentIndex,
    userAnswers,
    userScores = [],
    totalScore = 0,
    title = '答题闯关',
    onSubmit,
    onFinish,
    onBack,
    questionPoints = 10,
    showPrev = true
  } = config;

  const dynamicContent = document.getElementById('dynamicContent');
  const q = questions[currentIndex];
  const isChoice = q.type === 'choice';
  const isLast = currentIndex === questions.length - 1;
  const isFirst = currentIndex === 0;
  const alreadyAnswered = userAnswers[currentIndex] !== undefined && userAnswers[currentIndex] !== null;
  const alreadyCorrect = userScores[currentIndex] === true;

  let optionsHtml = '';
  if (isChoice) {
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
  } else {
    optionsHtml = `
      <div class="quiz-fill-area">
        <div class="fill-hint">💡 ${escapeHtml(q.hint || '根据上下文填空')}</div>
        <input type="text" id="quizFillInput" class="quiz-fill-input" placeholder="填写答案" value="${escapeHtml(userAnswers[currentIndex] || '')}">
      </div>
    `;
  }

  dynamicContent.innerHTML = `
    <div class="fullscreen-quiz">
      <div class="quiz-header">
        <button class="back-btn" id="quizBackBtn">← 返回</button>
        <div class="quiz-title">${escapeHtml(title)}</div>
        <div class="quiz-progress">第 ${currentIndex+1} / ${questions.length} 题</div>
        <div class="quiz-score">得分: ${totalScore}</div>
      </div>
      <div class="quiz-body">
        <div class="question-text">${escapeHtml(q.question)}</div>
        ${optionsHtml}
        <div id="quizFeedbackArea" class="quiz-feedback-area"></div>
      </div>
      <div class="quiz-footer">
        ${!alreadyCorrect ? `<button id="quizSubmitBtn" class="submit-btn">提交答案</button>` : ''}
        <div style="display: flex; gap: 12px; justify-content: center; margin-top: 12px;">
          ${showPrev && !isFirst ? `<button id="quizPrevBtn" class="summary-btn">← 上一题</button>` : ''}
          ${alreadyCorrect && !isLast ? `<button id="quizNextBtn" class="submit-btn">下一题 →</button>` : ''}
          ${alreadyCorrect && isLast ? `<button id="quizFinishBtn" class="submit-btn success">完成闯关</button>` : ''}
        </div>
      </div>
    </div>
  `;

  // 绑定返回按钮
  document.getElementById('quizBackBtn').onclick = () => {
    if (onBack) onBack();
    else renderGameView();
  };

  // 选择题选项点击
  if (isChoice) {
    const opts = document.querySelectorAll('.quiz-option-item');
    opts.forEach(opt => {
      opt.onclick = () => {
        if (alreadyCorrect) return;
        const selected = parseInt(opt.dataset.opt);
        userAnswers[currentIndex] = selected;
        opts.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
      };
    });
  }

  // 提交答案按钮
  const submitBtn = document.getElementById('quizSubmitBtn');
  if (submitBtn) {
    submitBtn.onclick = async () => {
      let userAnswer;
      if (isChoice) {
        if (userAnswers[currentIndex] === undefined || userAnswers[currentIndex] === null) {
          alert('请选择答案');
          return;
        }
        userAnswer = userAnswers[currentIndex];
      } else {
        const input = document.getElementById('quizFillInput');
        userAnswer = input.value.trim();
        if (!userAnswer) { alert('请填写答案'); return; }
        userAnswers[currentIndex] = userAnswer;
      }
      const result = await onSubmit(currentIndex, userAnswer);
      if (result) {
        const { correct, correctLabel, explanation } = result;
        const feedbackDiv = document.getElementById('quizFeedbackArea');
        if (correct) {
          if (!userScores[currentIndex]) {
            userScores[currentIndex] = true;
            config.totalScore = (config.totalScore || 0) + questionPoints;
          }
          feedbackDiv.innerHTML = `<div class="feedback-correct">✅ 回答正确！${explanation ? '<br>解析：'+escapeHtml(explanation) : ''}</div>`;
          playSound('complete');
        } else {
          feedbackDiv.innerHTML = `<div class="feedback-wrong">❌ 回答错误！正确答案是：${escapeHtml(correctLabel)}<br>${explanation ? '解析：'+escapeHtml(explanation) : ''}</div>`;
          playSound('error');
        }
        // 高亮正确/错误选项（选择题）
        if (isChoice) {
          const opts = document.querySelectorAll('.quiz-option-item');
          const correctIndex = q.answer;
          opts.forEach(opt => {
            const optVal = parseInt(opt.dataset.opt);
            if (optVal === correctIndex) opt.classList.add('correct');
            if (optVal === userAnswer && !correct) opt.classList.add('wrong');
          });
        }
        // 重新渲染以显示下一题按钮
        renderFullscreenQuiz({
          ...config,
          currentIndex,
          userAnswers,
          userScores,
          totalScore: config.totalScore
        });
      }
    };
  }

  // 上一题按钮
  const prevBtn = document.getElementById('quizPrevBtn');
  if (prevBtn) {
    prevBtn.onclick = () => {
      renderFullscreenQuiz({
        ...config,
        currentIndex: currentIndex - 1,
        userAnswers,
        userScores,
        totalScore
      });
    };
  }

  // 下一题按钮
  const nextBtn = document.getElementById('quizNextBtn');
  if (nextBtn) {
    nextBtn.onclick = () => {
      renderFullscreenQuiz({
        ...config,
        currentIndex: currentIndex + 1,
        userAnswers,
        userScores,
        totalScore
      });
    };
  }

  // 完成按钮
  const finishBtn = document.getElementById('quizFinishBtn');
  if (finishBtn) {
    finishBtn.onclick = () => {
      if (onFinish) onFinish(config.totalScore);
      else renderGameView();
    };
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
        <div class="game-module module-wrong animate-scale-up" style="animation-delay:0.3s">
          <div class="module-icon">❌</div>
          <div class="module-title">错题本</div>
          <div class="module-desc">消灭错题，查漏补缺</div>
          <div class="module-stats" id="wrongStats">加载中...</div>
          <button class="module-btn" id="startWrongClearBtn">错题闯关 →</button>
        </div>
        <div class="game-module module-scratch animate-scale-up" style="animation-delay:0.4s">
          <div class="module-icon">🎫</div>
          <div class="module-title">刮刮乐</div>
          <div class="module-desc">每日5次，刮出惊喜</div>
          <div class="module-stats" id="scratchStats">剩余次数: --</div>
          <button class="module-btn" id="getScratchBtn">刮一张 →</button>
        </div>
      </div>
      <div id="levelsModal" class="game-modal" style="display:none;">
        <div class="game-modal-content">
          <div class="game-modal-header">
            <span>🏆 趣味闯关</span>
            <button class="close-modal">&times;</button>
          </div>
          <div id="themesDetailContainer" class="themes-detail"></div>
        </div>
      </div>
    </div>
  `;

  await loadModuleStats();
  await updateScratchRemaining();

  document.getElementById('openFunBtn').onclick = () => showFunLevelsModal();
  document.getElementById('startDailyBtn').onclick = startDailyQuiz;
  document.getElementById('startContestBtn').onclick = startWeeklyContest;
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

// ==================== 每日一练（全屏版本，带完整逻辑） ====================
async function startDailyQuiz() {
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
      renderGameView();
    };

    renderFullscreenQuiz({
      questions,
      currentIndex: 0,
      userAnswers,
      userScores,
      totalScore,
      title: '每日一练',
      onSubmit,
      onFinish,
      onBack: () => renderGameView(),
      questionPoints: 10,
      showPrev: true
    });
  } catch(e) {
    alert('加载每日练习失败');
  }
}
// ==================== 每周竞赛（全屏带倒计时，带上一题/下一题/解析） ====================
async function startWeeklyContest() {
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
      alert(`竞赛完成！得分 ${result.score}/${result.total}，获得 ${result.rewardPoints} 积分`);
      addPoints(result.rewardPoints, '每周竞赛');
      await loadModuleStats();
      renderGameView();
    };

    renderContestFullscreen({
      questions: currentContestQuestions,
      userAnswers,
      userScores,
      totalScore,
      title: `每周竞赛 (第${currentAttemptNumber}/3次)`,
      onSubmit,
      onFinish,
      onBack: () => renderGameView(),
      contestStartTime,
      contestTotalTime
    });
  } catch(e) {
    alert('加载竞赛失败');
  }
}

// 每周竞赛专用全屏渲染（带倒计时，带上一题/下一题/解析）
function renderContestFullscreen(config) {
  const {
    questions,
    userAnswers,
    userScores,
    totalScore,
    title,
    onSubmit,
    onFinish,
    onBack,
    contestStartTime,
    contestTotalTime
  } = config;
  let currentIndex = 0;
  let interval = null;

  function updateTimerDisplay() {
    const elapsed = Math.floor((Date.now() - contestStartTime) / 1000);
    const remaining = Math.max(0, contestTotalTime - elapsed);
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    const timerSpan = document.getElementById('contestTimer');
    if (timerSpan) timerSpan.textContent = `${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;
    if (remaining <= 0) {
      if (interval) clearInterval(interval);
      alert('时间到！自动提交竞赛');
      onFinish(totalScore);
    }
  }

  function renderQuestion(index) {
    const q = questions[index];
    const isLast = index === questions.length - 1;
    const isFirst = index === 0;
    const alreadyCorrect = userScores[index] === true;

    const dynamicContent = document.getElementById('dynamicContent');
    dynamicContent.innerHTML = `
      <div class="fullscreen-quiz">
        <div class="quiz-header">
          <button class="back-btn" id="quizBackBtn">← 返回</button>
          <div class="quiz-title">${escapeHtml(title)}</div>
          <div class="quiz-progress">第 ${index+1} / ${questions.length} 题</div>
          <div class="quiz-score">得分: ${totalScore}</div>
          <div class="contest-timer" id="contestTimer">--:--</div>
        </div>
        <div class="quiz-body">
          <div class="question-text">${escapeHtml(q.question)}</div>
          <div class="quiz-options-list">
            ${q.options.map((opt, idx) => `
              <div class="quiz-option-item ${userAnswers[index] === idx ? 'selected' : ''}" data-opt="${idx}">
                <span class="option-prefix">${String.fromCharCode(65+idx)}.</span>
                ${escapeHtml(opt)}
              </div>
            `).join('')}
          </div>
          <div id="quizFeedbackArea" class="quiz-feedback-area"></div>
        </div>
        <div class="quiz-footer">
          ${!alreadyCorrect ? `<button id="quizSubmitBtn" class="submit-btn">提交答案</button>` : ''}
          <div style="display: flex; gap: 12px; justify-content: center; margin-top: 12px;">
            ${!isFirst ? `<button id="quizPrevBtn" class="summary-btn">← 上一题</button>` : ''}
            ${alreadyCorrect && !isLast ? `<button id="quizNextBtn" class="submit-btn">下一题 →</button>` : ''}
            ${alreadyCorrect && isLast ? `<button id="quizFinishBtn" class="submit-btn success">完成竞赛</button>` : ''}
          </div>
        </div>
      </div>
    `;

    document.getElementById('quizBackBtn').onclick = () => {
      if (interval) clearInterval(interval);
      if (onBack) onBack();
      else renderGameView();
    };

    const opts = document.querySelectorAll('.quiz-option-item');
    opts.forEach(opt => {
      opt.onclick = () => {
        if (alreadyCorrect) return;
        const selected = parseInt(opt.dataset.opt);
        userAnswers[index] = selected;
        opts.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
      };
    });

    const submitBtn = document.getElementById('quizSubmitBtn');
    if (submitBtn) {
      submitBtn.onclick = async () => {
        if (userAnswers[index] === undefined || userAnswers[index] === null) {
          alert('请选择答案');
          return;
        }
        const result = await onSubmit(index, userAnswers[index]);
        if (result) {
          const { correct, correctLabel, explanation } = result;
          const feedbackDiv = document.getElementById('quizFeedbackArea');
          if (correct) {
            if (!userScores[index]) userScores[index] = true;
            config.totalScore = (config.totalScore || 0) + 10;
            feedbackDiv.innerHTML = `<div class="feedback-correct">✅ 回答正确！${explanation ? '<br>解析：'+escapeHtml(explanation) : ''}</div>`;
            playSound('complete');
          } else {
            feedbackDiv.innerHTML = `<div class="feedback-wrong">❌ 回答错误！正确答案是：${escapeHtml(correctLabel)}<br>${explanation ? '解析：'+escapeHtml(explanation) : ''}</div>`;
            playSound('error');
          }
          // 高亮正确/错误选项
          const correctIndex = q.answer;
          opts.forEach(opt => {
            const optVal = parseInt(opt.dataset.opt);
            if (optVal === correctIndex) opt.classList.add('correct');
            if (optVal === userAnswers[index] && !correct) opt.classList.add('wrong');
          });
          // 重新渲染以显示下一题按钮
          renderQuestion(index);
        }
      };
    }

    const prevBtn = document.getElementById('quizPrevBtn');
    if (prevBtn) {
      prevBtn.onclick = () => renderQuestion(index - 1);
    }

    const nextBtn = document.getElementById('quizNextBtn');
    if (nextBtn) {
      nextBtn.onclick = () => renderQuestion(index + 1);
    }

    const finishBtn = document.getElementById('quizFinishBtn');
    if (finishBtn) {
      finishBtn.onclick = () => {
        if (interval) clearInterval(interval);
        onFinish(totalScore);
      };
    }
  }

  if (interval) clearInterval(interval);
  updateTimerDisplay();
  interval = setInterval(updateTimerDisplay, 1000);
  renderQuestion(0);
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

// ==================== 错题本（保持原有弹窗逻辑，但未改造为全屏） ====================
async function startWrongClear() {
  const res = await fetchWithAuth('/api/game/wrong-questions');
  wrongQuestionsList = await res.json();
  if (wrongQuestionsList.length === 0) {
    alert('暂无错题');
    return;
  }
  wrongClearStartCount = wrongQuestionsList.length;
  wrongClearCorrectCount = 0;
  currentWrongIndex = 0;
  showWrongQuestion();
}

function showWrongQuestion() {
  if (currentWrongIndex >= wrongQuestionsList.length) {
    const remaining = wrongQuestionsList.length - wrongClearCorrectCount;
    alert(`错题闯关结束！本次共处理 ${wrongClearStartCount} 题，其中答对 ${wrongClearCorrectCount} 题，剩余错题 ${remaining} 道。`);
    loadModuleStats();
    return;
  }
  const w = wrongQuestionsList[currentWrongIndex];
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content" style="width:500px;">
      <button class="modal-close">&times;</button>
      <div class="question-text">${escapeHtml(w.question)}</div>
      <div class="options-list">
        ${w.options.map((opt, idx) => `
          <div class="option-item" data-opt="${idx}">
            <span class="option-prefix">${String.fromCharCode(65+idx)}.</span>
            ${escapeHtml(opt)}
          </div>
        `).join('')}
      </div>
      <div id="feedbackArea" style="margin-top:12px;"></div>
      <div style="margin-top:20px;">
        <button id="submitWrongBtn" class="submit-btn">提交答案</button>
        <button id="skipWrongBtn" class="summary-btn" style="margin-left:10px;">跳过本题</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const closeModal = () => document.body.removeChild(modal);
  modal.querySelector('.modal-close').onclick = closeModal;
  modal.onclick = (e) => { if(e.target===modal) closeModal(); };

  let selected = null;
  const opts = modal.querySelectorAll('.option-item');
  opts.forEach(opt => {
    opt.onclick = () => {
      if (selected !== null && modal.querySelector('#submitWrongBtn').disabled) return;
      opts.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selected = parseInt(opt.dataset.opt);
    };
  });

  const submitBtn = modal.querySelector('#submitWrongBtn');
  const skipBtn = modal.querySelector('#skipWrongBtn');
  const feedbackDiv = modal.querySelector('#feedbackArea');
  const correctIndex = parseInt(w.answer);
  const correctLabel = formatAnswerLabel(w, correctIndex);

  submitBtn.onclick = async () => {
    if (selected === null) { alert('请选择答案'); return; }
    const userIndex = parseInt(selected);
    const isCorrect = (userIndex === correctIndex);

    opts.forEach(opt => {
      const optVal = parseInt(opt.dataset.opt);
      if (optVal === correctIndex) opt.classList.add('correct');
      if (optVal === userIndex && !isCorrect) opt.classList.add('wrong');
    });

    if (isCorrect) {
      feedbackDiv.innerHTML = `<div style="color:#2e5d34; background:#c8e6c9; padding:8px; border-radius:8px;">✅ 回答正确！${w.explanation ? '<br>解析：'+escapeHtml(w.explanation) : ''}</div>`;
      playSound('complete');
      const res = await fetchWithAuth('/api/game/wrong-questions/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [{ questionId: w.question_id, selected: userIndex }] })
      });
      const result = await res.json();
      if (result.clearedCount > 0) {
        addPoints(result.rewardPoints, '错题闯关');
        wrongClearCorrectCount++;
        wrongQuestionsList.splice(currentWrongIndex, 1);
        loadModuleStats();
      } else {
        currentWrongIndex++;
      }
      setTimeout(() => {
        closeModal();
        showWrongQuestion();
      }, 1500);
    } else {
      feedbackDiv.innerHTML = `<div style="color:#d32f2f; background:#ffcdd2; padding:8px; border-radius:8px;">❌ 回答错误！正确答案是：${escapeHtml(correctLabel)}<br>${w.explanation ? '解析：'+escapeHtml(w.explanation) : ''}</div>`;
      playSound('error');
      submitBtn.disabled = true;
      const nextBtn = document.createElement('button');
      nextBtn.textContent = '下一题';
      nextBtn.className = 'submit-btn';
      nextBtn.style.marginLeft = '10px';
      nextBtn.onclick = () => {
        closeModal();
        currentWrongIndex++;
        showWrongQuestion();
      };
      submitBtn.parentNode.appendChild(nextBtn);
    }
  };

  skipBtn.onclick = () => {
    closeModal();
    currentWrongIndex++;
    showWrongQuestion();
  };
}

// ==================== 刮刮乐（保持原有弹窗逻辑） ====================
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

// ==================== 趣味闯关（保持原有弹窗逻辑，未改造为全屏） ====================
async function showFunLevelsModal() {
  const modal = document.getElementById('levelsModal');
  const container = document.getElementById('themesDetailContainer');
  if (!container) return;
  modal.style.display = 'flex';
  const closeBtn = modal.querySelector('.close-modal');
  if (closeBtn) closeBtn.onclick = () => { modal.style.display = 'none'; };
  modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

  container.innerHTML = `
    <div class="fun-levels-container animate-fade-in">
      <h3>🎮 趣味闯关</h3>
      <p>选择主题和难度，挑战自我！</p>
      <div class="difficulty-selector">
        <button class="difficulty-btn" data-diff="easy">🌱 简单 (3题)</button>
        <button class="difficulty-btn" data-diff="medium">⚡ 中等 (5题)</button>
        <button class="difficulty-btn" data-diff="hard">🔥 困难 (8题)</button>
      </div>
      <div class="themes-grid" id="funThemesGrid">加载中...</div>
    </div>
  `;

  const themesRes = await fetchWithAuth('/api/game/policy-themes');
  const themes = await themesRes.json();
  const grid = document.getElementById('funThemesGrid');
  grid.innerHTML = themes.map(theme => `
    <div class="fun-theme-card animate-scale-up" data-theme="${theme.name}" data-id="${theme.id}">
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
      btn.style.transform = 'scale(0.95)';
      setTimeout(() => btn.style.transform = '', 150);
    };
  });
  document.querySelector('.difficulty-btn[data-diff="medium"]').classList.add('active');

  document.querySelectorAll('.fun-theme-card').forEach(card => {
    card.onclick = async () => {
      const theme = card.dataset.theme;
      const themeId = card.dataset.id;
      await startFunChallenge(theme, themeId, selectedDifficulty);
    };
  });
}

async function startFunChallenge(theme, themeId, difficulty) {
  let questionCount = 3;
  if (difficulty === 'medium') questionCount = 5;
  if (difficulty === 'hard') questionCount = 8;

  const res = await fetchWithAuth(`/api/game/fun-level-questions?theme=${encodeURIComponent(theme)}&difficulty=${difficulty}&count=${questionCount}`);
  const data = await res.json();
  currentFunQuestions = data.questions;
  currentFunIndex = 0;
  currentFunScore = 0;
  currentFunLives = 3;
  currentFunTheme = theme;
  currentFunDifficulty = difficulty;
  currentFunEvent = data.event;
  currentFunEventUsed = false;

  showFunQuestion();
}

function showFunQuestion() {
  if (currentFunIndex >= currentFunQuestions.length) {
    const totalPossible = currentFunQuestions.length * 10;
    const bonus = (currentFunLives * 5) + (currentFunScore > totalPossible * 0.8 ? 20 : 0);
    const finalScore = currentFunScore + bonus;
    showSuccessModal(`🎉 闯关成功！\n得分：${currentFunScore}\n剩余生命：${currentFunLives}\n额外奖励：${bonus}\n总积分：${finalScore}`);
    addPoints(finalScore, '趣味闯关');
    fetchWithAuth('/api/game/policy-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeId: currentFunTheme, score: currentFunScore, total: currentFunQuestions.length })
    });
    const modal = document.getElementById('levelsModal');
    if (modal) modal.style.display = 'none';
    loadModuleStats();
    return;
  }

  const q = currentFunQuestions[currentFunIndex];
  const modal = document.createElement('div');
  modal.className = 'modal animate-slide-up';
  modal.style.display = 'flex';
  let eventHtml = '';
  if (currentFunEvent && !currentFunEventUsed && currentFunIndex === 0) {
    let eventText = '';
    if (currentFunEvent === 'double') eventText = '🎁 双倍积分事件！本题答对得双倍积分！';
    else if (currentFunEvent === 'hint') eventText = '💡 提示事件：可免费获得一次提示（点击提示按钮）';
    else if (currentFunEvent === 'skip') eventText = '⏭️ 免答事件：可免费跳过本题（不扣生命）';
    eventHtml = `<div class="fun-event animate-pulse">${eventText}</div>`;
  }
  modal.innerHTML = `
    <div class="modal-content" style="width:500px;">
      <button class="modal-close">&times;</button>
      <div class="fun-header">
        <span class="heart-icon">❤️ ${currentFunLives}</span>
        <span class="star-icon">⭐ ${currentFunScore}</span>
        <span class="progress-icon">📊 ${currentFunIndex+1}/${currentFunQuestions.length}</span>
      </div>
      ${eventHtml}
      <div class="question-text">${escapeHtml(q.question)}</div>
      <div class="options-list">
        ${q.options.map((opt, idx) => `
          <div class="option-item animate-option" data-opt="${idx}">
            <span class="option-prefix">${String.fromCharCode(65+idx)}.</span>
            ${escapeHtml(opt)}
          </div>
        `).join('')}
      </div>
      <div style="margin-top:20px; display:flex; gap:10px;">
        <button id="submitAnswerBtn" class="submit-btn pulse-on-hover">提交答案</button>
        ${currentFunEvent === 'hint' && !currentFunEventUsed ? '<button id="hintBtn" class="summary-btn">💡 提示</button>' : ''}
        ${currentFunEvent === 'skip' && !currentFunEventUsed ? '<button id="skipBtn" class="summary-btn">⏭️ 跳过</button>' : ''}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const closeModal = () => document.body.removeChild(modal);
  modal.querySelector('.modal-close').onclick = closeModal;
  modal.onclick = (e) => { if(e.target===modal) closeModal(); };

  let selected = null;
  const opts = modal.querySelectorAll('.option-item');
  opts.forEach(opt => {
    opt.onclick = () => {
      opts.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selected = parseInt(opt.dataset.opt);
      opt.style.transform = 'scale(0.98)';
      setTimeout(() => opt.style.transform = '', 150);
    };
  });

  const submitBtn = modal.querySelector('#submitAnswerBtn');
  const hintBtn = modal.querySelector('#hintBtn');
  const skipBtn = modal.querySelector('#skipBtn');

  if (hintBtn) {
    hintBtn.onclick = () => {
      const correctAnswer = formatAnswerLabel(q, q.answer);
      alert(`💡 提示：正确答案是 "${correctAnswer}"`);
      currentFunEventUsed = true;
      hintBtn.disabled = true;
      hintBtn.style.opacity = '0.6';
    };
  }
  if (skipBtn) {
    skipBtn.onclick = () => {
      currentFunEventUsed = true;
      closeModal();
      currentFunIndex++;
      showFunQuestion();
    };
  }

  submitBtn.onclick = async () => {
    if (selected === null) { alert('请选择答案'); return; }
    const isCorrect = (selected === q.answer);
    let pointsGain = 10;
    if (currentFunDifficulty === 'hard') pointsGain += 5;
    if (currentFunEvent === 'double' && !currentFunEventUsed && isCorrect) {
      pointsGain *= 2;
      currentFunEventUsed = true;
    }
    if (isCorrect) {
      currentFunScore += pointsGain;
      playSound('complete');
      const correctOpt = opts[q.answer];
      correctOpt.classList.add('correct-flash');
      setTimeout(() => correctOpt.classList.remove('correct-flash'), 500);
      alert(`✅ 回答正确！ +${pointsGain} 积分`);
    } else {
      currentFunLives--;
      playSound('error');
      const wrongOpt = opts[selected];
      wrongOpt.classList.add('wrong-shake');
      setTimeout(() => wrongOpt.classList.remove('wrong-shake'), 500);
      const correctLabel = formatAnswerLabel(q, q.answer);
      alert(`❌ 回答错误！正确答案是：${correctLabel}\n${q.explanation || ''}`);
      if (currentFunLives <= 0) {
        alert(`💀 闯关失败！得分：${currentFunScore}`);
        closeModal();
        const modalDiv = document.getElementById('levelsModal');
        if (modalDiv) modalDiv.style.display = 'none';
        return;
      }
    }
    closeModal();
    currentFunIndex++;
    showFunQuestion();
  };
}

function showSuccessModal(message) {
  const modal = document.createElement('div');
  modal.className = 'modal animate-fade-in';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content success-modal">
      <button class="modal-close">&times;</button>
      <div class="success-emoji">🎉🏆🎉</div>
      <div style="white-space:pre-line;">${escapeHtml(message)}</div>
      <button id="successCloseBtn" class="submit-btn" style="margin-top:20px;">太棒了</button>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => document.body.removeChild(modal);
  modal.querySelector('.modal-close').onclick = close;
  modal.querySelector('#successCloseBtn').onclick = close;
  modal.onclick = (e) => { if(e.target===modal) close(); };
}