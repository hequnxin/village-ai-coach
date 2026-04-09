import { fetchWithAuth } from '../utils/api';
import { appState } from './state';
import { escapeHtml, playSound, addPoints, updateTaskProgress, setActiveNavByView } from '../utils/helpers';

let currentFillQuestions = [];
let fillAnswers = [];
let policyQuizQuestions = [];
let policyQuizAnswers = [];
let policyQuizCurrent = 0;
let currentPkRoom = null;
let pkInterval = null;
let contestTimer = null;
let contestQuestions = [];
let contestAnswers = [];
let contestStartTime = null;

export async function renderQuizView() {
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="quiz-view" style="padding:20px; overflow-y:auto; height:100%;">
      <div class="game-card">
        <div class="game-header"><span class="game-title">🎯 政策闯关</span><span class="game-badge">闯关得勋章</span></div>
        <div id="levelList" class="level-list">加载中...</div>
      </div>
      <div class="game-card">
        <div class="game-header"><span class="game-title">🤝 双人PK答题</span><span class="game-badge">邀请好友PK</span></div>
        <div id="pkArea">
          <button id="createPkBtn" class="submit-btn">创建房间</button>
          <div id="joinPkArea" style="margin-top:12px;">
            <input type="text" id="roomCodeInput" placeholder="房间码" style="padding:6px;border-radius:20px;border:1px solid #ccc;">
            <button id="joinPkBtn" class="submit-btn" style="margin-left:8px;">加入</button>
          </div>
          <div id="pkStatus"></div>
        </div>
      </div>
      <div class="game-card">
        <div class="game-header"><span class="game-title">📝 政策填空（每日5题）</span><span class="game-badge">每日一填</span></div>
        <div><button id="getFillDailyBtn" class="submit-btn">开始今日填空</button><div id="fillQuestionsContainer"></div></div>
      </div>
      <div class="game-card">
        <div class="game-header"><span class="game-title">❌ 错题闯关</span><span class="game-badge">清零错题本</span></div>
        <div><button id="startWrongClearBtn" class="submit-btn">开始错题闯关</button><div id="wrongList"></div></div>
      </div>
      <div class="game-card">
        <div class="game-header"><span class="game-title">🏆 每周竞赛</span><span class="game-badge">赢取专属头像框</span></div>
        <div><button id="startContestBtn" class="submit-btn">参加本周竞赛</button><div id="contestRank"></div></div>
      </div>
      <div class="game-card">
        <div class="game-header"><span class="game-title">🎫 政策刮刮乐</span><span class="game-badge">每日3次机会</span></div>
        <div><button id="getScratchBtn" class="submit-btn">刮一张</button><div id="scratchCard"></div></div>
      </div>
      <div class="game-card">
        <div class="game-header"><span class="game-title">📖 政策知多少</span><span class="game-badge">每日一测</span></div>
        <div><button id="startPolicyQuizBtn" class="submit-btn">开始答题</button><div id="policyQuizQuestions"></div></div>
      </div>
    </div>
  `;
  await loadLevels();
  document.getElementById('createPkBtn').onclick = createPkRoom;
  document.getElementById('joinPkBtn').onclick = joinPkRoom;
  document.getElementById('getFillDailyBtn').onclick = getFillDailyQuestions;
  document.getElementById('startWrongClearBtn').onclick = startWrongClear;
  document.getElementById('startContestBtn').onclick = startWeeklyContest;
  document.getElementById('getScratchBtn').onclick = getScratchCard;
  document.getElementById('startPolicyQuizBtn').onclick = startPolicyQuiz;
  setActiveNavByView('quiz');
}

// ==================== 政策闯关 ====================
async function loadLevels() {
  try {
    const res = await fetchWithAuth('/api/quiz/levels');
    const levels = await res.json();
    const container = document.getElementById('levelList');
    if (!container) return;
    container.innerHTML = '';
    for (let lvl of levels) {
      const card = document.createElement('div');
      card.className = `level-card ${lvl.completed ? 'completed' : ''}`;
      card.innerHTML = `<div class="level-name">${escapeHtml(lvl.name)}</div><div class="level-status">${lvl.completed ? '✅ 已通关' : '🔒 未解锁'}</div>`;
      if (!lvl.completed) card.onclick = () => startLevel(lvl.id);
      else card.style.cursor = 'default';
      container.appendChild(card);
    }
  } catch(e) { console.error(e); }
}

async function startLevel(levelId) {
  try {
    const res = await fetchWithAuth(`/api/quiz/level/${levelId}`);
    const questions = await res.json();
    if (!questions.length) return alert('关卡无题目');
    let currentIndex = 0;
    let answers = [];
    let userSelections = [];
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';

    const renderQuestion = () => {
      const q = questions[currentIndex];
      modal.innerHTML = `
        <div class="modal-content" style="width:500px;">
          <button class="modal-close">&times;</button>
          <div class="question-text">${escapeHtml(q.question)}</div>
          <div class="options-list" id="optionsList">
            ${q.options.map((opt, idx) => `
              <div class="option-item" data-opt="${idx}">
                <span class="option-prefix">${String.fromCharCode(65+idx)}.</span>
                ${escapeHtml(opt)}
              </div>
            `).join('')}
          </div>
          <div id="explanationArea" style="margin-top:12px; padding:8px; border-radius:8px; display:none;"></div>
          <div style="margin-top:20px; display:flex; justify-content:space-between;">
            <button id="prevBtn" class="summary-btn" ${currentIndex===0?'disabled':''}>上一题</button>
            <button id="nextBtn" class="submit-btn">${currentIndex===questions.length-1?'提交':'下一题'}</button>
          </div>
        </div>
      `;

      const closeBtn = modal.querySelector('.modal-close');
      closeBtn.onclick = () => document.body.removeChild(modal);
      modal.onclick = (e) => { if(e.target===modal) document.body.removeChild(modal); };

      const opts = modal.querySelectorAll('.option-item');
      const explanationDiv = modal.querySelector('#explanationArea');

      if (userSelections[currentIndex] !== undefined) {
        const selectedIdx = userSelections[currentIndex];
        const isCorrect = (selectedIdx === q.answer);
        opts.forEach(opt => {
          const idx = parseInt(opt.dataset.opt);
          if (idx === selectedIdx) opt.classList.add(isCorrect ? 'correct' : 'wrong');
          if (idx === q.answer && !isCorrect) opt.classList.add('correct-answer');
        });
        if (explanationDiv) {
          explanationDiv.style.display = 'block';
          explanationDiv.innerHTML = `<strong>${isCorrect ? '✅ 回答正确' : '❌ 回答错误'}</strong><br>${escapeHtml(q.explanation || '无解析')}`;
          explanationDiv.style.backgroundColor = isCorrect ? '#d4edda' : '#f8d7da';
        }
      }

      opts.forEach(opt => {
        opt.onclick = async () => {
          const selected = parseInt(opt.dataset.opt);
          const isCorrect = (selected === q.answer);
          userSelections[currentIndex] = selected;
          answers[currentIndex] = { questionId: q.id, selected: selected, isCorrect: isCorrect };
          opts.forEach(o => o.classList.remove('correct', 'wrong', 'correct-answer'));
          opt.classList.add(isCorrect ? 'correct' : 'wrong');
          if (!isCorrect) {
            opts.forEach(o => { if (parseInt(o.dataset.opt) === q.answer) o.classList.add('correct-answer'); });
          }
          if (explanationDiv) {
            explanationDiv.style.display = 'block';
            explanationDiv.innerHTML = `<strong>${isCorrect ? '✅ 回答正确' : '❌ 回答错误'}</strong><br>${escapeHtml(q.explanation || '无解析')}`;
            explanationDiv.style.backgroundColor = isCorrect ? '#d4edda' : '#f8d7da';
          }
          if (!isCorrect) {
            try {
              await fetchWithAuth('/api/quiz/wrong-questions/record', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ questionId: q.id, userAnswer: selected })
              });
            } catch(e) { console.warn('记录错题失败', e); }
          }
        };
      });

      const prevBtn = modal.querySelector('#prevBtn');
      const nextBtn = modal.querySelector('#nextBtn');
      if (prevBtn) prevBtn.onclick = () => { if(currentIndex>0) { currentIndex--; renderQuestion(); } };
      nextBtn.onclick = async () => {
        if (userSelections[currentIndex] === undefined) { alert('请先回答本题'); return; }
        if (currentIndex === questions.length-1) {
          const submitRes = await fetchWithAuth('/api/quiz/level/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ levelId, answers: answers.map(a => ({ questionId: a.questionId, selected: a.selected })) })
          });
          const result = await submitRes.json();
          document.body.removeChild(modal);
          if (result.passed) {
            alert(`闯关成功！获得50积分`);
            addPoints(50, '政策闯关通关');
            updateTaskProgress('policyLevel', 1);
            loadLevels();
          } else {
            let explanationMsg = `闯关失败！答对${result.correct}/${result.total}题，以下为错题解析：\n`;
            for (let i = 0; i < questions.length; i++) {
              if (userSelections[i] !== questions[i].answer) {
                const correctOption = String.fromCharCode(65 + questions[i].answer);
                explanationMsg += `\n${i+1}. ${questions[i].question}\n 正确答案：${correctOption}. ${questions[i].options[questions[i].answer]}\n 解析：${questions[i].explanation || '无'}\n`;
              }
            }
            alert(explanationMsg);
          }
        } else {
          currentIndex++;
          renderQuestion();
        }
      };
    };
    renderQuestion();
    document.body.appendChild(modal);
  } catch(e) { alert('加载关卡失败'); }
}

// ==================== PK房间 ====================
async function createPkRoom() {
  try {
    const res = await fetchWithAuth('/api/quiz/pk/create', { method:'POST' });
    const data = await res.json();
    currentPkRoom = data.roomId;
    alert(`房间创建成功！房间码：${data.roomCode}，等待对手加入...`);
    document.getElementById('pkStatus').innerHTML = `<div class="pk-status">等待对手加入，房间码：${data.roomCode}</div>`;
    if (pkInterval) clearInterval(pkInterval);
    pkInterval = setInterval(async () => {
      const statusRes = await fetchWithAuth(`/api/quiz/pk/status/${currentPkRoom}`);
      const status = await statusRes.json();
      if (status.status === 'playing') {
        clearInterval(pkInterval);
        const questionsRes = await fetchWithAuth('/api/quiz/questions/batch', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: data.questions })
        });
        const questions = await questionsRes.json();
        startPkGame(currentPkRoom, questions);
      } else if (status.status === 'finished') {
        clearInterval(pkInterval);
        document.getElementById('pkStatus').innerHTML = `<div class="pk-status">PK结束，${status.winnerId ? '胜者已出' : '平局'}</div>`;
      }
    }, 2000);
  } catch(e) { alert('创建失败'); }
}

async function joinPkRoom() {
  const roomCode = document.getElementById('roomCodeInput').value.trim();
  if (!roomCode) return alert('请输入房间码');
  try {
    const res = await fetchWithAuth('/api/quiz/pk/join', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ roomCode })
    });
    const data = await res.json();
    currentPkRoom = data.roomId;
    alert('加入成功，开始PK！');
    const questionsRes = await fetchWithAuth('/api/quiz/questions/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: data.questions })
    });
    const questions = await questionsRes.json();
    startPkGame(currentPkRoom, questions);
  } catch(e) { alert('加入失败'); }
}

async function startPkGame(roomId, questions) {
  let currentIndex = 0;
  let answers = new Array(questions.length).fill(null);
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  const renderQuestion = () => {
    const q = questions[currentIndex];
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
          <button id="pkPrevBtn" class="summary-btn" ${currentIndex===0?'disabled':''}>上一题</button>
          <button id="pkNextBtn" class="submit-btn">${currentIndex===questions.length-1?'提交':'下一题'}</button>
        </div>
      </div>
    `;
    const closeBtn = modal.querySelector('.modal-close');
    closeBtn.onclick = () => document.body.removeChild(modal);
    modal.onclick = (e) => { if(e.target===modal) document.body.removeChild(modal); };
    const opts = modal.querySelectorAll('.option-item');
    opts.forEach(opt => {
      opt.onclick = () => {
        const selected = parseInt(opt.dataset.opt);
        answers[currentIndex] = selected;
        opts.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
      };
    });
    const prevBtn = modal.querySelector('#pkPrevBtn');
    const nextBtn = modal.querySelector('#pkNextBtn');
    if (prevBtn) prevBtn.onclick = () => { if(currentIndex>0) { currentIndex--; renderQuestion(); } };
    nextBtn.onclick = async () => {
      if (answers[currentIndex] === null) { alert('请选择答案'); return; }
      if (currentIndex === questions.length-1) {
        await fetchWithAuth('/api/quiz/pk/submit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, answers: answers.map((a,i) => ({ questionId: questions[i].id, selected: a })) })
        });
        document.body.removeChild(modal);
        const interval = setInterval(async () => {
          const statusRes = await fetchWithAuth(`/api/quiz/pk/status/${roomId}`);
          const status = await statusRes.json();
          if (status.finished) {
            clearInterval(interval);
            const userId = localStorage.getItem('userId') || '';
            alert(status.winnerId ? (status.winnerId === userId ? '你赢了！' : '对手赢了') : '平局');
          }
        }, 2000);
      } else {
        currentIndex++;
        renderQuestion();
      }
    };
  };
  renderQuestion();
  document.body.appendChild(modal);
}

