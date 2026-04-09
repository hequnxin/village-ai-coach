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

// ==================== 主渲染 ====================
export async function renderGameView() {
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="game-lobby">
      <div class="game-lobby-header">
        <h1>🎮 挑战中心</h1>
        <p>积分挑战，赢取勋章</p>
      </div>
      <div class="game-grid">
        <div class="game-module module-levels">
          <div class="module-icon">🏆</div>
          <div class="module-title">政策闯关</div>
          <div class="module-desc">逐级解锁，赢取积分</div>
          <div class="module-preview" id="themesPreview">点击进入</div>
          <button class="module-btn" id="openLevelsBtn">进入闯关 →</button>
        </div>
        <div class="game-module module-daily">
          <div class="module-icon">📖</div>
          <div class="module-title">每日一练</div>
          <div class="module-desc">选择题+填空题，每日更新</div>
          <div class="module-stats" id="dailyStats">今日未开始</div>
          <button class="module-btn" id="startDailyBtn">开始练习 →</button>
        </div>
        <div class="game-module module-contest">
          <div class="module-icon">🏅</div>
          <div class="module-title">每周竞赛</div>
          <div class="module-desc">限时2分钟，每周3次</div>
          <div class="module-stats" id="contestStats">本周未参加</div>
          <div style="display: flex; gap: 8px;">
            <button class="module-btn" id="startContestBtn">参加竞赛 →</button>
            <button class="module-btn" id="rankContestBtn" style="background: #ff9800;">🏆 排行榜</button>
          </div>
        </div>
        <div class="game-module module-wrong">
          <div class="module-icon">❌</div>
          <div class="module-title">错题本</div>
          <div class="module-desc">消灭错题，查漏补缺</div>
          <div class="module-stats" id="wrongStats">加载中...</div>
          <button class="module-btn" id="startWrongClearBtn">错题闯关 →</button>
        </div>
        <div class="game-module module-scratch">
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
            <span>🏆 政策闯关</span>
            <button class="close-modal">&times;</button>
          </div>
          <div id="themesDetailContainer" class="themes-detail"></div>
        </div>
      </div>
    </div>
  `;

  await loadModuleStats();
  await updateScratchRemaining();

  document.getElementById('openLevelsBtn').onclick = () => showLevelsModal();
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

// ==================== 政策闯关 ====================
async function showLevelsModal() {
  const modal = document.getElementById('levelsModal');
  const container = document.getElementById('themesDetailContainer');
  if (!container) return;
  modal.style.display = 'flex';
  const closeBtn = modal.querySelector('.close-modal');
  if (closeBtn) closeBtn.onclick = () => { modal.style.display = 'none'; };
  modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

  container.innerHTML = '<div>加载中...</div>';
  try {
    const res = await fetchWithAuth('/api/game/themes');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const themes = await res.json();
    renderThemesDetail(container, themes);
  } catch (err) {
    console.error('加载主题失败', err);
    container.innerHTML = '<div style="color:red;">加载失败，请刷新重试</div>';
  }
}

function renderThemesDetail(container, themes) {
  let html = '';
  for (const theme of themes) {
    html += `
      <div class="theme-group">
        <div class="theme-group-header">
          <span class="theme-icon">${escapeHtml(theme.icon)}</span>
          <span class="theme-name">${escapeHtml(theme.name)}</span>
          <span class="theme-desc">${escapeHtml(theme.description)}</span>
        </div>
        <div class="level-cards">
    `;
    for (const level of theme.levels) {
      const locked = !level.completed && level.unlock_points > 0 && appState.userPoints < level.unlock_points;
      html += `
        <div class="level-card ${level.completed ? 'completed' : ''} ${locked ? 'locked' : ''}" data-level-id="${level.id}">
          <div class="level-name">${escapeHtml(level.name)}</div>
          <div class="level-desc">${escapeHtml(level.description)}</div>
          <div class="level-difficulty">难度: ${'⭐'.repeat(level.difficulty)}</div>
          <div class="level-reward">奖励: ${level.reward_points}分</div>
          ${level.completed ? '<div class="level-badge">✅ 已通关</div>' : (locked ? `<div class="level-badge">🔒 需${level.unlock_points}分</div>` : '<button class="level-start-btn">开始挑战</button>')}
        </div>
      `;
    }
    html += `</div></div>`;
  }
  container.innerHTML = html;

  document.querySelectorAll('.level-card:not(.locked)').forEach(card => {
    const levelId = card.dataset.levelId;
    const levelName = card.querySelector('.level-name')?.textContent || '关卡';
    const startGame = () => {
      const modal = document.getElementById('levelsModal');
      if (modal) modal.style.display = 'none';
      startLevel(levelId, levelName);
    };
    card.addEventListener('click', (e) => {
      if (e.target.classList && e.target.classList.contains('level-start-btn')) return;
      startGame();
    });
    const btn = card.querySelector('.level-start-btn');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        startGame();
      });
    }
  });
}

async function startLevel(levelId, levelName) {
  try {
    const res = await fetchWithAuth(`/api/game/level/${levelId}`);
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || '无法开始关卡');
      return;
    }
    const questions = await res.json();
    if (!questions.length) {
      alert('该关卡暂无题目');
      return;
    }
    currentLevelQuestions = questions;
    currentLevelAnswers = new Array(questions.length).fill(null);
    currentLevelIndex = 0;
    currentLevelId = levelId;
    showLevelQuestion();
  } catch (e) {
    alert('加载关卡失败');
  }
}

function showLevelQuestion() {
  const q = currentLevelQuestions[currentLevelIndex];
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content" style="width:500px;">
      <button class="modal-close">&times;</button>
      <div class="question-text">${escapeHtml(q.question)}</div>
      <div class="options-list">
        ${q.options.map((opt, idx) => `
          <div class="option-item" data-opt="${idx}">
            <span class="option-prefix">${String.fromCharCode(65+idx)}.</span>
            ${escapeHtml(opt)}
          </div>
        `).join('')}
      </div>
      <div style="margin-top:20px; display:flex; justify-content:space-between;">
        <button id="prevBtn" class="summary-btn" ${currentLevelIndex===0?'disabled':''}>上一题</button>
        <button id="nextBtn" class="submit-btn">${currentLevelIndex===currentLevelQuestions.length-1?'提交':'下一题'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const closeModal = () => document.body.removeChild(modal);
  modal.querySelector('.modal-close').onclick = closeModal;
  modal.onclick = (e) => { if(e.target===modal) closeModal(); };

  const opts = modal.querySelectorAll('.option-item');
  if (currentLevelAnswers[currentLevelIndex] !== undefined) {
    const selectedIdx = currentLevelAnswers[currentLevelIndex];
    opts.forEach(opt => {
      if (parseInt(opt.dataset.opt) === selectedIdx) opt.classList.add('selected');
    });
  }
  opts.forEach(opt => {
    opt.onclick = () => {
      const selected = parseInt(opt.dataset.opt);
      currentLevelAnswers[currentLevelIndex] = selected;
      opts.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    };
  });

  const prevBtn = modal.querySelector('#prevBtn');
  const nextBtn = modal.querySelector('#nextBtn');
  if (prevBtn) prevBtn.onclick = () => { if(currentLevelIndex>0) { currentLevelIndex--; closeModal(); showLevelQuestion(); } };
  nextBtn.onclick = async () => {
    if (currentLevelAnswers[currentLevelIndex] === undefined) {
      alert('请选择答案');
      return;
    }
    if (currentLevelIndex === currentLevelQuestions.length-1) {
      const answers = currentLevelQuestions.map((q, i) => ({ questionId: q.id, selected: currentLevelAnswers[i] }));
      const res = await fetchWithAuth('/api/game/level/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ levelId: currentLevelId, answers })
      });
      const result = await res.json();
      closeModal();
      if (result.passed) {
        alert(`闯关成功！获得 ${result.reward} 积分`);
        addPoints(result.reward, '政策闯关通关');
        updateTaskProgress('policyLevel', 1);
        loadModuleStats();
      } else {
        alert(`闯关失败！得分 ${result.totalScore}/${result.maxScore}，再接再厉！`);
      }
    } else {
      currentLevelIndex++;
      closeModal();
      showLevelQuestion();
    }
  };
}

// ==================== 每日一练 ====================
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
    currentDailyQuestions = data.questions;
    currentDailyAnswers = new Array(currentDailyQuestions.length).fill(null);
    currentDailyScores = new Array(currentDailyQuestions.length).fill(false);
    dailyScore = 0;
    currentDailyQuizId = data.quizId;
    showDailyQuestion(0);
  } catch(e) {
    alert('加载每日练习失败');
  }
}

function showDailyQuestion(index) {
  const q = currentDailyQuestions[index];
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  let contentHtml = `
    <div class="modal-content" style="width:500px;">
      <button class="modal-close">&times;</button>
      <div class="question-text">${escapeHtml(q.question)}</div>
      <div class="progress-info" style="margin: 8px 0; font-size: 0.8rem; color: #666;">第 ${index+1} / ${currentDailyQuestions.length} 题</div>
  `;
  if (q.type === 'choice') {
    contentHtml += `
      <div class="options-list">
        ${q.options.map((opt, idx) => `
          <div class="option-item" data-opt="${idx}">
            <span class="option-prefix">${String.fromCharCode(65+idx)}.</span>
            ${escapeHtml(opt)}
          </div>
        `).join('')}
      </div>
    `;
  } else {
    contentHtml += `
      <div class="fill-hint" style="color:#666; margin-bottom:12px;">💡 ${escapeHtml(q.hint || '根据上下文填空')}</div>
      <input type="text" id="fillAnswer" class="fill-input" placeholder="填写答案" style="width:100%; padding:8px;">
    `;
  }
  contentHtml += `<div id="feedbackArea" style="margin-top:12px;"></div>`;
  if (currentDailyScores[index]) {
    contentHtml += `<div style="margin-top:20px;"><button id="nextBtn" class="submit-btn">${index===currentDailyQuestions.length-1?'完成':'下一题'}</button></div>`;
  } else {
    contentHtml += `<div style="margin-top:20px;"><button id="submitAnswerBtn" class="submit-btn">提交答案</button></div>`;
  }
  contentHtml += `</div>`;
  modal.innerHTML = contentHtml;
  document.body.appendChild(modal);
  const closeModal = () => document.body.removeChild(modal);
  modal.querySelector('.modal-close').onclick = closeModal;
  modal.onclick = (e) => { if(e.target===modal) closeModal(); };

  if (q.type === 'choice') {
    const opts = modal.querySelectorAll('.option-item');
    let selected = null;
    if (currentDailyAnswers[index] !== undefined) {
      const saved = currentDailyAnswers[index];
      opts.forEach(opt => {
        if (parseInt(opt.dataset.opt) === saved) {
          opt.classList.add('selected');
          selected = saved;
        }
      });
    }
    opts.forEach(opt => {
      opt.onclick = () => {
        if (currentDailyScores[index]) return;
        const val = parseInt(opt.dataset.opt);
        selected = val;
        opts.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
      };
    });
    const submitBtn = modal.querySelector('#submitAnswerBtn');
    if (submitBtn) {
      submitBtn.onclick = async () => {
        if (selected === null) { alert('请选择答案'); return; }
        await submitDailyAnswer(index, selected, modal);
      };
    }
  } else {
    const input = modal.querySelector('#fillAnswer');
    if (currentDailyAnswers[index]) input.value = currentDailyAnswers[index];
    const submitBtn = modal.querySelector('#submitAnswerBtn');
    if (submitBtn) {
      submitBtn.onclick = async () => {
        const answer = input.value.trim();
        if (!answer) { alert('请填写答案'); return; }
        await submitDailyAnswer(index, answer, modal);
      };
    }
  }

  const nextBtn = modal.querySelector('#nextBtn');
  if (nextBtn) {
    nextBtn.onclick = () => {
      closeModal();
      if (index === currentDailyQuestions.length-1) {
        finishDailyQuiz();
      } else {
        showDailyQuestion(index+1);
      }
    };
  }
}

async function submitDailyAnswer(index, userAnswer, modal) {
  const q = currentDailyQuestions[index];
  let isCorrect = false;
  let correctLabel = '';

  if (q.type === 'choice') {
    const correctIndex = parseInt(q.answer);
    const userIndex = parseInt(userAnswer);
    isCorrect = (userIndex === correctIndex);
    correctLabel = String.fromCharCode(65 + correctIndex) + '. ' + q.options[correctIndex];

    if (isCorrect) {
      if (!currentDailyScores[index]) {
        currentDailyScores[index] = true;
        dailyScore++;
      }
      const feedback = modal.querySelector('#feedbackArea');
      feedback.innerHTML = `<div style="color:#2e5d34; background:#c8e6c9; padding:8px; border-radius:8px;">✅ 回答正确！${q.explanation ? '<br>解析：'+escapeHtml(q.explanation) : ''}</div>`;
      const opts = modal.querySelectorAll('.option-item');
      opts.forEach(opt => {
        if (parseInt(opt.dataset.opt) === correctIndex) opt.classList.add('correct');
      });
      const submitBtn = modal.querySelector('#submitAnswerBtn');
      if (submitBtn) submitBtn.disabled = true;
      const nextBtn = document.createElement('button');
      nextBtn.className = 'submit-btn';
      nextBtn.textContent = index === currentDailyQuestions.length-1 ? '完成' : '下一题';
      nextBtn.style.marginLeft = '10px';
      nextBtn.onclick = () => {
        modal.querySelector('.modal-close').click();
        if (index === currentDailyQuestions.length-1) finishDailyQuiz();
        else showDailyQuestion(index+1);
      };
      modal.querySelector('div[style*="margin-top:20px"]').appendChild(nextBtn);
    } else {
      const feedback = modal.querySelector('#feedbackArea');
      feedback.innerHTML = `<div style="color:#d32f2f; background:#ffcdd2; padding:8px; border-radius:8px;">❌ 回答错误！正确答案是：${escapeHtml(correctLabel)}<br>${q.explanation ? '解析：'+escapeHtml(q.explanation) : ''}</div>`;
      const opts = modal.querySelectorAll('.option-item');
      opts.forEach(opt => {
        const optVal = parseInt(opt.dataset.opt);
        if (optVal === correctIndex) opt.classList.add('correct');
        if (optVal === userIndex && !isCorrect) opt.classList.add('wrong');
      });
      await fetchWithAuth('/api/game/wrong-questions/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: q.id, userAnswer: userIndex })
      });
      const submitBtn = modal.querySelector('#submitAnswerBtn');
      if (submitBtn) submitBtn.disabled = true;
      const nextBtn = document.createElement('button');
      nextBtn.className = 'submit-btn';
      nextBtn.textContent = index === currentDailyQuestions.length-1 ? '完成' : '下一题';
      nextBtn.style.marginLeft = '10px';
      nextBtn.onclick = () => {
        modal.querySelector('.modal-close').click();
        if (index === currentDailyQuestions.length-1) finishDailyQuiz();
        else showDailyQuestion(index+1);
      };
      modal.querySelector('div[style*="margin-top:20px"]').appendChild(nextBtn);
    }
  } else {
    // 填空题
    const correctStr = q.answer.trim().toLowerCase();
    const userStr = (typeof userAnswer === 'string' ? userAnswer : String(userAnswer)).trim().toLowerCase();
    isCorrect = (userStr === correctStr);
    correctLabel = q.answer;
    if (isCorrect) {
      if (!currentDailyScores[index]) {
        currentDailyScores[index] = true;
        dailyScore++;
      }
      const feedback = modal.querySelector('#feedbackArea');
      feedback.innerHTML = `<div style="color:#2e5d34; background:#c8e6c9; padding:8px; border-radius:8px;">✅ 回答正确！${q.explanation ? '<br>解析：'+escapeHtml(q.explanation) : ''}</div>`;
      const input = modal.querySelector('#fillAnswer');
      if (input) input.classList.add('correct');
      const submitBtn = modal.querySelector('#submitAnswerBtn');
      if (submitBtn) submitBtn.disabled = true;
      const nextBtn = document.createElement('button');
      nextBtn.className = 'submit-btn';
      nextBtn.textContent = index === currentDailyQuestions.length-1 ? '完成' : '下一题';
      nextBtn.style.marginLeft = '10px';
      nextBtn.onclick = () => {
        modal.querySelector('.modal-close').click();
        if (index === currentDailyQuestions.length-1) finishDailyQuiz();
        else showDailyQuestion(index+1);
      };
      modal.querySelector('div[style*="margin-top:20px"]').appendChild(nextBtn);
    } else {
      const feedback = modal.querySelector('#feedbackArea');
      feedback.innerHTML = `<div style="color:#d32f2f; background:#ffcdd2; padding:8px; border-radius:8px;">❌ 回答错误！正确答案是：${escapeHtml(correctLabel)}<br>${q.explanation ? '解析：'+escapeHtml(q.explanation) : ''}</div>`;
      const input = modal.querySelector('#fillAnswer');
      if (input) input.classList.add('wrong');
      await fetchWithAuth('/api/game/wrong-questions/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: q.id, userAnswer: userAnswer })
      });
      const submitBtn = modal.querySelector('#submitAnswerBtn');
      if (submitBtn) submitBtn.disabled = true;
      const nextBtn = document.createElement('button');
      nextBtn.className = 'submit-btn';
      nextBtn.textContent = index === currentDailyQuestions.length-1 ? '完成' : '下一题';
      nextBtn.style.marginLeft = '10px';
      nextBtn.onclick = () => {
        modal.querySelector('.modal-close').click();
        if (index === currentDailyQuestions.length-1) finishDailyQuiz();
        else showDailyQuestion(index+1);
      };
      modal.querySelector('div[style*="margin-top:20px"]').appendChild(nextBtn);
    }
  }
  playSound(isCorrect ? 'complete' : 'error');
}

async function finishDailyQuiz() {
  const total = currentDailyQuestions.length;
  const rewardPoints = dailyScore * 10 + (dailyScore === total ? 20 : 0);
  try {
    const res = await fetchWithAuth('/api/game/daily/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quizId: currentDailyQuizId, score: dailyScore, total })
    });
    const result = await res.json();
    alert(`练习完成！得分 ${dailyScore}/${total}，获得 ${rewardPoints} 积分`);
    addPoints(rewardPoints, '每日一练');
    updateTaskProgress('quiz', 1);
    await loadModuleStats(); // 刷新卡片状态
  } catch(e) {
    alert('提交失败，但本地得分已记录');
  }
}

// ==================== 每周竞赛（总倒计时不重置） ====================
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
    contestStartTime = Date.now(); // 只初始化一次
    currentAttemptNumber = data.attemptNumber;
    showContestQuestion(0);
  } catch(e) {
    alert('加载竞赛失败');
  }
}

function showContestQuestion(index) {
  const q = currentContestQuestions[index];
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content" style="width:500px;">
      <button class="modal-close">&times;</button>
      <div class="contest-header" style="background:#ff9800;color:white; padding:8px; border-radius:8px; margin-bottom:16px;">
        <span>🏆 每周竞赛 (第${currentAttemptNumber}/3次)</span>
        <span id="contestTimer" style="font-family:monospace;">02:00</span>
      </div>
      <div class="contest-progress" style="margin-bottom:12px; text-align:center;">第 ${index+1} / ${currentContestQuestions.length} 题</div>
      <div class="question-text">${escapeHtml(q.question)}</div>
      <div class="options-list">
        ${q.options.map((opt, idx) => `
          <div class="option-item" data-opt="${idx}">
            <span class="option-prefix">${String.fromCharCode(65+idx)}.</span>
            ${escapeHtml(opt)}
          </div>
        `).join('')}
      </div>
      <div id="feedbackArea" style="margin-top:12px;"></div>
      <div style="margin-top:20px; display:flex; justify-content:space-between;">
        <button id="prevBtn" class="summary-btn" ${index===0?'disabled':''}>上一题</button>
        <button id="submitBtn" class="submit-btn">${index===currentContestQuestions.length-1?'提交竞赛':'提交本题'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const closeModal = () => {
    if (contestTimerInterval) clearInterval(contestTimerInterval);
    document.body.removeChild(modal);
  };
  modal.querySelector('.modal-close').onclick = closeModal;
  modal.onclick = (e) => { if(e.target===modal) closeModal(); };

  // 更新倒计时（基于固定起始时间）
  const updateTimerDisplay = () => {
    const elapsed = Math.floor((Date.now() - contestStartTime) / 1000);
    const remaining = Math.max(0, contestTotalTime - elapsed);
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    const timerSpan = document.getElementById('contestTimer');
    if (timerSpan) timerSpan.textContent = `${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;
    if (remaining <= 0) {
      clearInterval(contestTimerInterval);
      alert('时间到！自动提交竞赛');
      finalizeContest(modal, contestTotalTime);
    }
  };
  if (contestTimerInterval) clearInterval(contestTimerInterval);
  updateTimerDisplay(); // 立即更新一次
  contestTimerInterval = setInterval(updateTimerDisplay, 1000);

  const opts = modal.querySelectorAll('.option-item');
  let selected = null;
  if (currentContestAnswers[index] !== undefined && currentContestAnswers[index] !== null) {
    const saved = currentContestAnswers[index];
    opts.forEach(opt => {
      if (parseInt(opt.dataset.opt) === saved) {
        opt.classList.add('selected');
        selected = saved;
      }
    });
  }
  opts.forEach(opt => {
    opt.onclick = () => {
      if (currentContestAnswers[index] !== undefined && currentContestAnswers[index] !== null) return;
      selected = parseInt(opt.dataset.opt);
      opts.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    };
  });

  const prevBtn = modal.querySelector('#prevBtn');
  const submitBtn = modal.querySelector('#submitBtn');
  if (prevBtn) prevBtn.onclick = () => {
    if (index > 0) {
      closeModal();
      showContestQuestion(index-1);
    }
  };
  submitBtn.onclick = async () => {
    if (selected === null && currentContestAnswers[index] === null) {
      alert('请选择答案');
      return;
    }
    if (selected !== null) currentContestAnswers[index] = selected;
    await submitContestSingle(index, currentContestAnswers[index], modal);
    if (index === currentContestQuestions.length-1) {
      clearInterval(contestTimerInterval);
      const timeUsed = Math.floor((Date.now() - contestStartTime) / 1000);
      await finalizeContest(modal, timeUsed);
    } else {
      // 延迟1.5秒后自动进入下一题，倒计时继续
      setTimeout(() => {
        closeModal();
        showContestQuestion(index+1);
      }, 1500);
    }
  };
}

