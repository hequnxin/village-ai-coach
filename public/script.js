// ==================== 全局变量 ====================
let currentSessionId = null;
let sessions = [];
let isTyping = false;
let typingSpeed = 15;
let typingInterval = null;
let stopTypingFlag = false;
let token = localStorage.getItem('token');
let username = '';
let knowledgeData = [];
let currentFilter = 'all';
let currentCategoryFilter = 'all';
let messageFavorites = [];
let currentView = 'chat';
let recognition = null;
let isRecording = false;
let currentSimulateSessionId = null;

// 游戏化全局变量
let comboCount = 0;
let comboTimeout = null;
let taskList = [];
let userLevel = 1;
let userPoints = 0;
let userNextLevelPoints = 100;
let audioEnabled = true;
let particleEnabled = true;
let particlesCanvas = null;
let particlesCtx = null;
let particles = [];

// 会议模块变量
let currentMeeting = null;
let meetingTyping = false;

// 情绪映射
const emotionMap = {
    happy: '😊', sad: '😭', angry: '😡', neutral: '😐', surprise: '😲', worry: '😟'
};

// ==================== DOM 元素 ====================
const authContainer = document.getElementById('authContainer');
const app = document.getElementById('app');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginTab = document.getElementById('loginTab');
const registerTab = document.getElementById('registerTab');
const loginError = document.getElementById('loginError');
const registerError = document.getElementById('registerError');
const usernameDisplay = document.getElementById('usernameDisplay');
const logoutBtn = document.getElementById('logoutBtn');
const newSessionBtn = document.getElementById('newSessionBtn');
const sessionListDiv = document.getElementById('sessionList');
const messageFavoriteList = document.getElementById('messageFavoriteList');
const allSessionsTab = document.getElementById('allSessionsTab');
const favoritesTab = document.getElementById('favoritesTab');
const messageFavoritesTab = document.getElementById('messageFavoritesTab');
const dynamicContent = document.getElementById('dynamicContent');
const navChat = document.getElementById('navChat');
const navSimulate = document.getElementById('navSimulate');
const navMeeting = document.getElementById('navMeeting');
const navKnowledge = document.getElementById('navKnowledge');
const navQuiz = document.getElementById('navQuiz');
const navProfile = document.getElementById('navProfile');

// ==================== 辅助函数 ====================
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// 音效播放（静默失败）
function playSound(type) {
    if (!audioEnabled) return;
    let audio = null;
    switch(type) {
        case 'send': audio = document.getElementById('soundSend'); break;
        case 'complete': audio = document.getElementById('soundComplete'); break;
        case 'error': audio = document.getElementById('soundError'); break;
        case 'reward': audio = document.getElementById('soundReward'); break;
        case 'emotion': audio = document.getElementById('soundEmotion'); break;
        default: return;
    }
    if (audio) {
        audio.currentTime = 0;
        audio.play().catch(e => console.log('音效播放失败', e));
    }
}

// 粒子特效
function addParticle(x, y, color) {
    if (!particleEnabled) return;
    particles.push({
        x, y, color,
        size: Math.random() * 4 + 2,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3 - 2,
        life: 1,
        decay: 0.02
    });
}

function initParticles() {
    if (!particleEnabled) return;
    particlesCanvas = document.createElement('canvas');
    particlesCanvas.style.position = 'fixed';
    particlesCanvas.style.top = '0';
    particlesCanvas.style.left = '0';
    particlesCanvas.style.width = '100%';
    particlesCanvas.style.height = '100%';
    particlesCanvas.style.pointerEvents = 'none';
    particlesCanvas.style.zIndex = '9999';
    document.body.appendChild(particlesCanvas);
    particlesCtx = particlesCanvas.getContext('2d');
    function resizeCanvas() {
        particlesCanvas.width = window.innerWidth;
        particlesCanvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    function animateParticles() {
        if (!particlesCanvas) return;
        requestAnimationFrame(animateParticles);
        particlesCtx.clearRect(0, 0, particlesCanvas.width, particlesCanvas.height);
        for (let i = particles.length-1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= p.decay;
            if (p.life <= 0 || p.y > particlesCanvas.height || p.x < 0 || p.x > particlesCanvas.width) {
                particles.splice(i,1);
                continue;
            }
            particlesCtx.globalAlpha = p.life;
            particlesCtx.fillStyle = p.color;
            particlesCtx.fillRect(p.x, p.y, p.size, p.size);
        }
        particlesCtx.globalAlpha = 1;
    }
    animateParticles();
}

// 连击特效
function showComboEffect() {
    comboCount++;
    if (comboTimeout) clearTimeout(comboTimeout);
    comboTimeout = setTimeout(() => { comboCount = 0; }, 5000);
    const effectDiv = document.createElement('div');
    effectDiv.className = 'combo-effect';
    effectDiv.textContent = `${comboCount} 连击！ +${comboCount * 5} 经验`;
    effectDiv.style.position = 'fixed';
    effectDiv.style.bottom = '20%';
    effectDiv.style.right = '20px';
    effectDiv.style.backgroundColor = '#ff9800';
    effectDiv.style.color = 'white';
    effectDiv.style.padding = '8px 16px';
    effectDiv.style.borderRadius = '30px';
    effectDiv.style.fontWeight = 'bold';
    effectDiv.style.zIndex = '999';
    effectDiv.style.animation = 'floatUp 1s ease-out forwards';
    document.body.appendChild(effectDiv);
    setTimeout(() => effectDiv.remove(), 1000);
    playSound('reward');
    addPoints(comboCount * 5);
}

// 添加积分（调用后端接口持久化 + 更新前端界面）
async function addPoints(points, reason = '游戏奖励') {
    // 更新前端显示
    const pointDiv = document.createElement('div');
    pointDiv.textContent = `+${points}`;
    pointDiv.style.position = 'fixed';
    pointDiv.style.bottom = '30%';
    pointDiv.style.right = '30px';
    pointDiv.style.color = '#ffd700';
    pointDiv.style.fontSize = '1.5rem';
    pointDiv.style.fontWeight = 'bold';
    pointDiv.style.textShadow = '0 0 2px black';
    pointDiv.style.animation = 'floatUp 1s ease-out';
    pointDiv.style.zIndex = '999';
    document.body.appendChild(pointDiv);
    setTimeout(() => pointDiv.remove(), 1000);

    // 调用后端接口持久化积分
    try {
        await fetchWithAuth('/api/quiz/add-points', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ points, reason })
        });
    } catch(e) { console.error('积分记录失败', e); }

    if (currentView === 'profile') renderProfileView();
    await loadLevelProgress();
}

async function loadLevelProgress() {
    try {
        const res = await fetchWithAuth('/api/user/growth');
        const data = await res.json();
        userPoints = data.points;
        userLevel = data.level;
        userNextLevelPoints = data.nextLevelPoints;
        updateSidebarLevel();
    } catch(e) { console.error(e); }
}

function updateSidebarLevel() {
    let levelContainer = document.getElementById('sidebarLevelContainer');
    if (!levelContainer) {
        const container = document.createElement('div');
        container.id = 'sidebarLevelContainer';
        container.className = 'level-progress-container';
        const userInfo = document.querySelector('.user-info');
        const taskPanel = document.getElementById('taskPanel');
        if (userInfo && taskPanel) {
            taskPanel.parentNode.insertBefore(container, userInfo);
        }
        levelContainer = container;
    }
    levelContainer.style.display = 'block';
    levelContainer.innerHTML = `
        <div class="level-info"><span>Lv.${userLevel}</span><span>${userPoints}/${userNextLevelPoints}</span></div>
        <div class="level-progress-bar"><div class="level-progress-fill" style="width: ${(userPoints/userNextLevelPoints)*100}%"></div></div>
    `;
}

// 任务系统
function initDailyTasks() {
    const today = new Date().toLocaleDateString();
    const saved = localStorage.getItem('dailyTasks');
    if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.date === today) {
            taskList = parsed.tasks;
            renderTaskPanel();
            return;
        }
    }
    taskList = [
        { id: 1, name: '发起3次对话', target: 3, current: 0, reward: 30, completed: false },
        { id: 2, name: '完成1次政策闯关', target: 1, current: 0, reward: 20, completed: false },
        { id: 3, name: '完成1次模拟对练', target: 1, current: 0, reward: 50, completed: false },
        { id: 4, name: '完成每日一练', target: 1, current: 0, reward: 40, completed: false },
        { id: 5, name: '参加会议', target: 1, current: 0, reward: 60, completed: false }
    ];
    localStorage.setItem('dailyTasks', JSON.stringify({ date: today, tasks: taskList }));
    renderTaskPanel();
}

function updateTaskProgress(type, delta = 1) {
    let updated = false;
    taskList.forEach(task => {
        if (task.completed) return;
        if (type === 'chat' && task.name === '发起3次对话') {
            task.current += delta;
            if (task.current >= task.target) { task.completed = true; showTaskCompleteToast(task); addPoints(task.reward, task.name); }
            updated = true;
        } else if (type === 'policyLevel' && task.name === '完成1次政策闯关') {
            task.current += delta;
            if (task.current >= task.target) { task.completed = true; showTaskCompleteToast(task); addPoints(task.reward, task.name); }
            updated = true;
        } else if (type === 'simulate' && task.name === '完成1次模拟对练') {
            task.current += delta;
            if (task.current >= task.target) { task.completed = true; showTaskCompleteToast(task); addPoints(task.reward, task.name); }
            updated = true;
        } else if (type === 'quiz' && task.name === '完成每日一练') {
            task.current += delta;
            if (task.current >= task.target) { task.completed = true; showTaskCompleteToast(task); addPoints(task.reward, task.name); }
            updated = true;
        } else if (type === 'meeting' && task.name === '参加会议') {
            task.current += delta;
            if (task.current >= task.target) { task.completed = true; showTaskCompleteToast(task); addPoints(task.reward, task.name); }
            updated = true;
        }
    });
    if (updated) {
        const today = new Date().toLocaleDateString();
        localStorage.setItem('dailyTasks', JSON.stringify({ date: today, tasks: taskList }));
        renderTaskPanel();
    }
}

function showTaskCompleteToast(task) {
    const toast = document.createElement('div');
    toast.className = 'task-toast';
    toast.innerHTML = `🎉 任务完成！获得 ${task.reward} 积分 🎉`;
    toast.style.position = 'fixed';
    toast.style.top = '20%';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.backgroundColor = '#4caf50';
    toast.style.color = 'white';
    toast.style.padding = '12px 24px';
    toast.style.borderRadius = '40px';
    toast.style.fontWeight = 'bold';
    toast.style.zIndex = '1000';
    toast.style.animation = 'bounceIn 0.5s ease-out';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
    playSound('complete');
}

function renderTaskPanel() {
    const panel = document.getElementById('taskPanel');
    if (!panel) return;
    let taskListDiv = panel.querySelector('#taskList');
    if (!taskListDiv) {
        taskListDiv = document.createElement('div');
        taskListDiv.id = 'taskList';
        panel.appendChild(taskListDiv);
    }
    taskListDiv.innerHTML = '';
    taskList.forEach(task => {
        const percent = (task.current / task.target) * 100;
        const item = document.createElement('div');
        item.className = 'task-item';
        item.innerHTML = `
            <span class="task-name">${task.name}</span>
            <div class="task-progress"><div class="task-progress-fill" style="width:${percent}%"></div></div>
            <span class="task-reward">+${task.reward}</span>
        `;
        if (task.completed) item.style.opacity = '0.6';
        taskListDiv.appendChild(item);
    });
}