// ==================== 填空每日5题 ====================
async function getFillDailyQuestions() {
  try {
    const res = await fetchWithAuth('/api/quiz/fill-daily');
    const data = await res.json();
    if (!data.questions || data.questions.length === 0) { alert('暂无题目'); return; }
    currentFillQuestions = data.questions;
    fillAnswers = new Array(currentFillQuestions.length).fill('');
    renderFillQuestions();
  } catch(e) { alert('获取填空题目失败'); }
}

function renderFillQuestions() {
  const container = document.getElementById('fillQuestionsContainer');
  if (!container) return;
  let html = '<div class="fill-daily-container">';
  currentFillQuestions.forEach((q, idx) => {
    html += `
      <div class="fill-question-item" style="margin-bottom:20px; padding:12px; background:#f9f9f9; border-radius:12px;">
        <div class="fill-sentence">${escapeHtml(q.sentence)}</div>
        <input type="text" id="fill_${idx}" class="fill-input" placeholder="填写答案" style="margin-top:8px; width:100%;">
        <div class="fill-hint" style="font-size:0.8rem; color:#999; margin-top:4px;">💡 ${q.hint || '根据上下文填空'}</div>
      </div>
    `;
  });
  html += `<button id="submitFillDailyBtn" class="submit-btn">提交所有答案</button></div>`;
  container.innerHTML = html;
  for (let i = 0; i < currentFillQuestions.length; i++) {
    const input = document.getElementById(`fill_${i}`);
    if (input) input.value = fillAnswers[i];
    input.addEventListener('input', (e) => { fillAnswers[i] = e.target.value; });
  }
  document.getElementById('submitFillDailyBtn').onclick = submitFillDaily;
}