async function submitContestSingle(index, selected, modal) {
  const q = currentContestQuestions[index];
  const correctIndex = parseInt(q.answer);
  const userIndex = parseInt(selected);
  const isCorrect = (userIndex === correctIndex);
  const correctText = q.options[correctIndex];
  const correctLabel = String.fromCharCode(65 + correctIndex) + '. ' + correctText;
  const feedbackDiv = modal.querySelector('#feedbackArea');
  const opts = modal.querySelectorAll('.option-item');

  opts.forEach(opt => {
    const optVal = parseInt(opt.dataset.opt);
    if (optVal === correctIndex) opt.classList.add('correct');
    if (optVal === userIndex && !isCorrect) opt.classList.add('wrong');
  });

  if (isCorrect) {
    feedbackDiv.innerHTML = `<div style="color:#2e5d34; background:#c8e6c9; padding:8px; border-radius:8px;">✅ 回答正确！<br>${q.explanation ? '解析：'+escapeHtml(q.explanation) : ''}</div>`;
    playSound('complete');
  } else {
    feedbackDiv.innerHTML = `<div style="color:#d32f2f; background:#ffcdd2; padding:8px; border-radius:8px;">❌ 回答错误！正确答案是：${escapeHtml(correctLabel)}<br>${q.explanation ? '解析：'+escapeHtml(q.explanation) : ''}</div>`;
    playSound('error');
    await fetchWithAuth('/api/game/wrong-questions/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, userAnswer: userIndex })
    });
  }
  const submitBtn = modal.querySelector('#submitBtn');
  if (submitBtn) submitBtn.disabled = true;
}