// ==================== token 刷新与请求 ====================
let refreshPromise = null;
async function refreshToken() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
        const oldToken = localStorage.getItem('token');
        if (!oldToken) return false;
        try {
            const res = await fetch('/api/refresh', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${oldToken}` }
            });
            if (res.ok) {
                const data = await res.json();
                localStorage.setItem('token', data.token);
                token = data.token;
                return true;
            }
        } catch (e) { console.error('刷新token失败', e); }
        return false;
    })();
    const result = await refreshPromise;
    refreshPromise = null;
    return result;
}

async function fetchWithAuth(url, options = {}) {
    const currentToken = localStorage.getItem('token');
    if (!currentToken) { showAuth(); throw new Error('未登录'); }
    let res = await fetch(url, { ...options, headers: { ...options.headers, 'Authorization': `Bearer ${currentToken}` } });
    if (res.status === 401) {
        const refreshed = await refreshToken();
        if (refreshed) {
            const newToken = localStorage.getItem('token');
            res = await fetch(url, { ...options, headers: { ...options.headers, 'Authorization': `Bearer ${newToken}` } });
        } else {
            localStorage.removeItem('token');
            showAuth();
            throw new Error('登录已过期');
        }
    }
    return res;
}

// ==================== 初始化 ====================
if (token) {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        username = payload.username;
        usernameDisplay.textContent = username;
        authContainer.style.display = 'none';
        app.style.display = 'flex';
        initApp();
    } catch { localStorage.removeItem('token'); showAuth(); }
} else { showAuth(); }

function showAuth() {
    authContainer.style.display = 'flex';
    app.style.display = 'none';
}

loginTab.addEventListener('click', () => {
    loginTab.classList.add('active');
    registerTab.classList.remove('active');
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
    loginError.textContent = '';
});

registerTab.addEventListener('click', () => {
    registerTab.classList.add('active');
    loginTab.classList.remove('active');
    registerForm.style.display = 'block';
    loginForm.style.display = 'none';
    registerError.textContent = '';
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '登录失败');
        localStorage.setItem('token', data.token);
        usernameDisplay.textContent = data.username;
        authContainer.style.display = 'none';
        app.style.display = 'flex';
        initApp();
    } catch (err) { loginError.textContent = err.message; }
});

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value;
    const password = document.getElementById('registerPassword').value;
    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '注册失败');
        alert('注册成功，请登录');
        loginTab.click();
        document.getElementById('loginUsername').value = username;
    } catch (err) { registerError.textContent = err.message; }
});

logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('token');
    showAuth();
});

// ==================== 应用核心 ====================
async function initApp() {
    token = localStorage.getItem('token');
    initParticles();
    initDailyTasks();
    await loadSessions();
    await loadMessageFavorites();

    // 优先查找无消息的 chat 会话
    let emptyChatSession = null;
    for (let s of sessions) {
        if (s.type === 'chat') {
            const res = await fetchWithAuth(`/api/session/${s.id}`);
            const detail = await res.json();
            if (!detail.messages || detail.messages.length === 0) {
                emptyChatSession = s;
                break;
            }
        }
    }
    if (emptyChatSession) {
        await switchSession(emptyChatSession.id);
    } else {
        await createSession('新会话');
    }

    await loadKnowledge('all', 'all');
    setupSessionTabs();
    setupNavigation();
    await loadLevelProgress();

    const existingLevels = document.querySelectorAll('.level-progress-container');
    if (existingLevels.length > 1) {
        for (let i = 1; i < existingLevels.length; i++) existingLevels[i].remove();
    }

    newSessionBtn.onclick = () => createSession();

    window.addEventListener('beforeunload', () => {
        if (recognition) { try { recognition.abort(); } catch(e) {} }
    });
}

function setInputEnabled(enabled) {
    const userInput = document.getElementById('userInput');
    const sendBtn = document.getElementById('sendBtn');
    const voiceBtn = document.getElementById('voiceBtn');
    const simulateInput = document.getElementById('simulateInput');
    const simulateSendBtn = document.getElementById('simulateSendBtn');
    const finishBtn = document.getElementById('finishSimulateBtn');
    const hintBtn = document.getElementById('hintBtn');
    const meetingInput = document.getElementById('meetingInput');
    const sendMeetingBtn = document.getElementById('sendMeetingBtn');
    if (userInput) userInput.disabled = !enabled;
    if (sendBtn) sendBtn.disabled = !enabled;
    if (voiceBtn) voiceBtn.disabled = !enabled;
    if (simulateInput) simulateInput.disabled = !enabled;
    if (simulateSendBtn) simulateSendBtn.disabled = !enabled;
    if (finishBtn) finishBtn.disabled = !enabled;
    if (hintBtn) hintBtn.disabled = !enabled;
    if (meetingInput) meetingInput.disabled = !enabled;
    if (sendMeetingBtn) sendMeetingBtn.disabled = !enabled;
    if (enabled) {
        if (userInput) userInput.focus();
        else if (simulateInput) simulateInput.focus();
        else if (meetingInput) meetingInput.focus();
    }
}

async function loadSessions() {
    const res = await fetchWithAuth('/api/sessions');
    if (!res.ok) throw new Error('加载会话失败');
    let sessionsData = await res.json();
    if (!Array.isArray(sessionsData)) sessionsData = [];
    sessionsData.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    sessions = sessionsData;
    renderSessionList();
}

async function loadMessageFavorites() {
    const res = await fetchWithAuth('/api/user/favorites');
    if (res.ok) {
        messageFavorites = await res.json();
        renderMessageFavoriteList();
    }
}

function renderSessionList() {
    if (!sessions || !Array.isArray(sessions)) { sessionListDiv.innerHTML = '<div class="empty">暂无会话</div>'; return; }
    sessionListDiv.innerHTML = '';
    const filtered = currentFilter === 'all' ? sessions : sessions.filter(s => s.favorite);
    filtered.forEach(session => {
        const item = document.createElement('div');
        item.className = `session-item ${session.id === currentSessionId ? 'active' : ''}`;
        item.dataset.id = session.id;
        const titleSpan = document.createElement('span');
        titleSpan.className = 'session-title';
        titleSpan.textContent = session.title || '新会话';
        item.appendChild(titleSpan);
        const favBtn = document.createElement('button');
        favBtn.className = `favorite-btn ${session.favorite ? 'favorited' : ''}`;
        favBtn.innerHTML = session.favorite ? '★' : '☆';
        favBtn.title = session.favorite ? '取消收藏' : '收藏';
        favBtn.onclick = (e) => { e.stopPropagation(); toggleSessionFavorite(session.id, !session.favorite); };
        item.appendChild(favBtn);
        const delBtn = document.createElement('button');
        delBtn.className = 'delete-session';
        delBtn.innerHTML = '✕';
        delBtn.onclick = (e) => { e.stopPropagation(); deleteSession(session.id); };
        item.appendChild(delBtn);
        item.addEventListener('click', () => switchSession(session.id));
        sessionListDiv.appendChild(item);
    });
}

function renderMessageFavoriteList() {
    messageFavoriteList.innerHTML = '';
    if (messageFavorites.length === 0) { messageFavoriteList.innerHTML = '<div class="empty">暂无收藏的消息</div>'; return; }
    messageFavorites.forEach(fav => {
        const item = document.createElement('div');
        item.className = 'favorite-message-item';
        item.dataset.sessionId = fav.sessionId;
        item.dataset.messageId = fav.messageId;
        item.innerHTML = `<div class="session-title">📁 ${escapeHtml(fav.sessionTitle || '未命名会话')}</div><div class="message-preview">${escapeHtml(fav.content.substring(0,50))}${fav.content.length>50?'...':''}</div><div class="meta"><span>${fav.role==='user'?'👤':'🤖'}</span><span>${new Date(fav.favoritedAt).toLocaleString()}</span></div>`;
        item.addEventListener('click', () => switchToMessage(fav.sessionId, fav.messageId));
        messageFavoriteList.appendChild(item);
    });
}

async function toggleSessionFavorite(sessionId, favorite) {
    if (isTyping) return;
    try {
        const res = await fetchWithAuth(`/api/session/${sessionId}/favorite`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite })
        });
        if (!res.ok) throw new Error('操作失败');
        const session = sessions.find(s => s.id === sessionId);
        if (session) session.favorite = favorite;
        renderSessionList();
    } catch(err) { alert('收藏操作失败：'+err.message); }
}

async function toggleMessageFavorite(messageId, action) {
    try {
        const res = await fetchWithAuth('/api/user/favorite', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId, action })
        });
        if (!res.ok) throw new Error('操作失败');
        await loadMessageFavorites();
        if (messageFavoriteList.style.display !== 'none') renderMessageFavoriteList();
        if (action === 'add') updateTaskProgress('favorite', 1);
    } catch(err) { alert('消息收藏失败：'+err.message); }
}

async function switchToMessage(sessionId, messageId) {
    if (isTyping) return;
    await switchSession(sessionId);
    setTimeout(() => {
        const msgElem = document.querySelector(`.message[data-message-id="${messageId}"]`);
        if (msgElem) { msgElem.scrollIntoView({ behavior:'smooth', block:'center' }); msgElem.style.backgroundColor='#fff3cd'; setTimeout(()=> msgElem.style.backgroundColor='',2000); }
    },500);
}

async function switchSession(sessionId) {
    if (isTyping) return;
    currentSessionId = sessionId;
    const res = await fetchWithAuth(`/api/session/${sessionId}`);
    const session = await res.json();
    if (!session.messages) session.messages = [];
    if (currentView === 'chat') {
        const titleElem = document.getElementById('currentSessionTitle');
        if (titleElem) titleElem.textContent = session.title || '村官AI伙伴';
    }
    if (session.type === 'simulate') {
        currentView = 'simulate';
        [navChat, navSimulate, navMeeting, navKnowledge, navQuiz, navProfile].forEach(btn => btn.classList.remove('active'));
        navSimulate.classList.add('active');
        renderSimulateChat(session);
    } else if (session.type === 'meeting') {
        currentView = 'meeting';
        [navChat, navSimulate, navMeeting, navKnowledge, navQuiz, navProfile].forEach(btn => btn.classList.remove('active'));
        navMeeting.classList.add('active');
        renderMeetingChat(session);
    } else {
        if (currentView !== 'chat') {
            currentView = 'chat';
            [navChat, navSimulate, navMeeting, navKnowledge, navQuiz, navProfile].forEach(btn => btn.classList.remove('active'));
            navChat.classList.add('active');
            renderChatView(session);
        } else {
            renderSessionList();
            displayMessages(session.messages);
            updateInfoPanelFromMessages(session.messages);
        }
    }
}

function displayMessages(messages) {
    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv) return;
    if (!messages || !Array.isArray(messages)) { messagesDiv.innerHTML = ''; return; }
    messagesDiv.innerHTML = '';
    messages.forEach(msg => {
        const msgDiv = createMessageElement(msg.role, msg.content, msg.messageId);
        messagesDiv.appendChild(msgDiv);
        addActionIcons(msgDiv, null, msg.messageId);
    });
    scrollToBottom();
}

function createMessageElement(role, content, messageId) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    if (messageId) msgDiv.dataset.messageId = messageId;
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = content;
    msgDiv.appendChild(contentDiv);
    return msgDiv;
}

function createSimulateMessageElement(role, content, avatar, emotion, messageId) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    if (messageId) msgDiv.dataset.messageId = messageId;
    const emotionIcon = emotion ? emotionMap[emotion] || '😐' : '😐';
    msgDiv.innerHTML = `
        <div class="message-avatar">
            ${avatar}
            <div class="emotion-icon">${emotionIcon}</div>
        </div>
        <div class="message-bubble">
            <div class="message-content">${escapeHtml(content)}</div>
        </div>
    `;
    return msgDiv;
}

async function updateInfoPanelFromMessages(messages) {
    const infoContent = document.getElementById('infoContent');
    if (!infoContent) return;
    if (!messages || messages.length === 0) { infoContent.innerHTML = '<div style="color:#888;">📭 暂无对话记录</div>'; return; }
    infoContent.innerHTML = '<div style="color:#888;">🤖 正在分析...</div>';
    let retries = 2;
    while (retries >= 0) {
        try {
            const res = await fetchWithAuth('/api/chat/summarize', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: messages.slice(-20) })
            });
            const data = await res.json();
            const summary = data.summary || { points:[], status:'', reasons:[], suggestions:[], references:[] };
            let html = '<div style="font-size:0.9rem;">';
            if (summary.points.length) html += '<div style="margin-bottom:12px;"><strong>📌 要点</strong><ul style="margin:5px 0 0 20px;">'+summary.points.map(p=>`<li>${escapeHtml(p)}</li>`).join('')+'</ul></div>';
            if (summary.status) html += `<div style="margin-bottom:12px;"><strong>📋 现状</strong><div>${escapeHtml(summary.status)}</div></div>`;
            if (summary.reasons.length) html += '<div style="margin-bottom:12px;"><strong>🔍 原因</strong><ul style="margin:5px 0 0 20px;">'+summary.reasons.map(r=>`<li>${escapeHtml(r)}</li>`).join('')+'</ul></div>';
            if (summary.suggestions.length) html += '<div style="margin-bottom:12px;"><strong>💡 建议</strong><ul style="margin:5px 0 0 20px;">'+summary.suggestions.map(s=>`<li>${escapeHtml(s)}</li>`).join('')+'</ul></div>';
            if (summary.references.length) html += '<div style="margin-bottom:12px;"><strong>📚 参考</strong><ul style="margin:5px 0 0 20px;">'+summary.references.map(r=>`<li>${escapeHtml(r)}</li>`).join('')+'</ul></div>';
            html += '</div>';
            infoContent.innerHTML = html;
            return;
        } catch(err) { retries--; if (retries<0) infoContent.innerHTML = '<div style="color:#888;">⚠️ 摘要生成失败</div>'; else await new Promise(r=>setTimeout(r,1000)); }
    }
}

// ==================== 知识库功能 ====================
async function loadKnowledge(type='all', category='all') {
    let url = '/api/knowledge';
    const params = [];
    if (type !== 'all') params.push(`type=${encodeURIComponent(type)}`);
    if (category !== 'all') params.push(`category=${encodeURIComponent(category)}`);
    if (params.length) url += '?'+params.join('&');
    try {
        const res = await fetchWithAuth(url);
        knowledgeData = await res.json();
        renderKnowledgeList(knowledgeData);
    } catch(err) { console.error('加载知识库失败',err); }
}

function renderKnowledgeList(data) {
    const knowledgeList = document.getElementById('knowledgeList');
    if (!knowledgeList) return;
    knowledgeList.innerHTML = '';
    if (data.length === 0) { knowledgeList.innerHTML = '<div class="empty">暂无数据</div>'; return; }
    data.forEach(item => {
        let tags = [];
        if (item.tags) tags = Array.isArray(item.tags) ? item.tags : item.tags.split(',').map(t=>t.trim());
        const div = document.createElement('div');
        div.className = 'knowledge-item';
        div.innerHTML = `<div class="title"><span>${escapeHtml(item.title)}</span><span class="type">${item.type}·${item.category}</span></div><div class="content-preview">${escapeHtml(item.content.substring(0,100))}...</div><div class="tags">${tags.map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`;
        div.addEventListener('click',()=>showKnowledgeDetail(item));
        knowledgeList.appendChild(div);
    });
}

function showKnowledgeDetail(item) {
    let tags = [];
    if (item.tags) tags = Array.isArray(item.tags) ? item.tags : item.tags.split(',').map(t=>t.trim());
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `<div class="modal-content"><button class="modal-close">&times;</button><div class="modal-title">${escapeHtml(item.title)}</div><div class="modal-type">${item.type}·${item.category}</div><div class="modal-content-body">${escapeHtml(item.content)}</div><div class="modal-tags">${tags.map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')}</div></div>`;
    modal.querySelector('.modal-close').onclick = () => document.body.removeChild(modal);
    modal.onclick = e => { if(e.target===modal) document.body.removeChild(modal); };
    document.body.appendChild(modal);
}

function showUploadModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `<div class="modal-content" style="width:500px;"><button class="modal-close">&times;</button><h3>上传新知识</h3><form id="uploadForm"><div><label>标题：</label><br><input type="text" name="title" required style="width:100%;padding:5px;"></div><div><label>内容：</label><br><textarea name="content" rows="5" required style="width:100%;padding:5px;"></textarea></div><div><label>专题：</label><br><select name="type" required style="width:100%;padding:5px;"><option value="">请选择</option><option value="土地管理">土地管理</option><option value="产业发展">产业发展</option><option value="民生保障">民生保障</option><option value="矛盾纠纷">矛盾纠纷</option><option value="基层治理">基层治理</option><option value="项目申报">项目申报</option><option value="生态环保">生态环保</option><option value="乡村建设">乡村建设</option><option value="创业就业">创业就业</option><option value="政策法规">政策法规</option></select></div><div><label>类型：</label><br><select name="category" required style="width:100%;padding:5px;"><option value="">请选择</option><option value="政策">政策</option><option value="案例">案例</option><option value="常见问题">常见问题</option></select></div><div><label>标签(逗号分隔)：</label><br><input type="text" name="tags" style="width:100%;padding:5px;"></div><div style="text-align:right;"><button type="submit" style="background:#2e5d34;color:white;padding:8px 16px;border:none;border-radius:4px;">提交</button></div></form></div>`;
    document.body.appendChild(modal);
    modal.querySelector('.modal-close').onclick = () => document.body.removeChild(modal);
    modal.onclick = e => { if(e.target===modal) document.body.removeChild(modal); };
    const form = modal.querySelector('#uploadForm');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const data = { title: fd.get('title'), content: fd.get('content'), type: fd.get('type'), category: fd.get('category'), tags: fd.get('tags') };
        try {
            const res = await fetchWithAuth('/api/knowledge/upload', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
            if (!res.ok) throw new Error('上传失败');
            alert('上传成功，待审核');
            document.body.removeChild(modal);
        } catch(err) { alert('上传失败：'+err.message); }
    });
}

// ==================== 会话列表标签页 ====================
function setupSessionTabs() {
    allSessionsTab.onclick = () => {
        allSessionsTab.classList.add('active');
        favoritesTab.classList.remove('active');
        messageFavoritesTab.classList.remove('active');
        currentFilter='all';
        sessionListDiv.style.display='block';
        messageFavoriteList.style.display='none';
        renderSessionList();
    };
    favoritesTab.onclick = () => {
        favoritesTab.classList.add('active');
        allSessionsTab.classList.remove('active');
        messageFavoritesTab.classList.remove('active');
        currentFilter='favorites';
        sessionListDiv.style.display='block';
        messageFavoriteList.style.display='none';
        renderSessionList();
    };
    messageFavoritesTab.onclick = () => {
        messageFavoritesTab.classList.add('active');
        allSessionsTab.classList.remove('active');
        favoritesTab.classList.remove('active');
        sessionListDiv.style.display='none';
        messageFavoriteList.style.display='block';
        renderMessageFavoriteList();
    };
}

// ==================== 语音识别 ====================
function setupVoiceRecognition() {
    const voiceBtn = document.getElementById('voiceBtn');
    if (!voiceBtn) return;
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) { voiceBtn.disabled=true; voiceBtn.title='不支持语音'; return; }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang='zh-CN';
    recognition.interimResults=true;
    recognition.continuous=false;
    recognition.onresult = (e) => {
        const transcript = Array.from(e.results).map(r=>r[0].transcript).join('');
        const input = document.getElementById('userInput');
        if(input) input.value = transcript;
    };
    recognition.onerror = () => { isRecording=false; voiceBtn.style.background='#4a90e2'; voiceBtn.textContent='🎤'; };
    recognition.onend = () => { isRecording=false; voiceBtn.style.background='#4a90e2'; voiceBtn.textContent='🎤'; };
    voiceBtn.onmousedown = () => {
        if(isRecording) return;
        try{ recognition.start(); isRecording=true; voiceBtn.style.background='#d32f2f'; voiceBtn.textContent='🔴'; } catch(e){}
    };
    voiceBtn.onmouseup = () => { if(isRecording) recognition.stop(); };
    voiceBtn.onmouseleave = () => { if(isRecording) recognition.stop(); };
}