async function submitFillDaily() {
  const answers = fillAnswers.map(a => a.trim());
  try {
    const res = await fetchWithAuth('/api/quiz/fill-daily/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers })
    });
    const result = await res.json();
    let correctCount = result.correctCount;
    let reward = correctCount * 5;
    alert(`填空完成！答对${correctCount}/${currentFillQuestions.length}题，获得${reward}积分`);
    addPoints(reward, '填空每日练');
    updateTaskProgress('quiz', 1);
    document.getElementById('fillQuestionsContainer').innerHTML = `<div style="text-align:center;padding:20px;">🎉 获得 ${reward} 积分 🎉</div>`;
    playSound('complete');
  } catch(e) { alert('提交失败'); }
}

// ==================== 政策知多少 ====================
async function startPolicyQuiz() {
  try {
    const res = await fetchWithAuth('/api/quiz/daily');
    const data = await res.json();
    if (!data.questions || data.questions.length === 0) { alert('暂无题目'); return; }
    policyQuizQuestions = data.questions;
    policyQuizAnswers = new Array(policyQuizQuestions.length).fill(null);
    policyQuizCurrent = 0;
    showPolicyQuizQuestion();
  } catch(e) { alert('加载题目失败'); }
}

function showPolicyQuizQuestion() {
  const q = policyQuizQuestions[policyQuizCurrent];
  const container = document.getElementById('policyQuizQuestions');
  if (!container) return;
  container.innerHTML = `
    <div class="question-container">
      <div class="question-text">${escapeHtml(q.question)}</div>
      <div class="options-list">
        ${q.options.map((opt, idx) => `
          <div class="option-item" data-opt="${idx}">
            <span class="option-prefix">${String.fromCharCode(65+idx)}.</span>
            ${escapeHtml(opt)}
          </div>
        `).join('')}
      </div>
      <div class="submit-answer">
        <button id="policyQuizNextBtn" class="submit-btn">${policyQuizCurrent === policyQuizQuestions.length-1 ? '提交' : '下一题'}</button>
      </div>
    </div>
  `;
  const opts = container.querySelectorAll('.option-item');
  opts.forEach(opt => {
    opt.onclick = () => {
      const selected = parseInt(opt.dataset.opt);
      policyQuizAnswers[policyQuizCurrent] = selected;
      opts.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    };
  });
  const nextBtn = document.getElementById('policyQuizNextBtn');
  nextBtn.onclick = async () => {
    if (policyQuizAnswers[policyQuizCurrent] === undefined) { alert('请选择答案'); return; }
    if (policyQuizCurrent === policyQuizQuestions.length-1) {
      let correctCount = 0;
      let wrongDetails = [];
      for (let i = 0; i < policyQuizQuestions.length; i++) {
        const qq = policyQuizQuestions[i];
        if (qq.answer === policyQuizAnswers[i]) correctCount++;
        else {
          wrongDetails.push({
            question: qq.question,
            correctOption: String.fromCharCode(65 + qq.answer),
            correctAnswer: qq.options[qq.answer],
            explanation: qq.explanation || '无解析'
          });
        }
      }
      const reward = correctCount * 10;
      let message = `答题结束！答对${correctCount}/${policyQuizQuestions.length}题，获得${reward}积分`;
      if (wrongDetails.length > 0) {
        message += '\n\n错题解析：\n';
        wrongDetails.forEach((w, idx) => {
          message += `\n${idx+1}. ${w.question}\n 正确答案：${w.correctOption}. ${w.correctAnswer}\n 解析：${w.explanation}\n`;
        });
      }
      alert(message);
      addPoints(reward, '政策知多少');
      updateTaskProgress('quiz', 1);
      const container = document.getElementById('policyQuizQuestions');
      container.innerHTML = `<div style="text-align:center;padding:20px;">🎉 获得 ${reward} 积分 🎉</div>`;
      playSound('complete');
    } else {
      policyQuizCurrent++;
      showPolicyQuizQuestion();
    }
  };
}