async function finalizeContest(modal, timeUsed) {
  const answers = currentContestQuestions.map((q, i) => ({ questionId: q.id, selected: currentContestAnswers[i] }));
  const res = await fetchWithAuth('/api/game/weekly/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contestId: currentContestId, answers, timeUsed, attemptNumber: currentAttemptNumber })
  });
  const result = await res.json();
  alert(`竞赛完成！得分 ${result.score}/${result.total}，获得 ${result.rewardPoints} 积分`);
  addPoints(result.rewardPoints, '每周竞赛');
  await loadModuleStats(); // 刷新卡片状态
  modal.querySelector('.modal-close').click();
}
async function showContestRanking() {
  try {
    // 获取当前周竞赛ID
    const now = new Date();
    const day = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - day + (day === 0 ? -6 : 1));
    weekStart.setHours(0,0,0,0);
    const startStr = weekStart.toISOString().slice(0,10);

    // 先获取竞赛信息
    const contestRes = await fetchWithAuth(`/api/game/weekly/current`);
    if (!contestRes.ok) throw new Error('获取竞赛信息失败');
    const contestData = await contestRes.json();
    const contestId = contestData.contestId;

    // 获取排行榜
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

// ==================== 错题本（实时更新侧边栏） ====================
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
    loadModuleStats(); // 刷新侧边栏错题数
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
  const correctText = w.options[correctIndex];
  const correctLabel = String.fromCharCode(65 + correctIndex) + '. ' + correctText;

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
        loadModuleStats(); // 实时更新侧边栏错题数
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