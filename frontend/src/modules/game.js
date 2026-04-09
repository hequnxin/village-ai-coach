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

let currentDailyQuestions = [];
let currentDailyAnswers = [];
let currentDailyQuizId = null;

let currentFillQuestions = [];
let currentFillAnswers = [];

let currentContestId = null;
let currentContestQuestions = [];
let currentContestAnswers = [];
let contestStartTime = null;
let contestTimer = null;

let wrongQuestionsList = [];
let currentWrongIndex = 0;

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
                    <div class="module-preview" id="themesPreview">加载中...</div>
                    <button class="module-btn" id="openLevelsBtn">进入闯关 →</button>
                </div>

                <div class="game-module module-daily">
                    <div class="module-icon">📖</div>
                    <div class="module-title">每日一练</div>
                    <div class="module-desc">每日更新，巩固知识</div>
                    <div class="module-stats" id="dailyStats">今日未开始</div>
                    <button class="module-btn" id="startDailyBtn">开始练习 →</button>
                </div>

                <div class="game-module module-fill">
                    <div class="module-icon">✏️</div>
                    <div class="module-title">填空每日练</div>
                    <div class="module-desc">每日5题，强化记忆</div>
                    <div class="module-stats" id="fillStats">今日未开始</div>
                    <button class="module-btn" id="startFillDailyBtn">开始填空 →</button>
                </div>

                <div class="game-module module-contest">
                    <div class="module-icon">🏅</div>
                    <div class="module-title">每周竞赛</div>
                    <div class="module-desc">限时挑战，冲击榜单</div>
                    <div class="module-stats" id="contestStats">本周未参加</div>
                    <button class="module-btn" id="startContestBtn">参加竞赛 →</button>
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
    document.getElementById('startFillDailyBtn').onclick = startFillDaily;
    document.getElementById('startContestBtn').onclick = startWeeklyContest;
    document.getElementById('startWrongClearBtn').onclick = startWrongClear;
    document.getElementById('getScratchBtn').onclick = getScratchCard;

    setActiveNavByView('game');
}

async function loadModuleStats() {
    try {
        const dailyRes = await fetchWithAuth('/api/game/daily/status');
        const dailyData = await dailyRes.json();
        const dailyStats = document.getElementById('dailyStats');
        if (dailyStats) {
            if (dailyData.completed) dailyStats.innerHTML = `今日已完成 (${dailyData.score}/${dailyData.total})`;
            else dailyStats.innerHTML = '今日未开始';
        }
    } catch(e) {}
    try {
        const fillRes = await fetchWithAuth('/api/game/fill-daily/status');
        const fillData = await fillRes.json();
        const fillStats = document.getElementById('fillStats');
        if (fillStats) {
            if (fillData.completed) fillStats.innerHTML = `今日已完成 (${fillData.score}/5)`;
            else fillStats.innerHTML = '今日未开始';
        }
    } catch(e) {}
    try {
        const wrongRes = await fetchWithAuth('/api/game/wrong-questions');
        const wrongs = await wrongRes.json();
        const wrongStats = document.getElementById('wrongStats');
        if (wrongStats) wrongStats.innerHTML = `共有 ${wrongs.length} 道错题`;
    } catch(e) {}
    try {
        const contestRes = await fetchWithAuth('/api/game/weekly/status');
        const contestData = await contestRes.json();
        const contestStats = document.getElementById('contestStats');
        if (contestStats) {
            if (contestData.participated) contestStats.innerHTML = `已参加 (${contestData.score}分)`;
            else contestStats.innerHTML = '本周未参加';
        }
    } catch(e) {}
}