// ==================== 错题闯关 ====================
let wrongQuestionsList = [];
let currentWrongIndex = 0;

async function startWrongClear() {
  try {
    const res = await fetchWithAuth('/api/quiz/wrong-questions/list');
    const wrongs = await res.json();
    if (wrongs.length === 0) { alert('暂无错题'); return; }
    wrongQuestionsList = wrongs;
    currentWrongIndex = 0;
    showWrongQuestion();
  } catch(e) { alert('加载错题失败'); }
}

function showWrongQuestion() {
  if (currentWrongIndex >= wrongQuestionsList.length) {
    alert('恭喜！所有错题已清零！');
    renderQuizView();
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
        ${JSON.parse(w.options).map((opt, idx) => `
          <div class="option-item" data-opt="${idx}">
            <span class="option-prefix">${String.fromCharCode(65+idx)}.</span>
            ${escapeHtml(opt)}
          </div>
        `).join('')}
      </div>
      <div style="margin-top:20px;"><button id="submitWrongBtn" class="submit-btn">提交答案</button></div>
    </div>
  `;
  document.body.appendChild(modal);
  const closeBtn = modal.querySelector('.modal-close');
  closeBtn.onclick = () => document.body.removeChild(modal);
  modal.onclick = e => { if (e.target === modal) document.body.removeChild(modal); };
  let selected = null;
  modal.querySelectorAll('.option-item').forEach(opt => {
    opt.onclick = () => {
      modal.querySelectorAll('.option-item').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selected = parseInt(opt.dataset.opt);
    };
  });
  const submitBtn = modal.querySelector('#submitWrongBtn');
  submitBtn.onclick = async () => {
    if (selected === null) { alert('请选择答案'); return; }
    try {
      const res = await fetchWithAuth('/api/quiz/wrong-questions/clear', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [{ questionId: w.question_id, selected }] })
      });
      const result = await res.json();
      if (result.cleared) {
        alert('答对！获得10积分');
        addPoints(10, '错题闯关');
        document.body.removeChild(modal);
        currentWrongIndex++;
        showWrongQuestion();
      } else {
        alert('答错了，闯关结束！');
        document.body.removeChild(modal);
      }
    } catch(e) { alert('提交失败'); }
  };
}

// ==================== 每周竞赛 ====================
async function startWeeklyContest() {
  try {
    const res = await fetchWithAuth('/api/quiz/weekly/current');
    if (!res.ok) throw new Error('加载竞赛失败');
    const data = await res.json();
    contestQuestions = data.questions;
    contestAnswers = new Array(contestQuestions.length).fill(null);
    contestStartTime = Date.now();
    let current = 0;
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    const renderQuestion = () => {
      const q = contestQuestions[current];
      modal.innerHTML = `
        <div class="modal-content" style="width:500px;">
          <button class="modal-close">&times;</button>
          <div class="contest-header" style="background:#ff9800;color:white;"><span>每周竞赛</span><span class="contest-timer" id="contestTimer">00:00</span></div>
          <div class="question-text">${escapeHtml(q.question)}</div>
          <div class="options-list">
            ${q.options.map((opt, idx) => `
              <div class="option-item" data-opt="${idx}">
                <span class="option-prefix">${String.fromCharCode(65+idx)}.</span>
                ${escapeHtml(opt)}
              </div>
            `).join('')}
          </div>
          <div style="margin-top:20px;"><button id="nextContestBtn" class="submit-btn">${current===contestQuestions.length-1?'提交':'下一题'}</button></div>
        </div>
      `;
      const closeBtn = modal.querySelector('.modal-close');
      closeBtn.onclick = () => { if(contestTimer) clearInterval(contestTimer); document.body.removeChild(modal); };
      modal.onclick = (e) => { if(e.target===modal) { if(contestTimer) clearInterval(contestTimer); document.body.removeChild(modal); } };
      const opts = modal.querySelectorAll('.option-item');
      opts.forEach(opt => {
        opt.onclick = () => {
          const selected = parseInt(opt.dataset.opt);
          contestAnswers[current] = selected;
          opts.forEach(o => o.classList.remove('selected'));
          opt.classList.add('selected');
        };
      });
      const nextBtn = modal.querySelector('#nextContestBtn');
      nextBtn.onclick = async () => {
        if (contestAnswers[current] === undefined) { alert('请选择答案'); return; }
        if (current === contestQuestions.length-1) {
          clearInterval(contestTimer);
          const timeUsed = Math.floor((Date.now() - contestStartTime) / 1000);
          const submitRes = await fetchWithAuth('/api/quiz/weekly/submit', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ contestId: data.contestId, answers: contestQuestions.map((q,i) => ({ questionId: q.id, selected: contestAnswers[i] })), timeUsed })
          });
          const result = await submitRes.json();
          document.body.removeChild(modal);
          alert(`竞赛完成！得分${result.score}/${contestQuestions.length}，获得${result.rewardPoints}积分`);
          addPoints(result.rewardPoints, '每周竞赛');
          const rankRes = await fetchWithAuth(`/api/quiz/weekly/rank/${data.contestId}`);
          const ranks = await rankRes.json();
          let rankHtml = '<h4>排行榜</h4>';
          ranks.forEach((r, idx) => { rankHtml += `<div class="rank-item"><span class="rank-number">${idx+1}</span><span>${r.username}</span><span>${r.score}分</span><span>${r.time_used}秒</span></div>`; });
          document.getElementById('contestRank').innerHTML = rankHtml;
        } else {
          current++;
          renderQuestion();
        }
      };
    };
    if (contestTimer) clearInterval(contestTimer);
    contestTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - contestStartTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      const timerSpan = document.getElementById('contestTimer');
      if (timerSpan) timerSpan.textContent = `${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;
    }, 1000);
    renderQuestion();
    document.body.appendChild(modal);
  } catch(e) { alert(e.message); }
}