// ==================== 导航切换 ====================
function setupNavigation() {
    navChat.onclick = () => switchView('chat');
    navSimulate.onclick = () => switchView('simulate');
    if (navMeeting) navMeeting.onclick = () => switchView('meeting');
    navKnowledge.onclick = () => switchView('knowledge');
    navQuiz.onclick = () => switchView('quiz');
    navProfile.onclick = () => switchView('profile');
}

async function ensureChatSession() {
    if (currentSessionId) { const s = sessions.find(s=>s.id===currentSessionId); if (s && s.type==='chat') return; }
    const chatSess = sessions.find(s=>s.type==='chat');
    if (chatSess) await switchSession(chatSess.id);
    else await createSession();
}

async function switchView(view) {
    currentView = view;
    [navChat, navSimulate, navMeeting, navKnowledge, navQuiz, navProfile].forEach(btn=>btn.classList.remove('active'));
    if (view === 'chat') {
        navChat.classList.add('active');
        await ensureChatSession();
        renderChatView();
    } else if (view === 'simulate') {
        navSimulate.classList.add('active');
        renderSimulateView();
    } else if (view === 'meeting') {
        navMeeting.classList.add('active');
        renderMeetingSetupView();
    } else if (view === 'knowledge') {
        navKnowledge.classList.add('active');
        renderKnowledgeView();
    } else if (view === 'quiz') {
        navQuiz.classList.add('active');
        renderQuizView();
    } else if (view === 'profile') {
        navProfile.classList.add('active');
        renderProfileView();
    }
}

// ==================== 渲染问答视图 ====================
function renderChatView(existingSession=null) {
    dynamicContent.innerHTML = `<div class="chat-view"><div class="chat-area"><div class="chat-header"><div><h1 id="currentSessionTitle">村官AI伙伴</h1></div><div><button id="exportBtn" class="summary-btn">📥导出</button><button id="policyQuickSearch" class="summary-btn">📜政策速查</button></div></div><div id="chatContainer" class="chat-container"><div id="messages"></div><div id="typingIndicator" class="hidden">AI正在思考...</div></div><footer class="chat-footer"><div class="input-tip">💡提示：按住麦克风语音输入</div><div class="preset-questions"><button class="preset-btn" data-question="村里闲置小学可以改造成什么？">🏫闲置小学改造</button><button class="preset-btn" data-question="土地流转合同要注意哪些条款？">📄土地流转合同</button><button class="preset-btn" data-question="如何申请高标准农田项目？">🌾申请高标准农田</button><button class="preset-btn" data-question="村民不配合垃圾分类怎么办？">🗑️垃圾分类</button><button class="preset-btn" data-question="想发展民宿需要办哪些手续？">🏠发展民宿</button></div><div class="input-area"><textarea id="userInput" placeholder="输入你的问题..." rows="2"></textarea><button id="voiceBtn" class="voice-btn">🎤</button><button id="sendBtn">发送</button></div></footer></div><div class="info-panel" id="infoPanel"><h3>📋信息提取</h3><div id="infoContent" class="info-content"></div></div></div>`;
    const messagesDiv = document.getElementById('messages');
    const userInput = document.getElementById('userInput');
    const sendBtn = document.getElementById('sendBtn');
    const typingIndicator = document.getElementById('typingIndicator');
    const currentTitle = document.getElementById('currentSessionTitle');
    const exportBtn = document.getElementById('exportBtn');
    document.querySelectorAll('.preset-btn').forEach(btn=>btn.onclick=()=>{ userInput.value=btn.dataset.question; sendMessage(); });
    sendBtn.onclick = sendMessage;
    userInput.onkeydown = e => { if(e.key==='Enter' && !e.shiftKey && !isTyping) { e.preventDefault(); sendMessage(); } };
    exportBtn.onclick = exportCurrentChat;
    setupVoiceRecognition();
    if (currentSessionId && !existingSession) {
        fetchWithAuth(`/api/session/${currentSessionId}`).then(r=>r.json()).then(s=>{
            if(!s.messages) s.messages=[];
            currentTitle.textContent=s.title||'村官AI伙伴';
            displayMessages(s.messages);
            updateInfoPanelFromMessages(s.messages);
        });
    } else if (existingSession) {
        if(!existingSession.messages) existingSession.messages=[];
        currentTitle.textContent=existingSession.title||'村官AI伙伴';
        displayMessages(existingSession.messages);
        updateInfoPanelFromMessages(existingSession.messages);
    }
    document.getElementById('policyQuickSearch')?.addEventListener('click', showPolicyQuickSearch);
}