async function showLevelsModal() {
    const modal = document.getElementById('levelsModal');
    const container = document.getElementById('themesDetailContainer');
    if (!container) return;
    container.innerHTML = '<div>加载中...</div>';
    modal.style.display = 'flex';
    const res = await fetchWithAuth('/api/game/themes');
    const themes = await res.json();
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
                    ${level.completed ? '<div class="level-badge">✅ 已通关</div>' : (locked ? `<div class="level-badge">🔒 需${level.unlock_points}分</div>` : '<div class="level-badge">⚡ 可挑战</div>')}
                </div>
            `;
        }
        html += `</div></div>`;
    }
    container.innerHTML = html;
    document.querySelectorAll('.level-card:not(.locked)').forEach(card => {
        card.addEventListener('click', () => {
            const levelId = card.dataset.levelId;
            const levelName = card.querySelector('.level-name')?.textContent || '关卡';
            modal.style.display = 'none';
            startLevel(levelId, levelName);
        });
    });
    modal.querySelector('.close-modal').onclick = () => { modal.style.display = 'none'; };
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
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
    const closeBtn = modal.querySelector('.modal-close');
    closeBtn.onclick = () => document.body.removeChild(modal);
    modal.onclick = (e) => { if(e.target===modal) document.body.removeChild(modal); };
    const opts = modal.querySelectorAll('.option-item');
    if (currentLevelAnswers[currentLevelIndex] !== undefined) {
        const selectedIdx = currentLevelAnswers[currentLevelIndex];
        opts.forEach(opt => {
            const idx = parseInt(opt.dataset.opt);
            if (idx === selectedIdx) opt.classList.add('selected');
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
    if (prevBtn) prevBtn.onclick = () => { if(currentLevelIndex>0) { currentLevelIndex--; showLevelQuestion(); } };
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
            document.body.removeChild(modal);
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
            showLevelQuestion();
        }
    };
}

async function startDailyQuiz() {
    try {
        const res = await fetchWithAuth('/api/game/daily');
        const data = await res.json();
        if (data.completed) {
            alert(`今日已完成，得分 ${data.score}/${data.questions.length}`);
            return;
        }
        currentDailyQuestions = data.questions;
        currentDailyAnswers = new Array(currentDailyQuestions.length).fill(null);
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
                <button id="prevBtn" class="summary-btn" ${index===0?'disabled':''}>上一题</button>
                <button id="nextBtn" class="submit-btn">${index===currentDailyQuestions.length-1?'提交':'下一题'}</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    const closeBtn = modal.querySelector('.modal-close');
    closeBtn.onclick = () => document.body.removeChild(modal);
    modal.onclick = (e) => { if(e.target===modal) document.body.removeChild(modal); };
    const opts = modal.querySelectorAll('.option-item');
    if (currentDailyAnswers[index] !== undefined) {
        opts.forEach(opt => { if(parseInt(opt.dataset.opt) === currentDailyAnswers[index]) opt.classList.add('selected'); });
    }
    opts.forEach(opt => {
        opt.onclick = () => {
            const selected = parseInt(opt.dataset.opt);
            currentDailyAnswers[index] = selected;
            opts.forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
        };
    });
    const prevBtn = modal.querySelector('#prevBtn');
    const nextBtn = modal.querySelector('#nextBtn');
    if (prevBtn) prevBtn.onclick = () => { if(index>0) showDailyQuestion(index-1); };
    nextBtn.onclick = async () => {
        if (currentDailyAnswers[index] === undefined) {
            alert('请选择答案');
            return;
        }
        if (index === currentDailyQuestions.length-1) {
            const answers = currentDailyQuestions.map((q, i) => ({ questionId: q.id, selected: currentDailyAnswers[i] }));
            const res = await fetchWithAuth('/api/game/daily/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ quizId: currentDailyQuizId, answers })
            });
            const result = await res.json();
            document.body.removeChild(modal);
            alert(`练习完成！得分 ${result.score}/${result.total}，获得 ${result.rewardPoints} 积分`);
            addPoints(result.rewardPoints, '每日一练');
            updateTaskProgress('quiz', 1);
            loadModuleStats();
        } else {
            showDailyQuestion(index+1);
        }
    };
}

async function startFillDaily() {
    try {
        const res = await fetchWithAuth('/api/game/fill-daily');
        const data = await res.json();
        if (data.completed) {
            alert(`今日填空已完成，得分 ${data.score}/5`);
            return;
        }
        currentFillQuestions = data.questions;
        currentFillAnswers = new Array(currentFillQuestions.length).fill('');
        showFillQuestion(0);
    } catch(e) {
        alert('加载填空题目失败');
    }
}

function showFillQuestion(index) {
    const q = currentFillQuestions[index];
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:500px;">
            <button class="modal-close">&times;</button>
            <div class="fill-sentence" style="font-size:1.1rem; margin-bottom:16px;">${escapeHtml(q.sentence)}</div>
            <div class="fill-hint" style="color:#666; margin-bottom:12px;">💡 ${escapeHtml(q.hint || '根据上下文填空')}</div>
            <input type="text" id="fillAnswer" class="fill-input" placeholder="填写答案" style="width:100%; padding:8px;">
            <div style="margin-top:20px; display:flex; justify-content:space-between;">
                <button id="prevBtn" class="summary-btn" ${index===0?'disabled':''}>上一题</button>
                <button id="nextBtn" class="submit-btn">${index===currentFillQuestions.length-1?'提交':'下一题'}</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    const closeBtn = modal.querySelector('.modal-close');
    closeBtn.onclick = () => document.body.removeChild(modal);
    modal.onclick = (e) => { if(e.target===modal) document.body.removeChild(modal); };
    const input = modal.querySelector('#fillAnswer');
    if (currentFillAnswers[index]) input.value = currentFillAnswers[index];
    input.oninput = (e) => { currentFillAnswers[index] = e.target.value; };
    const prevBtn = modal.querySelector('#prevBtn');
    const nextBtn = modal.querySelector('#nextBtn');
    if (prevBtn) prevBtn.onclick = () => { if(index>0) showFillQuestion(index-1); };
    nextBtn.onclick = async () => {
        if (!currentFillAnswers[index]?.trim()) {
            alert('请填写答案');
            return;
        }
        if (index === currentFillQuestions.length-1) {
            const res = await fetchWithAuth('/api/game/fill-daily/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ answers: currentFillAnswers })
            });
            const result = await res.json();
            document.body.removeChild(modal);
            alert(`填空完成！答对 ${result.correctCount}/${result.total}，获得 ${result.rewardPoints} 积分`);
            addPoints(result.rewardPoints, '填空每日练');
            updateTaskProgress('quiz', 1);
            loadModuleStats();
        } else {
            showFillQuestion(index+1);
        }
    };
}

async function startWeeklyContest() {
    try {
        const res = await fetchWithAuth('/api/game/weekly/current');
        const data = await res.json();
        currentContestId = data.contestId;
        currentContestQuestions = data.questions;
        currentContestAnswers = new Array(currentContestQuestions.length).fill(null);
        contestStartTime = Date.now();
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
                <span>每周竞赛</span>
                <span id="contestTimer" style="font-family:monospace;">00:00</span>
            </div>
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
                <button id="prevBtn" class="summary-btn" ${index===0?'disabled':''}>上一题</button>
                <button id="nextBtn" class="submit-btn">${index===currentContestQuestions.length-1?'提交':'下一题'}</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    if (contestTimer) clearInterval(contestTimer);
    contestTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - contestStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        const timerSpan = document.getElementById('contestTimer');
        if (timerSpan) timerSpan.textContent = `${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;
    }, 1000);
    const closeBtn = modal.querySelector('.modal-close');
    closeBtn.onclick = () => { clearInterval(contestTimer); document.body.removeChild(modal); };
    modal.onclick = (e) => { if(e.target===modal) { clearInterval(contestTimer); document.body.removeChild(modal); } };
    const opts = modal.querySelectorAll('.option-item');
    if (currentContestAnswers[index] !== undefined) {
        opts.forEach(opt => { if(parseInt(opt.dataset.opt) === currentContestAnswers[index]) opt.classList.add('selected'); });
    }
    opts.forEach(opt => {
        opt.onclick = () => {
            const selected = parseInt(opt.dataset.opt);
            currentContestAnswers[index] = selected;
            opts.forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
        };
    });
    const prevBtn = modal.querySelector('#prevBtn');
    const nextBtn = modal.querySelector('#nextBtn');
    if (prevBtn) prevBtn.onclick = () => { if(index>0) showContestQuestion(index-1); };
    nextBtn.onclick = async () => {
        if (currentContestAnswers[index] === undefined) {
            alert('请选择答案');
            return;
        }
        if (index === currentContestQuestions.length-1) {
            clearInterval(contestTimer);
            const timeUsed = Math.floor((Date.now() - contestStartTime) / 1000);
            const answers = currentContestQuestions.map((q, i) => ({ questionId: q.id, selected: currentContestAnswers[i] }));
            const res = await fetchWithAuth('/api/game/weekly/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contestId: currentContestId, answers, timeUsed })
            });
            const result = await res.json();
            document.body.removeChild(modal);
            alert(`竞赛完成！得分 ${result.score}/${result.total}，获得 ${result.rewardPoints} 积分`);
            addPoints(result.rewardPoints, '每周竞赛');
            loadModuleStats();
        } else {
            showContestQuestion(index+1);
        }
    };
}

