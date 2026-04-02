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
let voiceBtn;

// 语音识别相关
let recognition = null;
let isRecording = false;

// DOM 元素
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
const navKnowledge = document.getElementById('navKnowledge');
const navProfile = document.getElementById('navProfile');

// 辅助函数
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  }).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, function(c) {
    return c;
  });
}

// ==================== token 刷新与统一请求 ====================
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
    } catch (e) {
      console.error('刷新token失败', e);
    }
    return false;
  })();
  const result = await refreshPromise;
  refreshPromise = null;
  return result;
}

async function fetchWithAuth(url, options = {}) {
  const currentToken = localStorage.getItem('token');
  if (!currentToken) {
    showAuth();
    throw new Error('未登录');
  }
  let res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${currentToken}`
    }
  });
  if (res.status === 401) {
    const refreshed = await refreshToken();
    if (refreshed) {
      const newToken = localStorage.getItem('token');
      res = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          'Authorization': `Bearer ${newToken}`
        }
      });
    } else {
      localStorage.removeItem('token');
      showAuth();
      throw new Error('登录已过期，请重新登录');
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
  } catch {
    localStorage.removeItem('token');
    showAuth();
  }
} else {
  showAuth();
}

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
  } catch (err) {
    loginError.textContent = err.message;
  }
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
  } catch (err) {
    registerError.textContent = err.message;
  }
});

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('token');
  showAuth();
});

// ==================== 应用核心功能 ====================
async function initApp() {
  token = localStorage.getItem('token');
  await loadSessions();
  await loadMessageFavorites();
  if (sessions.length > 0) {
    await switchSession(sessions[0].id);
  } else {
    await createSession();
  }
  await loadKnowledge('all', 'all');
  setupSessionTabs();
  setupNavigation();

  // 全局事件委托（保留原有）
  dynamicContent.addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('start-simulate')) {
      const card = target.closest('.scenario-card');
      if (card) {
        const scenarioId = card.dataset.id;
        startSimulate(scenarioId);
      }
    } else if (target.id === 'policyQuickSearch' || target.id === 'policyQuickSearchBtn') {
      showPolicyQuickSearch();
    }
  });

  newSessionBtn.onclick = () => createSession();

  window.addEventListener('beforeunload', () => {
    if (recognition) {
      try { recognition.abort(); } catch (e) {}
    }
  });
}

function setInputEnabled(enabled) {
  const userInput = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');
  const voiceBtn = document.getElementById('voiceBtn');
  const simulateInput = document.getElementById('simulateInput');
  const simulateSendBtn = document.getElementById('simulateSendBtn');
  const finishBtn = document.getElementById('finishSimulateBtn');
  if (userInput) userInput.disabled = !enabled;
  if (sendBtn) sendBtn.disabled = !enabled;
  if (voiceBtn) voiceBtn.disabled = !enabled;
  if (simulateInput) simulateInput.disabled = !enabled;
  if (simulateSendBtn) simulateSendBtn.disabled = !enabled;
  if (finishBtn) finishBtn.disabled = !enabled;
  if (enabled) {
    if (userInput) userInput.focus();
    else if (simulateInput) simulateInput.focus();
  }
}

async function loadSessions() {
  const res = await fetchWithAuth('/api/sessions');
  if (!res.ok) throw new Error('加载会话失败');
  let sessionsData = await res.json();
  if (!Array.isArray(sessionsData)) sessionsData = [];
  sessionsData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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
  if (!sessions || !Array.isArray(sessions)) {
    sessionListDiv.innerHTML = '<div class="empty">暂无会话</div>';
    return;
  }
  sessionListDiv.innerHTML = '';
  const filteredSessions = currentFilter === 'all' ? sessions : sessions.filter(s => s.favorite);
  filteredSessions.forEach(session => {
    if (!session) return;
    const item = document.createElement('div');
    item.className = `session-item ${session.id === currentSessionId ? 'active' : ''}`;
    item.dataset.id = session.id;
    const titleSpan = document.createElement('span');
    titleSpan.className = 'session-title';
    titleSpan.textContent = session.title || '新会话';
    item.appendChild(titleSpan);
    const favoriteBtn = document.createElement('button');
    favoriteBtn.className = `favorite-btn ${session.favorite ? 'favorited' : ''}`;
    favoriteBtn.innerHTML = session.favorite ? '★' : '☆';
    favoriteBtn.title = session.favorite ? '取消收藏' : '收藏';
    favoriteBtn.onclick = (e) => {
      e.stopPropagation();
      toggleSessionFavorite(session.id, !session.favorite);
    };
    item.appendChild(favoriteBtn);
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-session';
    deleteBtn.innerHTML = '✕';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deleteSession(session.id);
    };
    item.appendChild(deleteBtn);
    item.addEventListener('click', () => switchSession(session.id));
    sessionListDiv.appendChild(item);
  });
}

function renderMessageFavoriteList() {
  messageFavoriteList.innerHTML = '';
  if (messageFavorites.length === 0) {
    messageFavoriteList.innerHTML = '<div class="empty">暂无收藏的消息</div>';
    return;
  }
  messageFavorites.forEach(fav => {
    const item = document.createElement('div');
    item.className = 'favorite-message-item';
    item.dataset.sessionId = fav.sessionId;
    item.dataset.messageId = fav.messageId;
    item.innerHTML = `
      <div class="session-title">📁 ${escapeHtml(fav.sessionTitle || '未命名会话')}</div>
      <div class="message-preview">${escapeHtml(fav.content.substring(0, 50))}${fav.content.length > 50 ? '...' : ''}</div>
      <div class="meta">
        <span>${fav.role === 'user' ? '👤' : '🤖'}</span>
        <span>${new Date(fav.favoritedAt).toLocaleString()}</span>
      </div>
    `;
    item.addEventListener('click', () => {
      switchToMessage(fav.sessionId, fav.messageId);
    });
    messageFavoriteList.appendChild(item);
  });
}

async function toggleSessionFavorite(sessionId, favorite) {
  if (isTyping) return;
  try {
    const res = await fetchWithAuth(`/api/session/${sessionId}/favorite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite })
    });
    if (!res.ok) throw new Error('操作失败');
    const session = sessions.find(s => s.id === sessionId);
    if (session) session.favorite = favorite;
    renderSessionList();
  } catch (err) {
    alert('收藏操作失败：' + err.message);
  }
}

async function toggleMessageFavorite(messageId, action) {
  try {
    const res = await fetchWithAuth('/api/user/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, action })
    });
    if (!res.ok) throw new Error('操作失败');
    await loadMessageFavorites();
    if (messageFavoriteList.style.display !== 'none') {
      renderMessageFavoriteList();
    }
  } catch (err) {
    alert('消息收藏操作失败：' + err.message);
  }
}