async function exportCurrentChat() {
    if(!currentSessionId) return;
    const res = await fetchWithAuth(`/api/session/${currentSessionId}`);
    const session = await res.json();
    if(!session.messages || !session.messages.length) { alert('暂无对话'); return; }
    let text = `会话：${session.title}\n时间：${new Date(session.createdAt).toLocaleString()}\n\n`;
    session.messages.forEach(m=>{ text+=`${m.role==='user'?'👤村官':'🤖AI伙伴'}：${m.content}\n\n`; });
    const blob = new Blob([text], {type:'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url; a.download=`会话_${session.title}_${new Date().toISOString().slice(0,10)}.txt`; a.click();
    URL.revokeObjectURL(url);
}
// ==================== 模拟对练视图（支持单人和多人模式） ====================
let simulateMode = 'single';
let currentScenario = null;
let currentMultiVillagers = [];

function renderSimulateView(forceList=false) {
    if (forceList || !currentSessionId || sessions.find(s=>s.id===currentSessionId)?.type!=='simulate') {
        fetchWithAuth('/api/simulate/scenarios').then(r=>r.json()).then(scenarios=>{
            if(scenarios.length===0){ dynamicContent.innerHTML='<div class="scenarios-list"><p>暂无场景</p></div>'; return; }
            let html=`<div class="scenarios-list"><h2>选择场景</h2>`;
            scenarios.forEach(s=>{ html+=`<div class="scenario-card" data-id="${s.id}"><h3>${escapeHtml(s.title)}</h3><p>${escapeHtml(s.description)}</p><p><strong>目标：</strong>${escapeHtml(s.goal)}</p><p><strong>角色：</strong>${escapeHtml(s.role)}</p><div class="difficulty-selector"><label>难度：</label><select class="difficulty-select"><option value="easy">🌟简单</option><option value="medium" selected>⚡中等</option><option value="hard">🔥困难</option></select></div><div class="mode-selector" style="margin: 8px 0;"><label>模式：</label><select class="mode-select"><option value="single">👤 单人模式</option><option value="multi">👥 多人模式（3位村民）</option></select></div><button class="start-simulate" data-id="${s.id}">开始对练</button></div>`; });
            html+=`</div>`;
            dynamicContent.innerHTML=html;
            document.querySelectorAll('.start-simulate').forEach(btn=>{ btn.onclick=()=>{ const card=btn.closest('.scenario-card'); const scenarioId=card.dataset.id; const diff=card.querySelector('.difficulty-select').value; const mode=card.querySelector('.mode-select').value; startSimulate(scenarioId, diff, mode); }; });
        }).catch(err=>{ dynamicContent.innerHTML='<p>加载失败</p>'; });
        return;
    }
    fetchWithAuth(`/api/session/${currentSessionId}`).then(r=>r.json()).then(session=>{ if(!session.messages) session.messages=[]; renderSimulateChat(session); });
}

async function startSimulate(scenarioId, difficulty, mode='single') {
    try {
        simulateMode = mode;
        const res = await fetchWithAuth('/api/simulate/session', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({scenarioId, difficulty}) });
        const data = await res.json();
        if(!res.ok) throw new Error(data.error);
        const sessionRes = await fetchWithAuth(`/api/session/${data.sessionId}`);
        const session = await sessionRes.json();
        if(!session.messages) session.messages=[];
        sessions.push(session);
        renderSessionList();
        currentSessionId=data.sessionId;
        currentView='simulate';
        [navChat, navSimulate, navMeeting, navKnowledge, navQuiz, navProfile].forEach(btn=>btn.classList.remove('active'));
        navSimulate.classList.add('active');

        if (mode === 'multi') {
            const scenariosRes = await fetchWithAuth('/api/simulate/scenarios');
            const scenarios = await scenariosRes.json();
            const scenario = scenarios.find(s => s.id === scenarioId);
            if (scenario) {
                currentMultiVillagers = [
                    { name: '张大叔', role: scenario.role, avatar: '👴', personality: '固执、爱面子', emotion: 'neutral' },
                    { name: '李大婶', role: scenario.role, avatar: '👵', personality: '热情、话多', emotion: 'neutral' },
                    { name: '小王', role: scenario.role, avatar: '👨', personality: '年轻、有点急躁', emotion: 'neutral' }
                ];
            } else {
                currentMultiVillagers = [
                    { name: '村民甲', role: '村民', avatar: '👤', personality: '普通', emotion: 'neutral' },
                    { name: '村民乙', role: '村民', avatar: '👤', personality: '普通', emotion: 'neutral' },
                    { name: '村民丙', role: '村民', avatar: '👤', personality: '普通', emotion: 'neutral' }
                ];
            }
        } else {
            currentMultiVillagers = [];
        }

        renderSimulateChat(session);
    } catch(err) { alert('启动失败：'+err.message); }
}

function analyzeEmotion(text) {
    const happy = ['谢谢', '感谢', '好', '不错', '满意', '开心', '棒'];
    const sad = ['难过', '伤心', '失望', '唉', '遗憾'];
    const angry = ['生气', '愤怒', '不满', '凭什么', '不行', '反对'];
    const worry = ['担心', '怕', '忧虑', '愁', '难'];
    const surprise = ['真的吗', '竟然', '没想到', '哇'];
    for (let w of happy) if (text.includes(w)) return 'happy';
    for (let w of sad) if (text.includes(w)) return 'sad';
    for (let w of angry) if (text.includes(w)) return 'angry';
    for (let w of worry) if (text.includes(w)) return 'worry';
    for (let w of surprise) if (text.includes(w)) return 'surprise';
    return 'neutral';
}

function renderSimulateChat(session) {
    fetchWithAuth('/api/simulate/scenarios').then(r=>r.json()).then(scenarios=>{
        const scenario = scenarios.find(s=>s.id===session.scenarioId);
        if(!scenario){
            dynamicContent.innerHTML=`<div><p>场景不存在</p><button id="backBtn">返回</button></div>`;
            document.getElementById('backBtn').onclick=()=>renderSimulateView(true);
            return;
        }
        currentScenario = scenario;
        let report=null;
        for(const msg of session.messages){ if(msg.role==='system' && msg.content.startsWith('report:')){ try{ report=JSON.parse(msg.content.substring(7)); }catch(e){} break; } }
        let reportHtml='';
        if(report){
            const scoresHtml=Object.entries(report.scores||{}).map(([dim,score])=>`<div class="score-item">${dim}: ${'⭐'.repeat(score)} (${score}/5)</div>`).join('');
            reportHtml=`<div class="report-section"><h4>评估报告</h4><div class="scores">${scoresHtml}</div><p><strong>建议：</strong>${escapeHtml(report.suggestions||'')}</p><button id="backToScenariosFromReport" class="summary-btn">返回场景列表</button></div>`;
        }
        const difficultyLevel = session.difficulty || 'medium';
        const difficultyText = difficultyLevel==='hard'?'困难':(difficultyLevel==='easy'?'简单':'中等');
        const modeText = simulateMode === 'multi' ? '👥 多人模式' : '👤 单人模式';

        dynamicContent.innerHTML=`<div class="simulate-view"><div class="simulate-header"><div style="display:flex;justify-content:space-between;"><h2>${escapeHtml(scenario.title)} <span class="difficulty-badge">难度:${difficultyText}</span> <span class="difficulty-badge">${modeText}</span></h2><button id="backToListBtn" class="summary-btn">←返回</button></div><p><strong>目标：</strong>${escapeHtml(scenario.goal)}</p><p><strong>角色：</strong>${escapeHtml(scenario.role)}</p><div style="display:flex;gap:10px;"><button id="hintBtn" class="summary-btn" ${report?'disabled':''}>💡提示</button><button id="finishSimulateBtn" class="summary-btn" ${report?'disabled':''}>结束并查看报告</button></div></div><div class="chat-container" id="simulateMessagesContainer"><div id="simulateMessages"></div><div id="simulateTyping" class="hidden">对方正在思考...</div></div>${reportHtml}<footer class="chat-footer" ${report?'style="display:none;"':''}><div class="input-area"><textarea id="simulateInput" placeholder="输入你的回应..." rows="2"></textarea><button id="simulateVoiceBtn" class="voice-btn">🎤</button><button id="simulateSendBtn">发送</button></div></footer></div>`;

        document.getElementById('backToListBtn').onclick=()=>renderSimulateView(true);
        if(document.getElementById('backToScenariosFromReport')) document.getElementById('backToScenariosFromReport').onclick=()=>renderSimulateView(true);
        const simulateMessagesDiv=document.getElementById('simulateMessages');
        const simulateInput=document.getElementById('simulateInput');
        const simulateSendBtn=document.getElementById('simulateSendBtn');
        const finishBtn=document.getElementById('finishSimulateBtn');
        const hintBtn=document.getElementById('hintBtn');
        const simulateTyping=document.getElementById('simulateTyping');

        session.messages.forEach(msg=>{
            if(msg.role==='system') return;
            let avatar = msg.role==='user'?'👨‍🌾':'🤖';
            let emotion = 'neutral';
            if(msg.role==='assistant' && msg.content) emotion = analyzeEmotion(msg.content);
            const msgDiv = createSimulateMessageElement(msg.role==='user'?'user':'assistant', msg.content, avatar, emotion, msg.messageId);
            simulateMessagesDiv.appendChild(msgDiv);
        });

        function scrollSim(){ const c=document.getElementById('simulateMessagesContainer'); if(c) c.scrollTop=c.scrollHeight; }
        scrollSim();

        if(simulateSendBtn){
            const newSend=simulateSendBtn.cloneNode(true);
            simulateSendBtn.parentNode.replaceChild(newSend,simulateSendBtn);
            newSend.onclick=async()=>{
                const text=simulateInput.value.trim();
                if(!text || isTyping) return;
                simulateInput.value='';
                if (simulateMode === 'multi') {
                    await sendMultiSimulateMessage(session.id, text, simulateMessagesDiv, simulateTyping, scenario);
                } else {
                    await sendSimulateMessage(session.id, text, simulateMessagesDiv, simulateTyping, scenario.role);
                }
            };
        }
        setupSimulateVoiceInput(simulateInput);

        if(finishBtn && !report){
            const newFinish=finishBtn.cloneNode(true);
            finishBtn.parentNode.replaceChild(newFinish,finishBtn);
            newFinish.onclick=async()=>{
                if(isTyping) return;
                newFinish.disabled=true;
                try{
                    const res=await fetchWithAuth('/api/simulate/finish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.id})});
                    const reportData=await res.json();
                    if(!res.ok) throw new Error(reportData.error);
                    const sRes=await fetchWithAuth(`/api/session/${session.id}`);
                    const updated=await sRes.json();
                    if(!updated.messages) updated.messages=[];
                    const idx=sessions.findIndex(s=>s.id===session.id);
                    if(idx!==-1) sessions[idx]=updated;
                    renderSessionList();
                    renderSimulateChat(updated);
                    updateTaskProgress('simulate',1);
                }catch(err){ alert('生成报告失败：'+err.message); newFinish.disabled=false; }
            };
        }

        if(hintBtn && !report){
            hintBtn.onclick=async()=>{
                if(isTyping) return;
                hintBtn.disabled=true;
                const loading=document.createElement('div');
                loading.className='message assistant';
                loading.innerHTML='<div class="message-content">🤔生成提示...</div>';
                simulateMessagesDiv.appendChild(loading);
                scrollSim();
                try{
                    const res=await fetchWithAuth('/api/chat/summarize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.id})});
                    const data=await res.json();
                    const summary=data.summary;
                    let hint='💡建议：\n';
                    if(summary.suggestions && summary.suggestions.length) hint+=summary.suggestions.map(s=>`- ${s}`).join('\n');
                    else hint+='尝试更耐心地沟通。';
                    loading.innerHTML=`<div class="message-content">${escapeHtml(hint)}</div>`;
                }catch(e){ loading.innerHTML='<div class="message-content">⚠️提示失败</div>'; }
                finally{ hintBtn.disabled=false; scrollSim(); }
            };
        }
    });
}

async function sendSimulateMessage(sessionId, text, container, typingIndicator, roleName){
    const userMsg=createSimulateMessageElement('user',text,'👨‍🌾','neutral');
    container.appendChild(userMsg);
    const scroll=()=>{ const c=document.getElementById('simulateMessagesContainer'); if(c) c.scrollTop=c.scrollHeight; };
    scroll();
    isTyping=true;
    typingIndicator.classList.remove('hidden');
    setInputEnabled(false);
    try{
        const res=await fetchWithAuth('/api/simulate/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,message:text})});
        const data=await res.json();
        if(!res.ok) throw new Error(data.error);
        typingIndicator.classList.add('hidden');
        const avatar=roleName.includes('村民')?'👵':'🤖';
        const emotion = analyzeEmotion(data.reply);
        const assistantMsg=createSimulateMessageElement('assistant',data.reply,avatar,emotion,data.messageId);
        container.appendChild(assistantMsg);
        if (emotion !== 'neutral') playSound('emotion');
        scroll();
    }catch(err){ alert('发送失败：'+err.message); } finally{ isTyping=false; setInputEnabled(true); }
}

async function sendMultiSimulateMessage(sessionId, text, container, typingIndicator, scenario){
    const userMsg=createSimulateMessageElement('user',text,'👨‍🌾','neutral');
    container.appendChild(userMsg);
    const scroll=()=>{ const c=document.getElementById('simulateMessagesContainer'); if(c) c.scrollTop=c.scrollHeight; };
    scroll();
    isTyping=true;
    typingIndicator.classList.remove('hidden');
    setInputEnabled(false);

    try {
        for (let i = 0; i < currentMultiVillagers.length; i++) {
            const villager = currentMultiVillagers[i];
            typingIndicator.innerHTML = `${villager.name} 正在思考...`;
            const prompt = `你正在模拟乡村工作场景。你的角色是：${villager.name}（${villager.personality}）。当前对话目标：${scenario.goal}。请以第一人称用中文回复村官的问题，回复内容要自然口语化，符合角色性格。问题：${text}`;
            const res = await fetchWithAuth('/api/simulate/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, message: prompt })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            const emotion = analyzeEmotion(data.reply);
            const assistantMsg = createSimulateMessageElement('assistant', data.reply, villager.avatar, emotion, data.messageId);
            container.appendChild(assistantMsg);
            scroll();
            if (emotion !== 'neutral') playSound('emotion');
            await new Promise(r => setTimeout(r, 500));
        }
        typingIndicator.classList.add('hidden');
    } catch(err) {
        alert('发送失败：'+err.message);
    } finally {
        isTyping=false;
        setInputEnabled(true);
        typingIndicator.innerHTML = '对方正在思考...';
        typingIndicator.classList.add('hidden');
    }
}

function setupSimulateVoiceInput(inputEl){
    const voiceBtn=document.getElementById('simulateVoiceBtn');
    if(!voiceBtn) return;
    if(!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)){ voiceBtn.disabled=true; return; }
    const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    const rec=new SpeechRecognition();
    rec.lang='zh-CN';
    rec.interimResults=true;
    let recording=false;
    voiceBtn.onmousedown=()=>{ if(recording) return; try{ rec.start(); recording=true; voiceBtn.style.background='#d32f2f'; voiceBtn.textContent='🔴'; }catch(e){} };
    voiceBtn.onmouseup=()=>{ if(recording) rec.stop(); };
    voiceBtn.onmouseleave=()=>{ if(recording) rec.stop(); };
    rec.onresult=e=>{ const t=Array.from(e.results).map(r=>r[0].transcript).join(''); inputEl.value=t; };
    rec.onerror=()=>{ recording=false; voiceBtn.style.background='#4a90e2'; voiceBtn.textContent='🎤'; };
    rec.onend=()=>{ recording=false; voiceBtn.style.background='#4a90e2'; voiceBtn.textContent='🎤'; };
}

// ==================== 会议模式（村民大会/村干部大会，可自定义主题和人员） ====================
function renderMeetingSetupView() {
    const meetingTypes = [
        { value: 'villager', label: '村民大会', roles: [
            { name: '张大爷', avatar: '👴', personality: '固执、爱面子' },
            { name: '李大妈', avatar: '👵', personality: '热情、话多' },
            { name: '王叔', avatar: '👨', personality: '务实、理性' },
            { name: '赵婶', avatar: '👩', personality: '敏感、爱抱怨' }
        ] },
        { value: 'cadre', label: '村干部大会', roles: [
            { name: '村支书', avatar: '👨‍💼', personality: '稳重、有远见' },
            { name: '村主任', avatar: '👩‍💼', personality: '务实、执行力强' },
            { name: '妇女主任', avatar: '👩', personality: '细心、善于沟通' },
            { name: '民兵连长', avatar: '👮', personality: '直爽、急躁' }
        ] }
    ];
    const commonTopics = [
        '人居环境整治', '土地流转协调', '产业发展规划', '矛盾纠纷调解', '惠民政策宣传'
    ];
    dynamicContent.innerHTML = `
        <div class="meeting-setup" style="padding:20px; max-width:600px; margin:0 auto;">
            <h3>🏛️ 会议模式</h3>
            <div style="margin-bottom:16px;">
                <label style="display:block; margin-bottom:6px;">会议类型：</label>
                <select id="meetingTypeSelect" style="width:100%; padding:8px; border-radius:8px; border:1px solid #ccc;">
                    ${meetingTypes.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
                </select>
            </div>
            <div style="margin-bottom:16px;">
                <label style="display:block; margin-bottom:6px;">会议主题：</label>
                <select id="meetingTopicSelect" style="width:100%; padding:8px; border-radius:8px; border:1px solid #ccc;">
                    <option value="custom">自定义主题</option>
                    ${commonTopics.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
                <input type="text" id="customTopicInput" placeholder="输入自定义主题" style="width:100%; margin-top:8px; padding:8px; border-radius:8px; border:1px solid #ccc; display:none;">
            </div>
            <div style="margin-bottom:16px;">
                <label style="display:block; margin-bottom:6px;">参与人员（用逗号分隔，格式：名字:头像:性格）</label>
                <textarea id="customRolesInput" rows="3" style="width:100%; padding:8px; border-radius:8px; border:1px solid #ccc;" placeholder="例如：&#10;张大爷:👴:固执、爱面子&#10;李大妈:👵:热情、话多"></textarea>
                <div style="font-size:0.8rem; color:#666; margin-top:4px;">留空则使用默认人员。格式：姓名:头像(emoji):性格描述，每行一个</div>
            </div>
            <button id="startMeetingBtn" class="submit-btn" style="width:100%;">开始会议</button>
        </div>
        <div id="meetingContent" style="display:none;"></div>
    `;
    const typeSelect = document.getElementById('meetingTypeSelect');
    const topicSelect = document.getElementById('meetingTopicSelect');
    const customInput = document.getElementById('customTopicInput');
    const customRolesInput = document.getElementById('customRolesInput');
    topicSelect.addEventListener('change', () => {
        customInput.style.display = topicSelect.value === 'custom' ? 'block' : 'none';
    });
    document.getElementById('startMeetingBtn').onclick = () => {
        const meetingType = typeSelect.value;
        const topic = topicSelect.value === 'custom' ? customInput.value.trim() : topicSelect.value;
        if (!topic) { alert('请填写会议主题'); return; }
        let roles = [];
        const customRolesText = customRolesInput.value.trim();
        if (customRolesText) {
            const lines = customRolesText.split('\n');
            for (let line of lines) {
                const parts = line.split(':');
                if (parts.length >= 2) {
                    roles.push({
                        name: parts[0].trim(),
                        avatar: parts[1].trim() || '👤',
                        personality: parts[2] ? parts[2].trim() : '普通'
                    });
                }
            }
        }
        if (roles.length === 0) {
            const defaultTypes = { villager: '村民大会', cadre: '村干部大会' };
            const defaultRoles = meetingTypes.find(t => t.value === meetingType)?.roles || meetingTypes[0].roles;
            roles = defaultRoles.map(r => ({ ...r }));
        }
        startMeeting(roles, topic);
    };
}

function startMeeting(roles, topic) {
    currentMeeting = {
        sessionId: null,
        villagers: roles.map(r => ({ ...r, emotion: 'neutral', id: crypto.randomUUID?.() || Math.random().toString() })),
        activeVillagerId: roles[0].id,
        messages: [],
        topic: topic
    };
    renderMeetingChatArea();
}

function renderMeetingChatArea() {
    if (!currentMeeting) return;
    dynamicContent.innerHTML = `
        <div class="meeting-view">
            <div class="meeting-header">
                <h2>🏛️ ${escapeHtml(currentMeeting.topic)}</h2>
                <p>参会人数：${currentMeeting.villagers.length} 人</p>
                <button id="exitMeetingBtn" class="summary-btn">退出会议</button>
            </div>
            <div class="meeting-villagers" id="meetingVillagers"></div>
            <div class="meeting-chat-area">
                <div class="meeting-messages" id="meetingMessages"></div>
                <div class="meeting-input-area">
                    <textarea id="meetingInput" placeholder="向与会人员发言..." rows="2"></textarea>
                    <button id="sendMeetingBtn">发送</button>
                </div>
            </div>
        </div>
    `;
    renderMeetingVillagers();
    const meetingInput = document.getElementById('meetingInput');
    const sendBtn = document.getElementById('sendMeetingBtn');
    const exitBtn = document.getElementById('exitMeetingBtn');
    sendBtn.onclick = () => sendMeetingMessage();
    meetingInput.onkeydown = e => { if(e.key==='Enter' && !e.shiftKey && !meetingTyping) { e.preventDefault(); sendMeetingMessage(); } };
    exitBtn.onclick = () => renderMeetingSetupView();
}

function renderMeetingVillagers() {
    const container = document.getElementById('meetingVillagers');
    if (!container) return;
    container.innerHTML = '';
    currentMeeting.villagers.forEach(v => {
        const card = document.createElement('div');
        card.className = `villager-card ${currentMeeting.activeVillagerId === v.id ? 'active' : ''}`;
        card.dataset.id = v.id;
        card.innerHTML = `
            <div class="villager-avatar">${v.avatar}</div>
            <div class="villager-name">${v.name}</div>
            <div class="villager-emotion">${emotionMap[v.emotion] || '😐'}</div>
        `;
        card.onclick = () => {
            currentMeeting.activeVillagerId = v.id;
            renderMeetingVillagers();
        };
        container.appendChild(card);
    });
}

async function sendMeetingMessage() {
    const input = document.getElementById('meetingInput');
    const text = input.value.trim();
    if (!text || meetingTyping) return;
    input.value = '';
    const activeVillager = currentMeeting.villagers.find(v => v.id === currentMeeting.activeVillagerId);
    if (!activeVillager) return;
    const userMsgDiv = document.createElement('div');
    userMsgDiv.className = 'meeting-message user';
    userMsgDiv.innerHTML = `<div class="message-avatar">👨‍🌾</div><div class="message-bubble">${escapeHtml(text)}</div>`;
    const messagesContainer = document.getElementById('meetingMessages');
    messagesContainer.appendChild(userMsgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    meetingTyping = true;
    setInputEnabled(false);
    try {
        const prompt = `你正在模拟${currentMeeting.topic}会议。当前发言者是：${activeVillager.name}，性格：${activeVillager.personality}。请以第一人称用中文回复村官的问题，回复内容要自然口语化，符合身份。问题：${text}`;
        const res = await fetchWithAuth('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ sessionId: currentSessionId || 'meeting_temp', message: prompt }) });
        const data = await res.json();
        const reply = data.reply || '嗯...我再想想。';
        const newEmotion = analyzeEmotion(reply);
        activeVillager.emotion = newEmotion;
        renderMeetingVillagers();
        const replyDiv = document.createElement('div');
        replyDiv.className = 'meeting-message assistant';
        replyDiv.innerHTML = `<div class="message-avatar">${activeVillager.avatar}</div><div class="message-bubble">${escapeHtml(reply)}</div>`;
        messagesContainer.appendChild(replyDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        playSound('send');
        if (newEmotion !== 'neutral') playSound('emotion');
    } catch(err) {
        console.error(err);
        const errDiv = document.createElement('div');
        errDiv.className = 'meeting-message assistant';
        errDiv.innerHTML = `<div class="message-avatar">⚠️</div><div class="message-bubble">系统繁忙，请稍后再试。</div>`;
        messagesContainer.appendChild(errDiv);
    } finally {
        meetingTyping = false;
        setInputEnabled(true);
        updateTaskProgress('meeting', 1);
    }
}

function renderMeetingChat(session) {
    renderMeetingSetupView();
}

// ==================== 渲染知识库视图 ====================
function renderKnowledgeView() {
    dynamicContent.innerHTML=`<div class="knowledge-view"><div class="knowledge-filters">${['全部','土地管理','产业发展','民生保障','矛盾纠纷','基层治理','项目申报','生态环保','乡村建设','创业就业','政策法规'].map(t=>`<button class="filter-btn ${t==='全部'?'active':''}" data-type="${t==='全部'?'all':t}">${t}</button>`).join('')}</div><div class="knowledge-category-filters"><button class="category-filter active" data-category="all">全部</button><button class="category-filter" data-category="政策">政策</button><button class="category-filter" data-category="案例">案例</button><button class="category-filter" data-category="常见问题">常见问题</button></div><div style="text-align:right;margin:8px 0;"><button id="uploadKnowledgeBtn" class="new-session" style="background:#2e5d34;color:white;">+上传知识</button><button id="policyQuickSearchBtn" class="new-session" style="background:#2e5d34;margin-left:8px;">📜政策速查</button></div><div id="knowledgeList" class="knowledge-list"></div></div>`;
    document.querySelectorAll('.filter-btn').forEach(btn=>btn.onclick=()=>{ document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); currentFilter=btn.dataset.type; loadKnowledge(currentFilter,currentCategoryFilter); });
    document.querySelectorAll('.category-filter').forEach(btn=>btn.onclick=()=>{ document.querySelectorAll('.category-filter').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); currentCategoryFilter=btn.dataset.category; loadKnowledge(currentFilter,currentCategoryFilter); });
    document.getElementById('uploadKnowledgeBtn').onclick=showUploadModal;
    document.getElementById('policyQuickSearchBtn').onclick=showPolicyQuickSearch;
    loadKnowledge(currentFilter,currentCategoryFilter);
}

async function showPolicyQuickSearch() {
    let suggestKeywords = [];
    if (currentView === 'chat' && currentSessionId) {
        const session = sessions.find(s => s.id === currentSessionId);
        if (session && session.messages) {
            const userMessages = session.messages.filter(m => m.role === 'user').slice(-3);
            const stopwords = ['的','了','是','在','我','你','什么','怎么','如何','为什么','哪','这','那','吗','呢','吧','啊','哦','嗯','呀','有','没有','不','也','都','和','与','或','但','而','却','就','才','只','还','要','会','能','可以','应该','可能','一定','非常','很','太','更','最'];
            const extractKeywords = (text) => { const words = text.split(/[，,。？?！!、\s]+/).filter(w => w.length > 1 && !stopwords.includes(w)); return [...new Set(words.slice(0, 3))]; };
            let allKeywords = [];
            userMessages.forEach(msg => { allKeywords.push(...extractKeywords(msg.content)); });
            suggestKeywords = [...new Set(allKeywords)].slice(0, 5);
        }
    }
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    let suggestHtml = '';
    if (suggestKeywords.length > 0) { suggestHtml = `<div style="margin-top:12px;"><div style="font-size:0.85rem;color:#666;">🔍 猜你想搜：</div><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;">${suggestKeywords.map(k => `<button class="suggest-tag" data-keyword="${escapeHtml(k)}" style="background:#f0f0f0;border:none;padding:4px 12px;border-radius:20px;cursor:pointer;">${escapeHtml(k)}</button>`).join('')}</div></div>`; }
    modal.innerHTML = `<div class="modal-content" style="width:450px;"><button class="modal-close" style="position:absolute;right:12px;top:12px;">&times;</button><h3>📜 政策速查</h3><p style="margin-bottom:12px;color:#666;">输入关键词查询相关政策、案例</p><input type="text" id="policySearchInput" placeholder="请输入关键词..." style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;"><div id="searchResults" style="margin-top:16px;max-height:300px;overflow-y:auto;display:none;"></div>${suggestHtml}<div style="margin-top:16px;text-align:right;"><button id="policySearchCancel" style="background:#ccc;color:#333;padding:6px 16px;border:none;border-radius:4px;margin-right:8px;cursor:pointer;">取消</button><button id="policySearchConfirm" style="background:#2e5d34;color:white;padding:6px 16px;border:none;border-radius:4px;cursor:pointer;">搜索</button></div></div>`;
    document.body.appendChild(modal);
    const input = modal.querySelector('#policySearchInput');
    const confirmBtn = modal.querySelector('#policySearchConfirm');
    const cancelBtn = modal.querySelector('#policySearchCancel');
    const closeBtn = modal.querySelector('.modal-close');
    const resultsDiv = modal.querySelector('#searchResults');
    const doSearch = async (keyword) => {
        if (!keyword) { alert('请输入关键词'); return; }
        resultsDiv.style.display = 'block';
        resultsDiv.innerHTML = '<div style="text-align:center;padding:20px;">搜索中...</div>';
        try {
            const res = await fetchWithAuth(`/api/knowledge/search?q=${encodeURIComponent(keyword)}`);
            const results = await res.json();
            if (results.length === 0) { resultsDiv.innerHTML = '<div style="text-align:center;padding:20px;color:#999;">未找到相关内容</div>'; return; }
            resultsDiv.innerHTML = results.map(r => `<div style="margin-bottom:12px;padding:8px;border-bottom:1px solid #eee;cursor:pointer;" data-id="${r.id}"><div style="font-weight:bold;color:#2e5d34;">${escapeHtml(r.title)}</div><div style="font-size:0.8rem;color:#666;margin-top:4px;">${escapeHtml(r.content.substring(0,150))}...</div><div style="font-size:0.7rem;color:#999;margin-top:4px;">${r.type} · ${r.category}</div></div>`).join('');
            resultsDiv.querySelectorAll('[data-id]').forEach(el => { el.onclick = () => { const item = results.find(r => r.id === el.dataset.id); if (item) showKnowledgeDetail(item); }; });
        } catch (err) { resultsDiv.innerHTML = `<div style="color:red;text-align:center;">搜索失败：${err.message}</div>`; }
    };
    const suggestTags = modal.querySelectorAll('.suggest-tag');
    suggestTags.forEach(tag => { tag.onclick = () => { const keyword = tag.dataset.keyword; input.value = keyword; doSearch(keyword); }; });
    confirmBtn.onclick = () => { const kw = input.value.trim(); if(kw) doSearch(kw); };
    cancelBtn.onclick = () => document.body.removeChild(modal);
    closeBtn.onclick = () => document.body.removeChild(modal);
    modal.onclick = (e) => { if (e.target === modal) document.body.removeChild(modal); };
    input.focus();
    input.onkeypress = (e) => { if (e.key === 'Enter') { const kw = input.value.trim(); if(kw) doSearch(kw); } };
}

// ==================== 个人中心 ====================
function renderProfileView() {
    dynamicContent.innerHTML=`<div class="profile-view"><div class="profile-header"><div class="profile-avatar">👤</div><div class="profile-info"><h2>${escapeHtml(username)}</h2><p>村官</p></div></div><div class="profile-stats"><div class="stat-card"><div class="stat-value" id="points">0</div><div class="stat-label">总积分</div></div><div class="stat-card"><div class="stat-value" id="level">Lv.0</div><div class="stat-label">等级</div></div><div class="stat-card"><div class="stat-value" id="nextLevel">0</div><div class="stat-label">距下一级</div></div></div><div class="profile-section"><h3>🏅 勋章</h3><div id="badges" class="badges">加载中...</div></div><div class="profile-section"><h3>📊 统计</h3><div id="stats" class="stats-grid">加载中...</div></div><div class="profile-section"><h3>📈 成长曲线</h3><canvas id="growthChart" width="400" height="200"></canvas></div><div class="profile-section"><h3>🎮 游戏设置</h3><div><label><input type="checkbox" id="audioToggle" ${audioEnabled?'checked':''}> 音效</label> <label style="margin-left:20px;"><input type="checkbox" id="particleToggle" ${particleEnabled?'checked':''}> 粒子特效</label></div></div></div>`;
    fetchWithAuth('/api/user/growth').then(r=>r.json()).then(data=>{
        document.getElementById('points').textContent=data.points;
        document.getElementById('level').textContent=`Lv.${data.level}`;
        const need=data.nextLevelPoints-data.points;
        document.getElementById('nextLevel').textContent=need>0?need:0;
        const badgesDiv=document.getElementById('badges');
        if(data.badges.length===0) badgesDiv.innerHTML='<p>暂无勋章</p>';
        else badgesDiv.innerHTML=data.badges.map(b=>`<div class="badge-item"><span class="badge-icon">${b.icon}</span><span class="badge-name">${b.name}</span></div>`).join('');
        document.getElementById('stats').innerHTML=`<div class="stat-item">对话次数：${data.stats.sessionCount}</div><div class="stat-item">收藏消息：${data.stats.favoriteCount}</div><div class="stat-item">收藏会话：${data.stats.favoriteSessionCount}</div><div class="stat-item">已采纳上传：${data.stats.approvedUploads}</div><div class="stat-item">待审核上传：${data.stats.pendingUploads}</div>`;
        const ctx=document.getElementById('growthChart').getContext('2d');
        const base=Math.max(10,Math.floor(data.points/7));
        const days=['周一','周二','周三','周四','周五','周六','周日'];
        const vals=days.map(()=>base+Math.floor(Math.random()*20)-5);
        const w=400,h=200;
        ctx.clearRect(0,0,w,h);
        const barW=30,startX=50;
        const maxVal=Math.max(...vals)*1.2;
        ctx.fillStyle='#2e5d34';
        days.forEach((d,i)=>{ const bh=(vals[i]/maxVal)*(h-50); const x=startX+i*(barW+10); const y=h-30-bh; ctx.fillRect(x,y,barW,bh); ctx.fillStyle='#333'; ctx.font='12px Arial'; ctx.fillText(d,x,h-10); ctx.fillStyle='#2e5d34'; });
    });
    document.getElementById('audioToggle')?.addEventListener('change',e=>{ audioEnabled=e.target.checked; });
    document.getElementById('particleToggle')?.addEventListener('change',e=>{ particleEnabled=e.target.checked; if(particleEnabled&&!particlesCanvas) initParticles(); });
}

// ==================== 消息发送核心 ====================
async function sendUserMessage(text) {
    if(isTyping) return;
    if(!text || !currentSessionId) return;
    const messagesDiv=document.getElementById('messages');
    if(!messagesDiv) return;
    const tempMsg=createMessageElement('user',text);
    messagesDiv.appendChild(tempMsg);
    addActionIcons(tempMsg,null,null);
    scrollToBottom();
    const typingIndicator=document.getElementById('typingIndicator');
    if(typingIndicator) typingIndicator.classList.remove('hidden');
    setInputEnabled(false);
    try{
        const res=await fetchWithAuth('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:currentSessionId,message:text})});
        if(!res.ok){ const err=await res.json(); throw new Error(err.error); }
        const data=await res.json();
        if(typingIndicator) typingIndicator.classList.add('hidden');
        await addMessageWithTyping('assistant','',data.reply,data.knowledgeRefs,data.assistantMessageId);
        await loadSessions();
        const curr=sessions.find(s=>s.id===currentSessionId);
        if(curr){ const titleElem=document.getElementById('currentSessionTitle'); if(titleElem) titleElem.textContent=curr.title; }
        const sessRes=await fetchWithAuth(`/api/session/${currentSessionId}`);
        const updated=await sessRes.json();
        if(updated.messages) updateInfoPanelFromMessages(updated.messages);
        await loadMessageFavorites();
        showComboEffect();
        updateTaskProgress('chat',1);
        playSound('send');
    }catch(err){
        if(typingIndicator) typingIndicator.classList.add('hidden');
        console.error(err);
        alert('发送失败：'+err.message);
        setInputEnabled(true);
        isTyping=false;
    }
}

async function sendMessage(){
    const input=document.getElementById('userInput');
    if(!input) return;
    const text=input.value.trim();
    if(!text) return;
    if(!currentSessionId){ await createSession(); input.value=text; await sendUserMessage(text); return; }
    const sess=sessions.find(s=>s.id===currentSessionId);
    if(sess && sess.type!=='chat'){ alert('当前不是问答模式，已创建新会话'); await createSession(); input.value=text; await sendUserMessage(text); return; }
    input.value='';
    await sendUserMessage(text);
}

async function addMessageWithTyping(role,thought,content,knowledgeRefs=[],messageId=null){
    isTyping=true;
    setInputEnabled(false);
    stopTypingFlag=false;
    addStopButton();
    const messagesDiv=document.getElementById('messages');
    if(!messagesDiv) return;
    const msgDiv=document.createElement('div');
    msgDiv.className=`message ${role}`;
    if(messageId) msgDiv.dataset.messageId=messageId;
    const contentDiv=document.createElement('div');
    contentDiv.className='message-content';
    contentDiv.style.whiteSpace='pre-wrap';
    contentDiv.textContent='';
    msgDiv.appendChild(contentDiv);
    messagesDiv.appendChild(msgDiv);
    scrollToBottom();
    try{
        await typeText(contentDiv,content,typingSpeed);
        if(stopTypingFlag) return;
        if(knowledgeRefs && knowledgeRefs.length){
            const refDiv=document.createElement('div');
            refDiv.className='knowledge-refs';
            let refHtml='📚参考：';
            knowledgeRefs.forEach(ref=>{ refHtml+=`<span class="ref-tag">${ref.type==='web'?'🌐':'📘'}${escapeHtml(ref.title)}</span> `; });
            refDiv.innerHTML=refHtml;
            msgDiv.appendChild(refDiv);
            scrollToBottom();
        }
        addActionIcons(msgDiv,null,messageId);
        scrollToBottom();
        updateInfoPanel(knowledgeRefs);
    }catch(e){ console.error(e); }
    finally{ stopTyping(); }
}

function typeText(element,text,speed){
    return new Promise((resolve)=>{
        if(!element || !text){ resolve(); return; }
        let i=0;
        element.textContent='';
        typingInterval=setInterval(()=>{
            if(stopTypingFlag){ clearInterval(typingInterval); typingInterval=null; resolve(); return; }
            if(i<text.length){ element.textContent+=text[i]; i++; scrollToBottom(); }
            else{ clearInterval(typingInterval); typingInterval=null; resolve(); }
        },speed);
    });
}

function addStopButton(){
    if(document.getElementById('stopTypingBtn')) return;
    const ti=document.getElementById('typingIndicator');
    if(!ti) return;
    const btn=document.createElement('button');
    btn.id='stopTypingBtn';
    btn.textContent='⏹️停止';
    btn.style.marginLeft='10px';
    btn.style.padding='4px 12px';
    btn.style.background='#f44336';
    btn.style.color='white';
    btn.style.border='none';
    btn.style.borderRadius='20px';
    btn.style.cursor='pointer';
    btn.onclick=()=>{ stopTypingFlag=true; stopTyping(); };
    ti.parentNode.insertBefore(btn,ti.nextSibling);
}

function stopTyping(){
    if(typingInterval){ clearInterval(typingInterval); typingInterval=null; }
    isTyping=false;
    setInputEnabled(true);
    const btn=document.getElementById('stopTypingBtn');
    if(btn) btn.remove();
}

function addActionIcons(msgDiv,idx,msgId){
    const actions=document.createElement('div');
    actions.className='message-actions';
    const copy=document.createElement('button');
    copy.innerHTML='📋';
    copy.title='复制';
    copy.onclick=()=>{ const c=msgDiv.querySelector('.message-content').textContent; navigator.clipboard.writeText(c); alert('已复制'); };
    const redo=document.createElement('button');
    redo.innerHTML='🔄';
    redo.title='重新回答';
    redo.onclick=()=>{ regenerateAnswer(msgDiv); };
    const fav=document.createElement('button');
    fav.innerHTML='☆';
    fav.title='收藏';
    if(msgId){
        const isFav=messageFavorites.some(f=>f.messageId===msgId);
        if(isFav){ fav.innerHTML='★'; fav.classList.add('favorited'); }
        fav.onclick=async()=>{ const action=fav.classList.contains('favorited')?'remove':'add'; await toggleMessageFavorite(msgId,action); if(action==='add'){ fav.innerHTML='★'; fav.classList.add('favorited'); } else{ fav.innerHTML='☆'; fav.classList.remove('favorited'); } };
    } else { fav.disabled=true; fav.title='暂不可收藏'; }
    actions.appendChild(copy);
    actions.appendChild(redo);
    actions.appendChild(fav);
    msgDiv.appendChild(actions);
}

async function regenerateAnswer(msgDiv){
    if(isTyping) return;
    const container=document.getElementById('messages');
    const all=Array.from(container.children);
    const idx=all.indexOf(msgDiv);
    if(idx<=0) return;
    let userMsgDiv=null;
    for(let i=idx-1;i>=0;i--){ if(all[i].classList.contains('user')){ userMsgDiv=all[i]; break; } }
    if(!userMsgDiv) return;
    const userText=userMsgDiv.querySelector('.message-content').textContent;
    for(let i=all.length-1;i>=idx;i--) all[i].remove();
    await sendUserMessage(userText);
}

function updateInfoPanel(refs){
    const panel=document.getElementById('infoContent');
    if(!panel) return;
    if(!refs || refs.length===0){ panel.innerHTML='<div style="color:#888;">暂无参考</div>'; return; }
    let html='<div>📚参考：</div><ul>';
    refs.forEach(r=>{ if(r.type==='web') html+=`<li><a href="${escapeHtml(r.link)}" target="_blank">🌐${escapeHtml(r.title)}</a></li>`; else html+=`<li>📘${escapeHtml(r.title)}</li>`; });
    html+='</ul>';
    panel.innerHTML=html;
}

// ==================== 会话操作 ====================
async function createSession(title='新会话'){
    if(isTyping) return;
    const res=await fetchWithAuth('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title})});
    const data=await res.json();
    if(!data.session){ alert('创建失败'); return; }
    sessions.push(data.session);
    sessions.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    renderSessionList();
    switchSession(data.sessionId);
    if(currentView==='chat') renderChatView();
    else if(currentView==='simulate') renderSimulateView();
    else if(currentView==='meeting') renderMeetingSetupView();
}

async function deleteSession(sessionId){
    if(isTyping) return;
    if(!confirm('删除会话？')) return;
    await fetchWithAuth(`/api/session/${sessionId}`,{method:'DELETE'});
    sessions=sessions.filter(s=>s.id!==sessionId);
    if(currentSessionId===sessionId){
        if(sessions.length>0) switchSession(sessions[0].id);
        else createSession();
    } else renderSessionList();
}

function scrollToBottom(){
    const c=document.getElementById('chatContainer');
    if(c) c.scrollTop=c.scrollHeight;
}

// ==================== 游戏中心：政策闯关等新功能 ====================
function renderQuizView() {
    dynamicContent.innerHTML = `
        <div class="quiz-view" style="padding:20px; overflow-y:auto; height:100%;">
            <div class="game-card">
                <div class="game-header"><span class="game-title">🎯 政策闯关</span><span class="game-badge">闯关得勋章</span></div>
                <div id="levelList" class="level-list">加载中...</div>
            </div>
            <div class="game-card">
                <div class="game-header"><span class="game-title">🤝 双人PK答题</span><span class="game-badge">邀请好友PK</span></div>
                <div id="pkArea"><button id="createPkBtn" class="submit-btn">创建房间</button><div id="joinPkArea" style="margin-top:12px;"><input type="text" id="roomCodeInput" placeholder="房间码" style="padding:6px;border-radius:20px;border:1px solid #ccc;"><button id="joinPkBtn" class="submit-btn" style="margin-left:8px;">加入</button></div><div id="pkStatus"></div></div>
            </div>
            <div class="game-card">
                <div class="game-header"><span class="game-title">📝 政策填空（每日5题）</span><span class="game-badge">每日一填</span></div>
                <div id="fillArea"><button id="getFillDailyBtn" class="submit-btn">开始今日填空</button><div id="fillQuestionsContainer"></div></div>
            </div>
            <div class="game-card">
                <div class="game-header"><span class="game-title">❌ 错题闯关</span><span class="game-badge">清零错题本</span></div>
                <div id="wrongArea"><button id="startWrongClearBtn" class="submit-btn">开始错题闯关</button><div id="wrongList"></div></div>
            </div>
            <div class="game-card">
                <div class="game-header"><span class="game-title">🏆 每周竞赛</span><span class="game-badge">赢取专属头像框</span></div>
                <div id="contestArea"><button id="startContestBtn" class="submit-btn">参加本周竞赛</button><div id="contestRank"></div></div>
            </div>
            <div class="game-card">
                <div class="game-header"><span class="game-title">🎫 政策刮刮乐</span><span class="game-badge">每日3次机会</span></div>
                <div id="scratchArea"><button id="getScratchBtn" class="submit-btn">刮一张</button><div id="scratchCard"></div></div>
            </div>
            <div class="game-card">
                <div class="game-header"><span class="game-title">📖 政策知多少</span><span class="game-badge">每日一测</span></div>
                <div id="policyQuizArea"><button id="startPolicyQuizBtn" class="submit-btn">开始答题</button><div id="policyQuizQuestions"></div></div>
            </div>
        </div>
    `;
    loadLevels();
    document.getElementById('createPkBtn').onclick = createPkRoom;
    document.getElementById('joinPkBtn').onclick = joinPkRoom;
    document.getElementById('getFillDailyBtn').onclick = getFillDailyQuestions;
    document.getElementById('startWrongClearBtn').onclick = startWrongClear;
    document.getElementById('startContestBtn').onclick = startWeeklyContest;
    document.getElementById('getScratchBtn').onclick = getScratchCard;
    document.getElementById('startPolicyQuizBtn').onclick = startPolicyQuiz;
}

// 填空每日5题
let currentFillQuestions = [];
let fillAnswers = [];

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
                <div class="fill-hint" style="font-size:0.8rem; color:#999; margin-top:4px;">💡 ${q.hint || '提示：根据上下文填空'}</div>
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
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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

// 政策知多少
let policyQuizQuestions = [];
let policyQuizAnswers = [];
let policyQuizCurrent = 0;

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
                        <span class="option-prefix">${String.fromCharCode(65+idx)}.</span>${escapeHtml(opt)}
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
                    message += `\n${idx+1}. ${w.question}\n   正确答案：${w.correctOption}. ${w.correctAnswer}\n   解析：${w.explanation}\n`;
                });
            }
            alert(message);
            addPoints(reward, '政策知多少');
            updateTaskProgress('quiz', 1);
            container.innerHTML = `<div style="text-align:center;padding:20px;">🎉 获得 ${reward} 积分 🎉</div>`;
            playSound('complete');
        } else {
            policyQuizCurrent++;
            showPolicyQuizQuestion();
        }
    };
}

// 政策闯关（答错给解析）
async function startLevel(levelId) {
    try {
        const res = await fetchWithAuth(`/api/quiz/level/${levelId}`);
        const questions = await res.json();
        if (!questions.length) return alert('关卡无题目');
        let currentIndex = 0;
        let answers = [];
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';
        const renderQuestion = () => {
            const q = questions[currentIndex];
            modal.innerHTML = `<div class="modal-content" style="width:500px;"><button class="modal-close">&times;</button><div class="question-text">${escapeHtml(q.question)}</div><div class="options-list">${q.options.map((opt, idx) => `<div class="option-item" data-opt="${idx}"><span class="option-prefix">${String.fromCharCode(65+idx)}.</span>${escapeHtml(opt)}</div>`).join('')}</div><div style="margin-top:20px; display:flex; justify-content:space-between;"><button id="prevBtn" class="summary-btn" ${currentIndex===0?'disabled':''}>上一题</button><button id="nextBtn" class="submit-btn">${currentIndex===questions.length-1?'提交':'下一题'}</button></div></div>`;
            const closeBtn = modal.querySelector('.modal-close');
            closeBtn.onclick = () => document.body.removeChild(modal);
            modal.onclick = (e) => { if(e.target===modal) document.body.removeChild(modal); };
            const opts = modal.querySelectorAll('.option-item');
            opts.forEach(opt => { opt.onclick = () => { const selected = parseInt(opt.dataset.opt); answers[currentIndex] = selected; opts.forEach(o => o.classList.remove('selected')); opt.classList.add('selected'); }; });
            const prevBtn = modal.querySelector('#prevBtn');
            const nextBtn = modal.querySelector('#nextBtn');
            if (prevBtn) prevBtn.onclick = () => { if(currentIndex>0) { currentIndex--; renderQuestion(); } };
            nextBtn.onclick = async () => {
                if (answers[currentIndex] === undefined) { alert('请选择答案'); return; }
                if (currentIndex === questions.length-1) {
                    const submitRes = await fetchWithAuth('/api/quiz/level/submit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ levelId, answers: questions.map((q,i)=> ({ questionId: q.id, selected: answers[i] })) }) });
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
                            if (answers[i] !== questions[i].answer) {
                                const correctOption = String.fromCharCode(65 + questions[i].answer);
                                explanationMsg += `\n${i+1}. ${questions[i].question}\n   正确答案：${correctOption}. ${questions[i].options[questions[i].answer]}\n   解析：${questions[i].explanation || '无'}\n`;
                            }
                        }
                        alert(explanationMsg);
                    }
                } else { currentIndex++; renderQuestion(); }
            };
        };
        renderQuestion();
        document.body.appendChild(modal);
    } catch(e) { alert('加载关卡失败'); }
}