async function startWrongClear() {
    const res = await fetchWithAuth('/api/game/wrong-questions');
    wrongQuestionsList = await res.json();
    if (wrongQuestionsList.length === 0) {
        alert('暂无错题');
        return;
    }
    currentWrongIndex = 0;
    showWrongQuestion();
}

function showWrongQuestion() {
    if (currentWrongIndex >= wrongQuestionsList.length) {
        alert('恭喜！所有错题已清零！');
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
            <div style="margin-top:20px;"><button id="submitWrongBtn" class="submit-btn">提交答案</button></div>
        </div>
    `;
    document.body.appendChild(modal);
    const closeBtn = modal.querySelector('.modal-close');
    closeBtn.onclick = () => document.body.removeChild(modal);
    modal.onclick = (e) => { if(e.target===modal) document.body.removeChild(modal); };
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
        const res = await fetchWithAuth('/api/game/wrong-questions/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answers: [{ questionId: w.question_id, selected }] })
        });
        const result = await res.json();
        document.body.removeChild(modal);
        if (result.clearedCount > 0) {
            alert(`答对了！获得 ${result.rewardPoints} 积分`);
            addPoints(result.rewardPoints, '错题闯关');
            currentWrongIndex++;
            showWrongQuestion();
        } else {
            alert('答错了，闯关结束！');
        }
    };
}

async function updateScratchRemaining() {
    const today = new Date().toISOString().slice(0,10);
    let count = parseInt(localStorage.getItem(`scratch_${today}`)) || 0;
    scratchRemaining = Math.max(0, 5 - count);
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
    const container = document.getElementById('scratchCard');
    if (!container) return;
    container.innerHTML = `
        <div class="scratch-card" id="scratchSurface">
            <div class="scratch-cover">🎫 点击刮开涂层 🎫</div>
        </div>
        <div class="scratch-remaining" style="margin-top:8px;"></div>
        <button id="scratchAgainBtn" class="submit-btn" style="margin-top:12px; display:none;">再刮一张</button>
    `;
    const surface = document.getElementById('scratchSurface');
    const againBtn = document.getElementById('scratchAgainBtn');
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
                let count = parseInt(localStorage.getItem(`scratch_${today}`)) || 0;
                count++;
                localStorage.setItem(`scratch_${today}`, count);
                await updateScratchRemaining();
                if (scratchRemaining > 0) {
                    againBtn.style.display = 'block';
                } else {
                    againBtn.style.display = 'none';
                }
            };
        });
    };
    againBtn.onclick = () => getScratchCard();
    updateScratchRemaining();
}