// ==================== 刮刮乐 ====================
async function getScratchCard() {
  try {
    const res = await fetchWithAuth('/api/quiz/scratch/generate');
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `请求失败 (${res.status})`);
    }
    const card = await res.json();
    const container = document.getElementById('scratchCard');
    container.innerHTML = `<div class="scratch-card" id="scratchSurface"><div class="scratch-cover">🎫 点击刮开涂层 🎫</div></div>`;
    const surface = document.getElementById('scratchSurface');
    surface.onclick = async () => {
      surface.innerHTML = `<div class="scratch-question"><div class="question-text">${escapeHtml(card.question)}</div><div class="scratch-options">${card.options.map((opt, idx) => `<div class="scratch-option" data-opt="${idx}">${String.fromCharCode(65+idx)}. ${escapeHtml(opt)}</div>`).join('')}</div></div>`;
      const opts = surface.querySelectorAll('.scratch-option');
      opts.forEach(opt => {
        opt.onclick = async () => {
          const selected = parseInt(opt.dataset.opt);
          const submitRes = await fetchWithAuth('/api/quiz/scratch/submit', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ cardId: card.cardId, selected })
          });
          const result = await submitRes.json();
          if (result.correct) {
            surface.innerHTML = `<div class="scratch-reward">🎉 刮中奖励！获得 ${result.rewardPoints} 积分 🎉</div>`;
            addPoints(result.rewardPoints, '刮刮乐');
          } else {
            surface.innerHTML = `<div class="scratch-reward">😢 很遗憾，答案错误，下次再试试吧</div>`;
          }
        };
      });
    };
  } catch(e) { alert(e.message); }
}