// 加载关卡列表
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

// PK 相关
let currentPkRoom = null;
let pkInterval = null;

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
                startPkGame(currentPkRoom, data.questions);
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
        const res = await fetchWithAuth('/api/quiz/pk/join', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ roomCode }) });
        const data = await res.json();
        currentPkRoom = data.roomId;
        alert('加入成功，开始PK！');
        startPkGame(currentPkRoom, data.questions);
    } catch(e) { alert('加入失败'); }
}

async function startPkGame(roomId, questionIds) {
    alert('PK功能需要后端提供批量获取题目API，当前演示请使用闯关模式。实际项目中请补充/api/quiz/questions/batch接口。');
    document.getElementById('pkStatus').innerHTML = `<div class="pk-status">PK开始，请在5秒内答题（演示模式）</div>`;
}

// 刮刮乐
async function getScratchCard() {
    try {
        const res = await fetchWithAuth('/api/quiz/scratch/generate');
        const card = await res.json();
        const container = document.getElementById('scratchCard');
        container.innerHTML = `<div class="scratch-card" id="scratchSurface"><div class="scratch-cover">🎫 点击刮开涂层 🎫</div></div>`;
        const surface = document.getElementById('scratchSurface');
        surface.onclick = async () => {
            surface.innerHTML = `<div class="scratch-question"><div class="question-text">${escapeHtml(card.question)}</div><div class="scratch-options">${card.options.map((opt, idx) => `<div class="scratch-option" data-opt="${idx}">${String.fromCharCode(65+idx)}. ${escapeHtml(opt)}</div>`).join('')}</div></div>`;
            const opts = surface.querySelectorAll('.scratch-option');
            opts.forEach(opt => { opt.onclick = async () => {
                const selected = parseInt(opt.dataset.opt);
                const submitRes = await fetchWithAuth('/api/quiz/scratch/submit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ cardId: card.cardId, selected }) });
                const result = await submitRes.json();
                if (result.correct) {
                    surface.innerHTML = `<div class="scratch-reward">🎉 刮中奖励！获得 ${result.rewardPoints} 积分 🎉</div>`;
                    addPoints(result.rewardPoints, '刮刮乐');
                } else {
                    surface.innerHTML = `<div class="scratch-reward">😢 很遗憾，答案错误，下次再试试吧</div>`;
                }
            }; });
        };
    } catch(e) { alert(e.message || '获取刮刮卡失败'); }
}

// 每周竞赛
let contestTimer = null;
let contestQuestions = [];
let contestAnswers = [];
let contestStartTime = null;

async function startWeeklyContest() {
    try {
        const res = await fetchWithAuth('/api/quiz/weekly/current');
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
            modal.innerHTML = `<div class="modal-content" style="width:500px;"><button class="modal-close">&times;</button><div class="contest-header" style="background:#ff9800;color:white;"><span>每周竞赛</span><span class="contest-timer" id="contestTimer">00:00</span></div><div class="question-text">${escapeHtml(q.question)}</div><div class="options-list">${q.options.map((opt, idx) => `<div class="option-item" data-opt="${idx}"><span class="option-prefix">${String.fromCharCode(65+idx)}.</span>${escapeHtml(opt)}</div>`).join('')}</div><div style="margin-top:20px;"><button id="nextContestBtn" class="submit-btn">${current===contestQuestions.length-1?'提交':'下一题'}</button></div></div>`;
            const closeBtn = modal.querySelector('.modal-close');
            closeBtn.onclick = () => { if(contestTimer) clearInterval(contestTimer); document.body.removeChild(modal); };
            modal.onclick = (e) => { if(e.target===modal) { if(contestTimer) clearInterval(contestTimer); document.body.removeChild(modal); } };
            const opts = modal.querySelectorAll('.option-item');
            opts.forEach(opt => { opt.onclick = () => { const selected = parseInt(opt.dataset.opt); contestAnswers[current] = selected; opts.forEach(o => o.classList.remove('selected')); opt.classList.add('selected'); }; });
            const nextBtn = modal.querySelector('#nextContestBtn');
            nextBtn.onclick = async () => {
                if (contestAnswers[current] === undefined) { alert('请选择答案'); return; }
                if (current === contestQuestions.length-1) {
                    clearInterval(contestTimer);
                    const timeUsed = Math.floor((Date.now() - contestStartTime) / 1000);
                    const submitRes = await fetchWithAuth('/api/quiz/weekly/submit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ contestId: data.contestId, answers: contestQuestions.map((q,i)=> ({ questionId: q.id, selected: contestAnswers[i] })), timeUsed }) });
                    const result = await submitRes.json();
                    document.body.removeChild(modal);
                    alert(`竞赛完成！得分${result.score}/${contestQuestions.length}，获得${result.rewardPoints}积分`);
                    addPoints(result.rewardPoints, '每周竞赛');
                    const rankRes = await fetchWithAuth(`/api/quiz/weekly/rank/${data.contestId}`);
                    const ranks = await rankRes.json();
                    let rankHtml = '<h4>排行榜</h4>';
                    ranks.forEach((r, idx) => { rankHtml += `<div class="rank-item"><span class="rank-number">${idx+1}</span><span>${r.username}</span><span>${r.score}分</span><span>${r.time_used}秒</span></div>`; });
                    document.getElementById('contestRank').innerHTML = rankHtml;
                } else { current++; renderQuestion(); }
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
    } catch(e) { alert('加载竞赛失败'); }
}

// 错题闯关
async function startWrongClear() {
    try {
        const res = await fetchWithAuth('/api/quiz/wrong-questions/list');
        const wrongs = await res.json();
        if (wrongs.length === 0) { alert('暂无错题'); return; }
        let wrongAnswers = new Array(wrongs.length).fill(null);
        let current = 0;
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';
        const render = () => {
            const w = wrongs[current];
            modal.innerHTML = `<div class="modal-content" style="width:500px;"><button class="modal-close">&times;</button><div class="question-text">${escapeHtml(w.question)}</div><div class="options-list">${JSON.parse(w.options).map((opt, idx) => `<div class="option-item" data-opt="${idx}"><span class="option-prefix">${String.fromCharCode(65+idx)}.</span>${escapeHtml(opt)}</div>`).join('')}</div><div style="margin-top:20px;"><button id="nextWrongBtn" class="submit-btn">${current===wrongs.length-1?'提交':'下一题'}</button></div></div>`;
            const closeBtn = modal.querySelector('.modal-close');
            closeBtn.onclick = () => document.body.removeChild(modal);
            modal.onclick = (e) => { if(e.target===modal) document.body.removeChild(modal); };
            const opts = modal.querySelectorAll('.option-item');
            opts.forEach(opt => { opt.onclick = () => { const selected = parseInt(opt.dataset.opt); wrongAnswers[current] = selected; opts.forEach(o => o.classList.remove('selected')); opt.classList.add('selected'); }; });
            const nextBtn = modal.querySelector('#nextWrongBtn');
            nextBtn.onclick = async () => {
                if (wrongAnswers[current] === undefined) { alert('请选择答案'); return; }
                if (current === wrongs.length-1) {
                    const submitRes = await fetchWithAuth('/api/quiz/wrong-questions/clear', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ answers: wrongs.map((w,i)=> ({ questionId: w.question_id, selected: wrongAnswers[i] })) }) });
                    const result = await submitRes.json();
                    document.body.removeChild(modal);
                    if (result.cleared) {
                        alert(`恭喜！错题本清零，获得50积分`);
                        addPoints(50, '错题清零');
                    } else {
                        alert('有题目答错，未能清零，请重试');
                    }
                } else { current++; render(); }
            };
        };
        render();
        document.body.appendChild(modal);
    } catch(e) { alert('加载错题失败'); }
}

// 全局函数暴露
window.sendMessage = sendMessage;
window.createSession = createSession;
window.switchSession = switchSession;
window.deleteSession = deleteSession;
window.toggleSessionFavorite = toggleSessionFavorite;
window.toggleMessageFavorite = toggleMessageFavorite;
window.regenerateAnswer = regenerateAnswer;
window.showKnowledgeDetail = showKnowledgeDetail;
window.showUploadModal = showUploadModal;
window.showPolicyQuickSearch = showPolicyQuickSearch;
window.startLevel = startLevel;
window.createPkRoom = createPkRoom;
window.joinPkRoom = joinPkRoom;
window.getFillDailyQuestions = getFillDailyQuestions;
window.startWrongClear = startWrongClear;
window.startWeeklyContest = startWeeklyContest;
window.getScratchCard = getScratchCard;
window.startPolicyQuiz = startPolicyQuiz;