async function switchToMessage(sessionId, messageId) {
  if (isTyping) return;
  await switchSession(sessionId);
  setTimeout(() => {
    const msgElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
    if (msgElement) {
      msgElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgElement.style.backgroundColor = '#fff3cd';
      setTimeout(() => msgElement.style.backgroundColor = '', 2000);
    }
  }, 500);
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
    [navChat, navSimulate, navKnowledge, navProfile].forEach(btn => btn.classList.remove('active'));
    navSimulate.classList.add('active');
    renderSimulateChat(session);
  } else {
    if (currentView !== 'chat') {
      currentView = 'chat';
      [navChat, navSimulate, navKnowledge, navProfile].forEach(btn => btn.classList.remove('active'));
      navChat.classList.add('active');
      renderChatView(session);
    } else {
      renderSessionList();
      displayMessages(session.messages);
      updateInfoPanelFromMessages(session.messages); // 异步，不等待
    }
  }
}

function displayMessages(messages) {
  const messagesDiv = document.getElementById('messages');
  if (!messagesDiv) return;
  if (!messages || !Array.isArray(messages)) {
    messagesDiv.innerHTML = '';
    return;
  }
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

// ==================== 右侧信息提取面板（智能摘要） ====================
async function updateInfoPanelFromMessages(messages) {
  const infoContent = document.getElementById('infoContent');
  if (!infoContent) return;

  if (!messages || messages.length === 0) {
    infoContent.innerHTML = '<div style="color:#888;">📭 暂无对话记录，提问后会自动提取要点。</div>';
    return;
  }

  // 显示加载状态
  infoContent.innerHTML = '<div style="color:#888;">🤖 正在分析对话要点...</div>';

  // 重试机制
  let retries = 2;
  let success = false;

  while (retries >= 0 && !success) {
    try {
      const res = await fetchWithAuth('/api/chat/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messages.slice(-20) })
      });
      const data = await res.json();
      const summary = data.summary || { points: [], status: '', reasons: [], suggestions: [], references: [] };

      // 构建 HTML
      let html = '<div style="font-size:0.9rem;">';

      if (summary.points && summary.points.length) {
        html += '<div style="margin-bottom:12px;"><strong>📌 问题要点</strong><ul style="margin:5px 0 0 20px;">';
        summary.points.forEach(p => { html += `<li>${escapeHtml(p)}</li>`; });
        html += '</ul></div>';
      }
      if (summary.status) {
        html += `<div style="margin-bottom:12px;"><strong>📋 现状</strong><div style="margin-top:4px;">${escapeHtml(summary.status)}</div></div>`;
      }
      if (summary.reasons && summary.reasons.length) {
        html += '<div style="margin-bottom:12px;"><strong>🔍 原因分析</strong><ul style="margin:5px 0 0 20px;">';
        summary.reasons.forEach(r => { html += `<li>${escapeHtml(r)}</li>`; });
        html += '</ul></div>';
      }
      if (summary.suggestions && summary.suggestions.length) {
        html += '<div style="margin-bottom:12px;"><strong>💡 建议</strong><ul style="margin:5px 0 0 20px;">';
        summary.suggestions.forEach(s => { html += `<li>${escapeHtml(s)}</li>`; });
        html += '</ul></div>';
      }
      if (summary.references && summary.references.length) {
        html += '<div style="margin-bottom:12px;"><strong>📚 参考案例/政策</strong><ul style="margin:5px 0 0 20px;">';
        summary.references.forEach(ref => { html += `<li>${escapeHtml(ref)}</li>`; });
        html += '</ul></div>';
      }

      html += '</div>';
      infoContent.innerHTML = html;
      success = true;
    } catch (err) {
      console.error('获取摘要失败，剩余重试次数:', retries, err);
      retries--;
      if (retries < 0) {
        infoContent.innerHTML = '<div style="color:#888;">⚠️ 摘要生成失败，请稍后重试。</div>';
      } else {
        // 等待 1 秒后重试
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
}

// ==================== 知识库功能 ====================
async function loadKnowledge(type = 'all', category = 'all') {
  let url = '/api/knowledge';
  const params = [];
  if (type !== 'all') params.push(`type=${encodeURIComponent(type)}`);
  if (category !== 'all') params.push(`category=${encodeURIComponent(category)}`);
  if (params.length) url += '?' + params.join('&');
  try {
    const res = await fetchWithAuth(url);
    knowledgeData = await res.json();
    renderKnowledgeList(knowledgeData);
  } catch (err) {
    console.error('加载知识库失败', err);
  }
}

function renderKnowledgeList(data) {
  const knowledgeList = document.getElementById('knowledgeList');
  if (!knowledgeList) return;
  knowledgeList.innerHTML = '';
  if (data.length === 0) {
    knowledgeList.innerHTML = '<div class="empty">暂无数据</div>';
    return;
  }
  data.forEach(item => {
    let tagsArray = [];
    if (item.tags) {
      if (Array.isArray(item.tags)) tagsArray = item.tags;
      else if (typeof item.tags === 'string') tagsArray = item.tags.split(',').map(t => t.trim());
    }
    const div = document.createElement('div');
    div.className = 'knowledge-item';
    div.innerHTML = `
      <div class="title">
        <span>${escapeHtml(item.title)}</span>
        <span class="type">${item.type} · ${item.category}</span>
      </div>
      <div class="content-preview">${escapeHtml(item.content.substring(0, 100))}...</div>
      <div class="tags">
        ${tagsArray.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
      </div>
    `;
    div.addEventListener('click', () => showKnowledgeDetail(item));
    knowledgeList.appendChild(div);
  });
}

function showKnowledgeDetail(item) {
  let tagsArray = [];
  if (item.tags) {
    if (Array.isArray(item.tags)) tagsArray = item.tags;
    else if (typeof item.tags === 'string') tagsArray = item.tags.split(',').map(t => t.trim());
  }
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content">
      <button class="modal-close">&times;</button>
      <div class="modal-title">${escapeHtml(item.title)}</div>
      <div class="modal-type">${item.type} · ${item.category}</div>
      <div class="modal-content-body">${escapeHtml(item.content)}</div>
      <div class="modal-tags">
        ${tagsArray.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
      </div>
    </div>
  `;
  modal.querySelector('.modal-close').addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) document.body.removeChild(modal);
  });
  document.body.appendChild(modal);
}

function showUploadModal() {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content" style="width: 500px;">
      <button class="modal-close">&times;</button>
      <h3>上传新知识</h3>
      <form id="uploadForm">
        <div style="margin-bottom: 10px;">
          <label>标题：</label><br>
          <input type="text" name="title" required style="width: 100%; padding: 5px;">
        </div>
        <div style="margin-bottom: 10px;">
          <label>内容：</label><br>
          <textarea name="content" rows="5" required style="width: 100%; padding: 5px;"></textarea>
        </div>
        <div style="margin-bottom: 10px;">
          <label>专题：</label><br>
          <select name="type" required style="width: 100%; padding: 5px;">
            <option value="">请选择</option>
            <option value="土地管理">土地管理</option>
            <option value="产业发展">产业发展</option>
            <option value="民生保障">民生保障</option>
            <option value="矛盾纠纷">矛盾纠纷</option>
            <option value="基层治理">基层治理</option>
            <option value="项目申报">项目申报</option>
            <option value="生态环保">生态环保</option>
            <option value="乡村建设">乡村建设</option>
            <option value="创业就业">创业就业</option>
            <option value="政策法规">政策法规</option>
          </select>
        </div>
        <div style="margin-bottom: 10px;">
          <label>类型：</label><br>
          <select name="category" required style="width: 100%; padding: 5px;">
            <option value="">请选择</option>
            <option value="政策">政策</option>
            <option value="案例">案例</option>
            <option value="常见问题">常见问题</option>
          </select>
        </div>
        <div style="margin-bottom: 10px;">
          <label>标签（逗号分隔）：</label><br>
          <input type="text" name="tags" placeholder="例如：宅基地, 民宿" style="width: 100%; padding: 5px;">
        </div>
        <div style="text-align: right;">
          <button type="submit" style="background: #2e5d34; color: white; padding: 8px 16px; border: none; border-radius: 4px;">提交</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.modal-close').addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) document.body.removeChild(modal);
  });
  const form = modal.querySelector('#uploadForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const data = {
      title: formData.get('title'),
      content: formData.get('content'),
      type: formData.get('type'),
      category: formData.get('category'),
      tags: formData.get('tags')
    };
    try {
      const res = await fetchWithAuth('/api/knowledge/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('上传失败');
      alert('上传成功，待管理员审核后即可显示。');
      document.body.removeChild(modal);
    } catch (err) {
      alert('上传失败：' + err.message);
    }
  });
}

// ==================== 会话列表标签页 ====================
function setupSessionTabs() {
  allSessionsTab.addEventListener('click', () => {
    allSessionsTab.classList.add('active');
    favoritesTab.classList.remove('active');
    messageFavoritesTab.classList.remove('active');
    currentFilter = 'all';
    sessionListDiv.style.display = 'block';
    messageFavoriteList.style.display = 'none';
    renderSessionList();
  });
  favoritesTab.addEventListener('click', () => {
    favoritesTab.classList.add('active');
    allSessionsTab.classList.remove('active');
    messageFavoritesTab.classList.remove('active');
    currentFilter = 'favorites';
    sessionListDiv.style.display = 'block';
    messageFavoriteList.style.display = 'none';
    renderSessionList();
  });
  messageFavoritesTab.addEventListener('click', () => {
    messageFavoritesTab.classList.add('active');
    allSessionsTab.classList.remove('active');
    favoritesTab.classList.remove('active');
    sessionListDiv.style.display = 'none';
    messageFavoriteList.style.display = 'block';
    renderMessageFavoriteList();
  });
}

// ==================== 语音识别 ====================
function setupVoiceRecognition() {
  const voiceBtnElement = document.getElementById('voiceBtn');
  if (!voiceBtnElement) {
    console.warn('语音按钮未找到，跳过初始化');
    return;
  }
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    console.warn('当前浏览器不支持语音识别');
    voiceBtnElement.disabled = true;
    voiceBtnElement.title = '浏览器不支持语音识别';
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map(result => result[0].transcript)
      .join('');
    const userInput = document.getElementById('userInput');
    const simulateInput = document.getElementById('simulateInput');
    if (userInput) userInput.value = transcript;
    if (simulateInput) simulateInput.value = transcript;
  };
  recognition.onerror = (event) => {
    console.error('语音识别错误', event.error);
    isRecording = false;
    if (voiceBtnElement) {
      voiceBtnElement.style.background = '#4a90e2';
      voiceBtnElement.textContent = '🎤';
    }
  };
  recognition.onend = () => {
    isRecording = false;
    if (voiceBtnElement) {
      voiceBtnElement.style.background = '#4a90e2';
      voiceBtnElement.textContent = '🎤';
    }
  };
  voiceBtnElement.removeEventListener('mousedown', voiceMouseDown);
  voiceBtnElement.removeEventListener('mouseup', voiceMouseUp);
  voiceBtnElement.removeEventListener('mouseleave', voiceMouseLeave);
  function voiceMouseDown() {
    if (isRecording) return;
    try {
      recognition.start();
      isRecording = true;
      voiceBtnElement.style.background = '#d32f2f';
      voiceBtnElement.textContent = '🔴';
    } catch (e) {
      console.error('启动语音识别失败', e);
    }
  }
  function voiceMouseUp() {
    if (isRecording) recognition.stop();
  }
  function voiceMouseLeave() {
    if (isRecording) recognition.stop();
  }
  voiceBtnElement.addEventListener('mousedown', voiceMouseDown);
  voiceBtnElement.addEventListener('mouseup', voiceMouseUp);
  voiceBtnElement.addEventListener('mouseleave', voiceMouseLeave);
}

// ==================== 导航切换 ====================
function setupNavigation() {
  navChat.addEventListener('click', async () => {
    await switchView('chat');
  });
  navSimulate.addEventListener('click', () => {
    switchView('simulate');
  });
  navKnowledge.addEventListener('click', () => {
    switchView('knowledge');
  });
  navProfile.addEventListener('click', () => {
    switchView('profile');
  });
}

async function ensureChatSession() {
  if (currentSessionId) {
    const session = sessions.find(s => s.id === currentSessionId);
    if (session && session.type === 'chat') return;
  }
  const chatSession = sessions.find(s => s.type === 'chat');
  if (chatSession) {
    await switchSession(chatSession.id);
    return;
  }
  await createSession();
}

async function switchView(view) {
  currentView = view;
  [navChat, navSimulate, navKnowledge, navProfile].forEach(btn => btn.classList.remove('active'));
  if (view === 'chat') {
    navChat.classList.add('active');
    await ensureChatSession();
    renderChatView();
  } else if (view === 'simulate') {
    navSimulate.classList.add('active');
    renderSimulateView();
  } else if (view === 'knowledge') {
    navKnowledge.classList.add('active');
    renderKnowledgeView();
  } else if (view === 'profile') {
    navProfile.classList.add('active');
    renderProfileView();
  }
}

// ==================== 渲染问答视图 ====================
function renderChatView(existingSession = null) {
  dynamicContent.innerHTML = `
    <div class="chat-view">
      <div class="chat-area">
        <div class="chat-header">
          <div>
            <h1 id="currentSessionTitle">村官AI伙伴</h1>
          </div>
          <div>
            <button id="exportBtn" class="summary-btn">📥 导出对话</button>
            <button id="policyQuickSearch" class="summary-btn" style="margin-left: 8px;">📜 政策速查</button>
          </div>
        </div>
        <div id="chatContainer" class="chat-container">
          <div id="messages"></div>
          <div id="typingIndicator" class="hidden">AI正在思考...</div>
        </div>
        <footer class="chat-footer">
          <div class="input-tip">💡 提示：输入"联网搜索"可获取最新政策信息。按住麦克风可语音输入。</div>
          <div class="preset-questions">
            <button class="preset-btn" data-question="村里闲置小学可以改造成什么？">🏫 闲置小学改造</button>
            <button class="preset-btn" data-question="土地流转合同要注意哪些条款？">📄 土地流转合同</button>
            <button class="preset-btn" data-question="如何申请高标准农田项目？">🌾 申请高标准农田</button>
            <button class="preset-btn" data-question="村民不配合垃圾分类怎么办？">🗑️ 垃圾分类推进</button>
            <button class="preset-btn" data-question="想发展民宿，需要办哪些手续？">🏠 发展民宿手续</button>
          </div>
          <div class="input-area">
            <textarea id="userInput" placeholder="输入你的问题..." rows="2"></textarea>
            <button id="voiceBtn" class="voice-btn" title="按住说话">🎤</button>
            <button id="sendBtn">发送</button>
          </div>
        </footer>
      </div>
      <div class="info-panel" id="infoPanel">
        <h3>📋 信息提取</h3>
        <div id="infoContent" class="info-content"></div>
      </div>
    </div>
  `;

  const messagesDiv = document.getElementById('messages');
  const userInput = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');
  const typingIndicator = document.getElementById('typingIndicator');
  const currentSessionTitle = document.getElementById('currentSessionTitle');
  const exportBtn = document.getElementById('exportBtn');

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      userInput.value = btn.dataset.question;
      sendMessage();
    });
  });

  sendBtn.addEventListener('click', sendMessage);
  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isTyping) {
      e.preventDefault();
      sendMessage();
    }
  });
  exportBtn.addEventListener('click', exportCurrentChat);
  setupVoiceRecognition();

  if (currentSessionId && !existingSession) {
    fetchWithAuth(`/api/session/${currentSessionId}`).then(res => res.json()).then(session => {
      if (!session.messages) session.messages = [];
      currentSessionTitle.textContent = session.title || '村官AI伙伴';
      displayMessages(session.messages);
      updateInfoPanelFromMessages(session.messages);
    });
  } else if (existingSession) {
    if (!existingSession.messages) existingSession.messages = [];
    currentSessionTitle.textContent = existingSession.title || '村官AI伙伴';
    displayMessages(existingSession.messages);
    updateInfoPanelFromMessages(existingSession.messages);
  }
}

async function exportCurrentChat() {
  if (!currentSessionId) return;
  const res = await fetchWithAuth(`/api/session/${currentSessionId}`);
  const session = await res.json();
  if (!session.messages || !session.messages.length) {
    alert('暂无对话内容');
    return;
  }
  let text = `会话：${session.title}\n时间：${new Date(session.createdAt).toLocaleString()}\n\n`;
  session.messages.forEach(msg => {
    text += `${msg.role === 'user' ? '👤 村官' : '🤖 AI伙伴'}：${msg.content}\n\n`;
  });
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `会话_${session.title}_${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ==================== 模拟对练视图 ====================
function renderSimulateView(forceList = false) {
  if (forceList || !currentSessionId || sessions.find(s => s.id === currentSessionId)?.type !== 'simulate') {
    fetchWithAuth('/api/simulate/scenarios')
      .then(res => res.json())
      .then(scenarios => {
        if (scenarios.length === 0) {
          dynamicContent.innerHTML = '<div class="scenarios-list"><p>暂无模拟场景，请联系管理员添加。</p></div>';
          return;
        }
        let html = '<div class="scenarios-list"><h2>选择模拟场景</h2>';
        scenarios.forEach(s => {
          html += `
            <div class="scenario-card" data-id="${s.id}">
              <h3>${escapeHtml(s.title)}</h3>
              <p>${escapeHtml(s.description)}</p>
              <p><strong>目标：</strong>${escapeHtml(s.goal)}</p>
              <p><strong>角色：</strong>${escapeHtml(s.role)}</p>
              <button class="start-simulate">开始对练</button>
            </div>
          `;
        });
        html += '</div>';
        dynamicContent.innerHTML = html;
      })
      .catch(err => {
        dynamicContent.innerHTML = '<p>加载场景失败：' + err.message + '</p>';
      });
    return;
  }

  fetchWithAuth(`/api/session/${currentSessionId}`)
    .then(res => res.json())
    .then(session => {
      if (!session.messages) session.messages = [];
      renderSimulateChat(session);
    })
    .catch(err => {
      dynamicContent.innerHTML = '<p>加载会话失败：' + err.message + '</p>';
    });
}

async function startSimulate(scenarioId) {
  try {
    const res = await fetchWithAuth('/api/simulate/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '创建会话失败');
    const sessionRes = await fetchWithAuth(`/api/session/${data.sessionId}`);
    const session = await sessionRes.json();
    if (!session.messages) session.messages = [];
    sessions.push(session);
    renderSessionList();
    currentSessionId = data.sessionId;
    currentView = 'simulate';
    [navChat, navSimulate, navKnowledge, navProfile].forEach(btn => btn.classList.remove('active'));
    navSimulate.classList.add('active');
    renderSimulateChat(session);
  } catch (err) {
    alert('启动对练失败：' + err.message);
  }
}

function renderSimulateChat(session) {
  fetchWithAuth('/api/simulate/scenarios')
    .then(res => res.json())
    .then(scenarios => {
      const scenario = scenarios.find(s => s.id === session.scenarioId);
      if (!scenario) {
        dynamicContent.innerHTML = `
          <div class="simulate-view" style="padding: 20px;">
            <h3>场景数据不存在</h3>
            <p>无法找到对应的模拟场景，可能已被删除。</p>
            <button id="backToScenarios" class="summary-btn">返回场景列表</button>
          </div>
        `;
        const backBtn = document.getElementById('backToScenarios');
        if (backBtn) backBtn.onclick = () => renderSimulateView(true);
        return;
      }

      let report = null;
      for (const msg of session.messages) {
        if (msg.role === 'system' && msg.content.startsWith('report:')) {
          try {
            report = JSON.parse(msg.content.substring(7));
          } catch (e) {}
          break;
        }
      }

      let reportHtml = '';
      if (report) {
        const scoresHtml = Object.entries(report.scores || {}).map(([dim, score]) =>
          `<div class="score-item">${dim}: ${'⭐'.repeat(score)} (${score}/5)</div>`
        ).join('');
        reportHtml = `
          <div class="report-section">
            <h4>评估报告</h4>
            <div class="scores">${scoresHtml}</div>
            <p><strong>建议：</strong>${escapeHtml(report.suggestions || '')}</p>
            <button id="backToScenariosFromReport" class="summary-btn" style="margin-top:10px;">返回场景列表</button>
          </div>
        `;
      }

      dynamicContent.innerHTML = `
        <div class="simulate-view">
          <div class="simulate-header">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h2>${escapeHtml(scenario.title)}</h2>
              <button id="backToListBtn" class="summary-btn">← 返回场景列表</button>
            </div>
            <p><strong>目标：</strong>${escapeHtml(scenario.goal)}</p>
            <p><strong>当前角色：</strong>${escapeHtml(scenario.role)}</p>
            <button id="finishSimulateBtn" class="summary-btn" ${report ? 'disabled' : ''}>结束对练并查看报告</button>
          </div>
          <div class="chat-container" id="simulateMessagesContainer">
            <div id="simulateMessages"></div>
            <div id="simulateTyping" class="hidden">对方正在思考...</div>
          </div>
          ${reportHtml}
          <footer class="chat-footer" ${report ? 'style="display:none;"' : ''}>
            <div class="input-area">
              <textarea id="simulateInput" placeholder="输入你的回应..." rows="2"></textarea>
              <button id="simulateSendBtn">发送</button>
            </div>
          </footer>
        </div>
      `;

      const backToListBtn = document.getElementById('backToListBtn');
      if (backToListBtn) backToListBtn.onclick = () => renderSimulateView(true);
      const backFromReport = document.getElementById('backToScenariosFromReport');
      if (backFromReport) backFromReport.onclick = () => renderSimulateView(true);

      const simulateMessagesDiv = document.getElementById('simulateMessages');
      const simulateInput = document.getElementById('simulateInput');
      const simulateSendBtn = document.getElementById('simulateSendBtn');
      const finishBtn = document.getElementById('finishSimulateBtn');
      const simulateTyping = document.getElementById('simulateTyping');

      session.messages.forEach(msg => {
        if (msg.role === 'system') return;
        const role = msg.role === 'user' ? 'user' : 'assistant';
        const msgDiv = createMessageElement(role, msg.content, msg.messageId);
        simulateMessagesDiv.appendChild(msgDiv);
      });
      scrollSimulateToBottom();

      if (simulateSendBtn) {
        const newSendBtn = simulateSendBtn.cloneNode(true);
        simulateSendBtn.parentNode.replaceChild(newSendBtn, simulateSendBtn);
        newSendBtn.addEventListener('click', async () => {
          const text = simulateInput.value.trim();
          if (!text || isTyping) return;
          simulateInput.value = '';
          const userMsgDiv = createMessageElement('user', text, null);
          simulateMessagesDiv.appendChild(userMsgDiv);
          scrollSimulateToBottom();
          isTyping = true;
          simulateTyping.classList.remove('hidden');
          setInputEnabled(false);
          try {
            const res = await fetchWithAuth('/api/simulate/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: session.id, message: text })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '发送失败');
            simulateTyping.classList.add('hidden');
            const assistantMsgDiv = createMessageElement('assistant', data.reply, data.messageId);
            simulateMessagesDiv.appendChild(assistantMsgDiv);
            scrollSimulateToBottom();
          } catch (err) {
            alert('发送失败：' + err.message);
          } finally {
            isTyping = false;
            setInputEnabled(true);
          }
        });
      }

      if (finishBtn && !report) {
        const newFinishBtn = finishBtn.cloneNode(true);
        finishBtn.parentNode.replaceChild(newFinishBtn, finishBtn);
        newFinishBtn.addEventListener('click', async () => {
          if (isTyping) return;
          newFinishBtn.disabled = true;
          try {
            const res = await fetchWithAuth('/api/simulate/finish', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: session.id })
            });
            const reportData = await res.json();
            if (!res.ok) throw new Error(reportData.error || '生成报告失败');
            const sessionRes = await fetchWithAuth(`/api/session/${session.id}`);
            const updatedSession = await sessionRes.json();
            if (!updatedSession.messages) updatedSession.messages = [];
            const index = sessions.findIndex(s => s.id === session.id);
            if (index !== -1) sessions[index] = updatedSession;
            renderSessionList();
            renderSimulateChat(updatedSession);
          } catch (err) {
            alert('生成报告失败：' + err.message);
            newFinishBtn.disabled = false;
          }
        });
      }
    })
    .catch(err => {
      dynamicContent.innerHTML = '<p>加载场景详情失败：' + err.message + '</p>';
    });
}

function scrollSimulateToBottom() {
  const container = document.getElementById('simulateMessagesContainer');
  if (container) container.scrollTop = container.scrollHeight;
}

// ==================== 渲染知识库视图 ====================
function renderKnowledgeView() {
  dynamicContent.innerHTML = `
    <div class="knowledge-view">
      <div class="knowledge-filters">
        <button class="filter-btn active" data-type="all">全部</button>
        <button class="filter-btn" data-type="土地管理">土地管理</button>
        <button class="filter-btn" data-type="产业发展">产业发展</button>
        <button class="filter-btn" data-type="民生保障">民生保障</button>
        <button class="filter-btn" data-type="矛盾纠纷">矛盾纠纷</button>
        <button class="filter-btn" data-type="基层治理">基层治理</button>
        <button class="filter-btn" data-type="项目申报">项目申报</button>
        <button class="filter-btn" data-type="生态环保">生态环保</button>
        <button class="filter-btn" data-type="乡村建设">乡村建设</button>
        <button class="filter-btn" data-type="创业就业">创业就业</button>
        <button class="filter-btn" data-type="政策法规">政策法规</button>
      </div>
      <div class="knowledge-category-filters" style="margin-top: 8px;">
        <button class="category-filter active" data-category="all">全部</button>
        <button class="category-filter" data-category="政策">政策</button>
        <button class="category-filter" data-category="案例">案例</button>
        <button class="category-filter" data-category="常见问题">常见问题</button>
      </div>
      <div style="text-align: right; margin: 8px 0;">
        <button id="uploadKnowledgeBtn" class="new-session" style="background: #2e5d34; color: white;">+ 上传知识</button>
        <button id="policyQuickSearchBtn" class="new-session" style="background: #2e5d34; color: white; margin-left: 8px;">📜 政策速查</button>
      </div>
      <div id="knowledgeList" class="knowledge-list"></div>
    </div>
  `;

  const filterBtns = document.querySelectorAll('.filter-btn');
  const categoryFilters = document.querySelectorAll('.category-filter');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const type = btn.dataset.type;
      currentFilter = type;
      loadKnowledge(type, currentCategoryFilter);
    });
  });
  categoryFilters.forEach(btn => {
    btn.addEventListener('click', () => {
      categoryFilters.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const category = btn.dataset.category;
      currentCategoryFilter = category;
      loadKnowledge(currentFilter, category);
    });
  });
  document.getElementById('uploadKnowledgeBtn').addEventListener('click', showUploadModal);
  document.getElementById('policyQuickSearchBtn').addEventListener('click', showPolicyQuickSearch);
  loadKnowledge(currentFilter, currentCategoryFilter);
}

// ==================== 政策速查功能 ====================
// ==================== 政策速查（增强版） ====================
// 从当前对话中提取关键词作为“猜你想搜”
function getSuggestKeywordsFromChat() {
  if (currentView !== 'chat' || !currentSessionId) return [];

  // 从 sessions 中找到当前会话
  const session = sessions.find(s => s.id === currentSessionId);
  if (!session || !session.messages) return [];

  // 获取最近5条用户消息
  const userMessages = session.messages.filter(m => m.role === 'user').slice(-5);
  if (userMessages.length === 0) return [];

  // 简单提取关键词（去停用词）
  const stopwords = ['的', '了', '是', '在', '我', '你', '什么', '怎么', '如何', '为什么', '哪', '这', '那', '吗', '呢', '吧', '啊', '哦', '嗯', '呀', '有', '没有', '不', '也', '都', '和', '与', '或', '但', '而', '却', '就', '才', '只', '还', '要', '会', '能', '可以', '应该', '可能', '一定', '非常', '很', '太', '更', '最', '的', '地', '得'];
  const extractKeywords = (text) => {
    const words = text.split(/[，,。？?！!、\s]+/).filter(w => w.length > 1 && !stopwords.includes(w));
    return [...new Set(words.slice(0, 5))];
  };

  let allKeywords = [];
  userMessages.forEach(msg => {
    const kw = extractKeywords(msg.content);
    allKeywords.push(...kw);
  });

  // 去重，并限制数量
  const uniqueKeywords = [...new Set(allKeywords)].slice(0, 6);
  return uniqueKeywords;
}

// 政策速查主函数（自定义模态框）
async function showPolicyQuickSearch() {
  // 判断当前视图
  const isChatView = (currentView === 'chat');

  // 生成建议词（仅在问答视图）
  let suggestKeywords = [];
  if (isChatView) {
    suggestKeywords = getSuggestKeywordsFromChat();
  }

  // 创建模态框
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';

  // 构建内部 HTML
  let suggestHtml = '';
  if (suggestKeywords.length > 0) {
    suggestHtml = `
      <div style="margin-top: 12px;">
        <div style="font-size: 0.85rem; color: #666; margin-bottom: 6px;">🔍 猜你想搜：</div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${suggestKeywords.map(k => `<button class="suggest-tag" data-keyword="${escapeHtml(k)}" style="background: #f0f0f0; border: none; padding: 4px 12px; border-radius: 20px; cursor: pointer; font-size: 0.85rem;">${escapeHtml(k)}</button>`).join('')}
        </div>
      </div>
    `;
  }

  modal.innerHTML = `
    <div class="modal-content" style="width: 400px;">
      <button class="modal-close" style="position: absolute; right: 12px; top: 12px;">&times;</button>
      <h3 style="margin-top: 0;">📜 政策速查</h3>
      <p style="margin-bottom: 12px; color: #666;">输入关键词查询相关政策、案例</p>
      <input type="text" id="policySearchInput" placeholder="请输入关键词..." style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem;">
      ${suggestHtml}
      <div style="margin-top: 16px; text-align: right;">
        <button id="policySearchCancel" style="background: #ccc; color: #333; padding: 6px 16px; border: none; border-radius: 4px; margin-right: 8px; cursor: pointer;">取消</button>
        <button id="policySearchConfirm" style="background: #2e5d34; color: white; padding: 6px 16px; border: none; border-radius: 4px; cursor: pointer;">搜索</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // 获取元素
  const input = modal.querySelector('#policySearchInput');
  const confirmBtn = modal.querySelector('#policySearchConfirm');
  const cancelBtn = modal.querySelector('#policySearchCancel');
  const closeBtn = modal.querySelector('.modal-close');

  // 绑定建议标签点击事件
  const suggestTags = modal.querySelectorAll('.suggest-tag');
  suggestTags.forEach(tag => {
    tag.addEventListener('click', () => {
      const keyword = tag.dataset.keyword;
      input.value = keyword;
      // 自动搜索
      doSearch(keyword);
      document.body.removeChild(modal);
    });
  });

  // 确认搜索
  const doSearch = async (keyword) => {
    if (!keyword) {
      alert('请输入关键词');
      return;
    }
    try {
      const res = await fetchWithAuth(`/api/knowledge/search?q=${encodeURIComponent(keyword)}`);
      const results = await res.json();
      if (results.length === 0) {
        alert('未找到相关政策，请尝试其他关键词。');
        return;
      }
      // 显示结果模态框（复用原有展示逻辑）
      const resultModal = document.createElement('div');
      resultModal.className = 'modal';
      resultModal.style.display = 'flex';
      resultModal.innerHTML = `
        <div class="modal-content" style="width: 80%; max-width: 800px;">
          <button class="modal-close">&times;</button>
          <h3>政策速查结果：${escapeHtml(keyword)}</h3>
          <div style="max-height: 60vh; overflow-y: auto;">
            ${results.map(r => `
              <div style="margin-bottom: 16px; border-bottom: 1px solid #eee; padding-bottom: 12px;">
                <div style="font-weight: bold; color: #2e5d34;">${escapeHtml(r.title)}</div>
                <div style="font-size: 0.9rem; margin-top: 4px;">${escapeHtml(r.content.substring(0, 200))}...</div>
                <div style="font-size: 0.8rem; color: #666; margin-top: 4px;">${r.type} · ${r.category}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
      resultModal.querySelector('.modal-close').addEventListener('click', () => {
        document.body.removeChild(resultModal);
      });
      resultModal.addEventListener('click', (e) => {
        if (e.target === resultModal) document.body.removeChild(resultModal);
      });
      document.body.appendChild(resultModal);
    } catch (err) {
      alert('搜索失败：' + err.message);
    }
  };

  confirmBtn.addEventListener('click', () => {
    const keyword = input.value.trim();
    doSearch(keyword);
    document.body.removeChild(modal);
  });

  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  closeBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) document.body.removeChild(modal);
  });

  // 聚焦输入框
  input.focus();
}

// ==================== 渲染个人中心视图 ====================
function renderProfileView() {
  dynamicContent.innerHTML = `
    <div class="profile-view">
      <div class="profile-header">
        <div class="profile-avatar">👤</div>
        <div class="profile-info">
          <h2>${escapeHtml(username)}</h2>
          <p>村官 · 加入时间 ${new Date().toLocaleDateString()}</p>
        </div>
      </div>
      <div class="profile-stats">
        <div class="stat-card">
          <div class="stat-value" id="points">0</div>
          <div class="stat-label">总积分</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="level">Lv.0</div>
          <div class="stat-label">当前等级</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="nextLevel">0</div>
          <div class="stat-label">距离下一级</div>
        </div>
      </div>
      <div class="profile-section">
        <h3>🏅 我的勋章</h3>
        <div id="badges" class="badges">加载中...</div>
      </div>
      <div class="profile-section">
        <h3>📊 使用统计</h3>
        <div id="stats" class="stats-grid">加载中...</div>
      </div>
      <div class="profile-section">
        <h3>📈 成长曲线（近7天模拟）</h3>
        <canvas id="growthChart" width="400" height="200" style="max-width:100%; height:auto;"></canvas>
      </div>
    </div>
  `;

  fetchWithAuth('/api/user/growth')
    .then(res => res.json())
    .then(data => {
      document.getElementById('points').textContent = data.points;
      document.getElementById('level').textContent = `Lv.${data.level}`;
      const need = data.nextLevelPoints - data.points;
      document.getElementById('nextLevel').textContent = need > 0 ? need : 0;
      const badgesDiv = document.getElementById('badges');
      if (data.badges.length === 0) {
        badgesDiv.innerHTML = '<p>暂无勋章，继续努力！</p>';
      } else {
        badgesDiv.innerHTML = data.badges.map(b => `
          <div class="badge-item">
            <span class="badge-icon">${b.icon}</span>
            <span class="badge-name">${b.name}</span>
          </div>
        `).join('');
      }
      document.getElementById('stats').innerHTML = `
        <div class="stat-item">对话次数：${data.stats.sessionCount}</div>
        <div class="stat-item">收藏消息：${data.stats.favoriteCount}</div>
        <div class="stat-item">收藏会话：${data.stats.favoriteSessionCount}</div>
        <div class="stat-item">已采纳上传：${data.stats.approvedUploads}</div>
        <div class="stat-item">待审核上传：${data.stats.pendingUploads}</div>
      `;
      const ctx = document.getElementById('growthChart').getContext('2d');
      const base = Math.max(10, Math.floor(data.points / 7));
      const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
      const values = days.map((_, i) => base + Math.floor(Math.random() * 20) - 5);
      const width = 400, height = 200;
      ctx.clearRect(0, 0, width, height);
      const barWidth = 30;
      const startX = 50;
      const maxValue = Math.max(...values) * 1.2;
      ctx.fillStyle = '#2e5d34';
      days.forEach((day, i) => {
        const barHeight = (values[i] / maxValue) * (height - 50);
        const x = startX + i * (barWidth + 10);
        const y = height - 30 - barHeight;
        ctx.fillRect(x, y, barWidth, barHeight);
        ctx.fillStyle = '#333';
        ctx.font = '12px Arial';
        ctx.fillText(day, x, height - 10);
        ctx.fillStyle = '#2e5d34';
      });
    })
    .catch(err => {
      console.error('加载成长数据失败', err);
      document.getElementById('badges').innerHTML = '<p>加载失败</p>';
    });
}

// ==================== 消息发送核心逻辑 ====================
async function sendUserMessage(text) {
  if (isTyping) return;
  if (!text || !currentSessionId) return;

  const messagesDiv = document.getElementById('messages');
  if (!messagesDiv) return;

  const tempMsgDiv = createMessageElement('user', text, null);
  messagesDiv.appendChild(tempMsgDiv);
  addActionIcons(tempMsgDiv, null, null);
  scrollToBottom();

  const typingIndicator = document.getElementById('typingIndicator');
  if (typingIndicator) typingIndicator.classList.remove('hidden');
  setInputEnabled(false);

  try {
    const res = await fetchWithAuth('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId, message: text })
    });
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || `请求失败，状态码：${res.status}`);
    }
    const data = await res.json();
    if (typingIndicator) typingIndicator.classList.add('hidden');

    await addMessageWithTyping('assistant', '', data.reply, data.knowledgeRefs, data.assistantMessageId);

    await loadSessions();
    const currentSession = sessions.find(s => s.id === currentSessionId);
    if (currentSession) {
      const titleElem = document.getElementById('currentSessionTitle');
      if (titleElem) titleElem.textContent = currentSession.title || '村官AI伙伴';
    }
    const sessionRes = await fetchWithAuth(`/api/session/${currentSessionId}`);
    const updatedSession = await sessionRes.json();
    if (updatedSession.messages) {
      updateInfoPanelFromMessages(updatedSession.messages);
    }
    await loadMessageFavorites();
  } catch (err) {
    if (typingIndicator) typingIndicator.classList.add('hidden');
    console.error('发送消息出错:', err);
    alert('发送失败：' + err.message);
    setInputEnabled(true);
    isTyping = false;
  }
}

function updateInfoPanel(knowledgeRefs) {
  const infoContent = document.getElementById('infoContent');
  if (!infoContent) return;
  if (!knowledgeRefs || knowledgeRefs.length === 0) {
    infoContent.innerHTML = '<div style="color:#888;">暂无参考来源</div>';
    return;
  }
  let html = '<div style="font-size: 0.85rem;">📚 参考来源：</div><ul style="margin-top: 6px;">';
  knowledgeRefs.forEach(ref => {
    if (ref.type === 'web') {
      html += `<li><a href="${escapeHtml(ref.link)}" target="_blank" style="color: #2e5d34;">🌐 ${escapeHtml(ref.title)}</a></li>`;
    } else {
      html += `<li>📘 ${escapeHtml(ref.title)}</li>`;
    }
  });
  html += '</ul>';
  infoContent.innerHTML = html;
}

async function sendMessage() {
  const userInput = document.getElementById('userInput');
  if (!userInput) return;
  const text = userInput.value.trim();
  if (!text) return;

  if (!currentSessionId) {
    await createSession();
    userInput.value = text;
    await sendUserMessage(text);
    return;
  }

  const session = sessions.find(s => s.id === currentSessionId);
  if (session && session.type !== 'chat') {
    alert('当前会话不是问答模式，已自动创建新问答会话。');
    await createSession();
    userInput.value = text;
    await sendUserMessage(text);
    return;
  }

  userInput.value = '';
  await sendUserMessage(text);
}

async function regenerateAnswer(messageDiv) {
  if (isTyping) return;
  const messagesDiv = document.getElementById('messages');
  if (!messagesDiv) return;
  const allMessages = Array.from(messagesDiv.children);
  const index = allMessages.indexOf(messageDiv);
  if (index <= 0) return;
  let userMessageDiv = null;
  for (let i = index - 1; i >= 0; i--) {
    if (allMessages[i].classList.contains('user')) {
      userMessageDiv = allMessages[i];
      break;
    }
  }
  if (!userMessageDiv) return;
  const userMessageContent = userMessageDiv.querySelector('.message-content').textContent;
  for (let i = allMessages.length - 1; i >= index; i--) {
    allMessages[i].remove();
  }
  await sendUserMessage(userMessageContent);
}

async function addMessageWithTyping(role, thought, content, knowledgeRefs = [], messageId = null) {
  isTyping = true;
  setInputEnabled(false);
  stopTypingFlag = false;
  addStopButton();

  const messagesDiv = document.getElementById('messages');
  if (!messagesDiv) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role}`;
  if (messageId) msgDiv.dataset.messageId = messageId;

  if (thought) {
    const thoughtDiv = document.createElement('div');
    thoughtDiv.className = 'thought';
    thoughtDiv.style.whiteSpace = 'pre-wrap';
    thoughtDiv.textContent = '';
    msgDiv.appendChild(thoughtDiv);
    const separator = document.createElement('hr');
    separator.className = 'thought-separator';
    msgDiv.appendChild(separator);
  }

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.style.whiteSpace = 'pre-wrap';
  contentDiv.textContent = '';
  msgDiv.appendChild(contentDiv);
  messagesDiv.appendChild(msgDiv);
  scrollToBottom();

  try {
    if (thought) {
      const thoughtElement = msgDiv.querySelector('.thought');
      await typeText(thoughtElement, thought, typingSpeed);
      if (stopTypingFlag) return;
    }
    await typeText(contentDiv, content, typingSpeed);
    if (stopTypingFlag) return;

    if (knowledgeRefs && knowledgeRefs.length > 0) {
      const refDiv = document.createElement('div');
      refDiv.className = 'knowledge-refs';
      let refHtml = '📚 参考信息：';
      knowledgeRefs.forEach(ref => {
        if (ref.type === 'web') {
          refHtml += `<span class="ref-tag" title="${escapeHtml(ref.snippet)}">🌐 ${escapeHtml(ref.title)}</span> `;
        } else {
          refHtml += `<span class="ref-tag" title="${escapeHtml(ref.id)}">📘 ${escapeHtml(ref.title)}</span> `;
        }
      });
      refDiv.innerHTML = refHtml;
      msgDiv.appendChild(refDiv);
      scrollToBottom();
    }

    addActionIcons(msgDiv, null, messageId);
    scrollToBottom();
    updateInfoPanel(knowledgeRefs);
  } catch (e) {
    console.error('打字过程出错', e);
  } finally {
    stopTyping();
    scrollToBottom();
  }
}

function typeText(element, text, speed) {
  return new Promise((resolve, reject) => {
    if (!element || !text) {
      resolve();
      return;
    }
    let i = 0;
    element.textContent = '';
    typingInterval = setInterval(() => {
      if (stopTypingFlag) {
        clearInterval(typingInterval);
        typingInterval = null;
        resolve();
        return;
      }
      if (i < text.length) {
        element.textContent += text[i];
        i++;
        scrollToBottom();
      } else {
        clearInterval(typingInterval);
        typingInterval = null;
        resolve();
      }
    }, speed);
  });
}

function addStopButton() {
  if (document.getElementById('stopTypingBtn')) return;
  const typingIndicator = document.getElementById('typingIndicator');
  if (!typingIndicator) return;
  const stopBtn = document.createElement('button');
  stopBtn.id = 'stopTypingBtn';
  stopBtn.textContent = '⏹️ 停止';
  stopBtn.style.marginLeft = '10px';
  stopBtn.style.padding = '4px 12px';
  stopBtn.style.background = '#f44336';
  stopBtn.style.color = 'white';
  stopBtn.style.border = 'none';
  stopBtn.style.borderRadius = '20px';
  stopBtn.style.cursor = 'pointer';
  stopBtn.onclick = () => {
    stopTypingFlag = true;
    stopTyping();
  };
  typingIndicator.parentNode.insertBefore(stopBtn, typingIndicator.nextSibling);
}

function stopTyping() {
  if (typingInterval) {
    clearInterval(typingInterval);
    typingInterval = null;
  }
  isTyping = false;
  setInputEnabled(true);
  const stopBtn = document.getElementById('stopTypingBtn');
  if (stopBtn) stopBtn.remove();
}

function addActionIcons(messageDiv, messageIndex, messageId) {
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'message-actions';

  const copyBtn = document.createElement('button');
  copyBtn.innerHTML = '📋';
  copyBtn.title = '复制内容';
  copyBtn.onclick = () => {
    const content = messageDiv.querySelector('.message-content').textContent;
    navigator.clipboard.writeText(content).then(() => alert('已复制'));
  };

  const redoBtn = document.createElement('button');
  redoBtn.innerHTML = '🔄';
  redoBtn.title = '重新回答';
  redoBtn.onclick = () => {
    regenerateAnswer(messageDiv);
  };

  const favoriteBtn = document.createElement('button');
  favoriteBtn.innerHTML = '☆';
  favoriteBtn.title = '收藏';
  favoriteBtn.className = 'favorite-btn';
  if (messageId) {
    const isFavorited = messageFavorites.some(f => f.messageId === messageId);
    if (isFavorited) {
      favoriteBtn.innerHTML = '★';
      favoriteBtn.classList.add('favorited');
    }
    favoriteBtn.onclick = async () => {
      const action = favoriteBtn.classList.contains('favorited') ? 'remove' : 'add';
      await toggleMessageFavorite(messageId, action);
      if (action === 'add') {
        favoriteBtn.innerHTML = '★';
        favoriteBtn.classList.add('favorited');
      } else {
        favoriteBtn.innerHTML = '☆';
        favoriteBtn.classList.remove('favorited');
      }
    };
  } else {
    favoriteBtn.disabled = true;
    favoriteBtn.title = '暂时无法收藏';
  }

  actionsDiv.appendChild(copyBtn);
  actionsDiv.appendChild(redoBtn);
  actionsDiv.appendChild(favoriteBtn);
  messageDiv.appendChild(actionsDiv);
}

// ==================== 会话操作 ====================
async function createSession(title = '新会话') {
  if (isTyping) return;
  const res = await fetchWithAuth('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title })
  });
  const data = await res.json();
  if (!data.session) {
    console.error('创建会话失败，响应数据:', data);
    alert('创建会话失败，请重试');
    return;
  }
  sessions.push(data.session);
  sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  renderSessionList();
  switchSession(data.sessionId);
  if (currentView === 'chat') {
    renderChatView();
  } else if (currentView === 'simulate') {
    renderSimulateView();
  }
}

async function deleteSession(sessionId) {
  if (isTyping) return;
  if (!confirm('确定删除此会话？')) return;
  await fetchWithAuth(`/api/session/${sessionId}`, { method: 'DELETE' });
  sessions = sessions.filter(s => s.id !== sessionId);
  if (currentSessionId === sessionId) {
    if (sessions.length > 0) {
      switchSession(sessions[0].id);
    } else {
      createSession();
    }
  } else {
    renderSessionList();
  }
}

function scrollToBottom() {
  const chatContainer = document.getElementById('chatContainer');
  if (chatContainer) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}