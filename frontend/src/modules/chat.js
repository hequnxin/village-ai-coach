// frontend/src/modules/chat.js
import { fetchWithAuth } from '../utils/api';
import { appState, switchSession, createNewSession, loadSessions, loadMessageFavorites } from './state';
import { escapeHtml, playSound, addPoints, updateTaskProgress, showComboEffect, setupVoiceInput, setActiveNavByView } from '../utils/helpers';
import { renderSessionList } from './ui';

let isTyping = false;
let typingInterval = null;
let stopTypingFlag = false;
let typingSpeed = 15;

function scrollToBottom() {
  const container = document.getElementById('chatContainer');
  if (container) container.scrollTop = container.scrollHeight;
}

function setInputEnabled(enabled) {
  const userInput = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');
  const voiceBtn = document.getElementById('voiceBtn');
  if (userInput) userInput.disabled = !enabled;
  if (sendBtn) sendBtn.disabled = !enabled;
  if (voiceBtn) voiceBtn.disabled = !enabled;
  if (enabled && userInput) userInput.focus();
}

function stopTyping() {
  if (typingInterval) { clearInterval(typingInterval); typingInterval = null; }
  isTyping = false;
  setInputEnabled(true);
  const btn = document.getElementById('stopTypingBtn');
  if (btn) btn.remove();
}

function addStopButton() {
  if (document.getElementById('stopTypingBtn')) return;
  const ti = document.getElementById('typingIndicator');
  if (!ti) return;
  const btn = document.createElement('button');
  btn.id = 'stopTypingBtn';
  btn.textContent = '⏹️停止';
  btn.style.marginLeft = '10px';
  btn.style.padding = '4px 12px';
  btn.style.background = '#f44336';
  btn.style.color = 'white';
  btn.style.border = 'none';
  btn.style.borderRadius = '20px';
  btn.style.cursor = 'pointer';
  btn.onclick = () => { stopTypingFlag = true; stopTyping(); };
  ti.parentNode.insertBefore(btn, ti.nextSibling);
}

// 格式化 AI 回复：移除 Markdown 加粗符号，并将纯文本标题行加粗
function formatAssistantContent(content) {
  if (!content) return '';
  let cleaned = content.replace(/\*\*(.*?)\*\*/g, '$1');
  cleaned = cleaned.replace(/\*(.*?)\*/g, '$1');
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
  const lines = cleaned.split('\n');
  const processedLines = lines.map(line => {
    const trimmed = line.trim();
    if (/^[一二三四五六七八九十]+、/.test(trimmed) ||
        /^\d+\./.test(trimmed) ||
        /^（[一二三四五六七八九十]+）/.test(trimmed) ||
        /^（\d+）/.test(trimmed) ||
        /^[①②③④⑤⑥⑦⑧⑨⑩]/.test(trimmed)) {
      return `<strong>${line}</strong>`;
    }
    return line;
  });
  return processedLines.join('\n');
}

function createMessageElement(role, content, messageId) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role}`;
  if (messageId) msgDiv.dataset.messageId = messageId;
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  let displayContent = content;
  if (role === 'assistant') {
    displayContent = formatAssistantContent(content);
  }
  contentDiv.innerHTML = displayContent.replace(/\n/g, '<br>');
  msgDiv.appendChild(contentDiv);
  return msgDiv;
}

function addActionIcons(msgDiv, messageId) {
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  const copy = document.createElement('button');
  copy.innerHTML = '📋';
  copy.title = '复制';
  copy.onclick = () => {
    const c = msgDiv.querySelector('.message-content').textContent;
    navigator.clipboard.writeText(c);
    alert('已复制');
  };
  const redo = document.createElement('button');
  redo.innerHTML = '🔄';
  redo.title = '重新回答';
  redo.onclick = () => regenerateAnswer(msgDiv);
  const fav = document.createElement('button');
  fav.innerHTML = '☆';
  fav.title = '收藏';
  if (messageId) {
    const isFav = appState.messageFavorites.some(f => f.messageId === messageId);
    if (isFav) { fav.innerHTML = '★'; fav.classList.add('favorited'); }
    fav.onclick = async () => {
      const action = fav.classList.contains('favorited') ? 'remove' : 'add';
      await toggleMessageFavorite(messageId, action);
      if (action === 'add') { fav.innerHTML = '★'; fav.classList.add('favorited'); }
      else { fav.innerHTML = '☆'; fav.classList.remove('favorited'); }
    };
  } else { fav.disabled = true; fav.title = '暂不可收藏'; }
  actions.appendChild(copy);
  actions.appendChild(redo);
  actions.appendChild(fav);
  msgDiv.appendChild(actions);
}

async function toggleMessageFavorite(messageId, action) {
  try {
    const res = await fetchWithAuth('/api/user/favorite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, action })
    });
    if (!res.ok) throw new Error('操作失败');
    await loadMessageFavorites();
    if (action === 'add') updateTaskProgress('favorite', 1);
  } catch(err) { alert('消息收藏失败：' + err.message); }
}

async function regenerateAnswer(msgDiv) {
  if (isTyping) return;
  const container = document.getElementById('messages');
  const all = Array.from(container.children);
  const idx = all.indexOf(msgDiv);
  if (idx <= 0) return;
  let userMsgDiv = null;
  for (let i = idx-1; i >= 0; i--) {
    if (all[i].classList.contains('user')) { userMsgDiv = all[i]; break; }
  }
  if (!userMsgDiv) return;
  const userText = userMsgDiv.querySelector('.message-content').textContent;
  for (let i = all.length-1; i >= idx; i--) all[i].remove();
  await sendUserMessage(userText);
}

// 发送消息（流式 + 缓存）
async function sendUserMessage(text) {
  if (isTyping) return;
  if (!text || !appState.currentSessionId) return;
  const messagesDiv = document.getElementById('messages');
  if (!messagesDiv) return;
  const userMsgDiv = createMessageElement('user', text);
  messagesDiv.appendChild(userMsgDiv);
  addActionIcons(userMsgDiv, null);
  scrollToBottom();
  const typingIndicator = document.getElementById('typingIndicator');
  if (typingIndicator) typingIndicator.classList.remove('hidden');
  setInputEnabled(false);
  stopTypingFlag = false;
  addStopButton();
  const assistantMsgDiv = createMessageElement('assistant', '');
  const contentDiv = assistantMsgDiv.querySelector('.message-content');
  contentDiv.innerHTML = '';
  messagesDiv.appendChild(assistantMsgDiv);
  scrollToBottom();
  let token = localStorage.getItem('token');
  if (!token) {
    if (typingIndicator) typingIndicator.classList.add('hidden');
    setInputEnabled(true);
    isTyping = false;
    throw new Error('未登录');
  }
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ sessionId: appState.currentSessionId, message: text })
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || '请求失败');
    }
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      contentDiv.innerHTML = formatAssistantContent(data.reply).replace(/\n/g, '<br>');
      addActionIcons(assistantMsgDiv, data.assistantMessageId);
      await loadSessions();
      await loadMessageFavorites();
      showComboEffect();
      updateTaskProgress('chat', 1);
      playSound('send');
      if (typingIndicator) typingIndicator.classList.add('hidden');
      stopTyping();
      scrollToBottom();
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullReply = '';
    let assistantMessageId = null;
    let sessionTitle = null;
    let knowledgeRefs = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        if (trimmedLine.startsWith('data:')) {
          let jsonStr = trimmedLine.substring(5).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.content) {
              fullReply += parsed.content;
              contentDiv.innerHTML = formatAssistantContent(fullReply).replace(/\n/g, '<br>');
              scrollToBottom();
            } else if (parsed.done) {
              assistantMessageId = parsed.assistantMessageId;
              sessionTitle = parsed.sessionTitle;
              knowledgeRefs = parsed.knowledgeRefs;
            } else if (parsed.error) {
              throw new Error(parsed.error);
            }
          } catch (e) {
            console.warn('解析流数据失败，原始行:', line, e);
          }
        }
      }
    }
    if (typingIndicator) typingIndicator.classList.add('hidden');
    stopTyping();
    addActionIcons(assistantMsgDiv, assistantMessageId);
    scrollToBottom();
    await loadSessions();
    const curr = appState.sessions.find(s => s.id === appState.currentSessionId);
    if (curr) {
      const titleElem = document.getElementById('currentSessionTitle');
      if (titleElem) titleElem.textContent = curr.title;
    }
    await loadMessageFavorites();
    showComboEffect();
    updateTaskProgress('chat', 1);
    playSound('send');
  } catch (err) {
    console.error(err);
    if (typingIndicator) typingIndicator.classList.add('hidden');
    assistantMsgDiv.remove();
    const errorMsg = createMessageElement('assistant', `❌ 发送失败：${err.message}`);
    messagesDiv.appendChild(errorMsg);
    scrollToBottom();
    alert('发送失败：' + err.message);
  } finally {
    setInputEnabled(true);
    isTyping = false;
  }
}

export async function sendMessage() {
  const input = document.getElementById('userInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  if (!appState.currentSessionId) {
    await createNewSession();
    input.value = text;
    await sendUserMessage(text);
    return;
  }
  const sess = appState.sessions.find(s => s.id === appState.currentSessionId);
  if (sess && sess.type !== 'chat') {
    alert('当前不是问答模式，已创建新会话');
    await createNewSession();
    input.value = text;
    await sendUserMessage(text);
    return;
  }
  input.value = '';
  await sendUserMessage(text);
}

function displayMessages(messages) {
  const messagesDiv = document.getElementById('messages');
  if (!messagesDiv) return;
  messagesDiv.innerHTML = '';
  messages.forEach(msg => {
    const msgDiv = createMessageElement(msg.role, msg.content, msg.messageId);
    messagesDiv.appendChild(msgDiv);
    addActionIcons(msgDiv, msg.messageId);
  });
  scrollToBottom();
}

// 移动端摘要模态框
function showMobileSummaryModal(contentHtml) {
  const existingModal = document.getElementById('mobileSummaryModal');
  if (existingModal) existingModal.remove();
  const modal = document.createElement('div');
  modal.id = 'mobileSummaryModal';
  modal.className = 'mobile-summary-modal';
  modal.innerHTML = `
    <div class="mobile-summary-overlay"></div>
    <div class="mobile-summary-drawer">
      <div class="mobile-summary-header">
        <span>📋 信息提取</span>
        <button class="mobile-summary-close">&times;</button>
      </div>
      <div class="mobile-summary-content">${contentHtml}</div>
    </div>
  `;
  document.body.appendChild(modal);
  const closeBtn = modal.querySelector('.mobile-summary-close');
  const overlay = modal.querySelector('.mobile-summary-overlay');
  const closeModal = () => modal.remove();
  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', closeModal);
}
export async function renderChatView(existingSession = null) {
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="chat-view">
      <div class="chat-area">
        <div class="chat-header">
          <div><h1 id="currentSessionTitle">村官AI伙伴</h1></div>
          <div>
            <button id="summaryBtn" class="summary-btn">📋 生成摘要</button>
            <button id="exportBtn" class="summary-btn">📥导出</button>
            <button id="policyQuickSearch" class="summary-btn">📜政策速查</button>
          </div>
        </div>
        <div id="chatContainer" class="chat-container">
          <div id="messages"></div>
          <div id="typingIndicator" class="hidden">AI正在思考...</div>
        </div>
        <footer class="chat-footer">
          <div class="input-tip">💡提示：按住麦克风语音输入</div>
          <div class="preset-questions">
            <button class="preset-btn" data-question="村里闲置小学可以改造成什么？">🏫闲置小学改造</button>
            <button class="preset-btn" data-question="土地流转合同要注意哪些条款？">📄土地流转合同</button>
            <button class="preset-btn" data-question="如何申请高标准农田项目？">🌾申请高标准农田</button>
            <button class="preset-btn" data-question="村民不配合垃圾分类怎么办？">🗑️垃圾分类</button>
            <button class="preset-btn" data-question="想发展民宿需要办哪些手续？">🏠发展民宿</button>
          </div>
          <div class="input-area">
            <textarea id="userInput" placeholder="输入你的问题..." rows="2"></textarea>
            <button id="voiceBtn" class="voice-btn">🎤</button>
            <button id="sendBtn">发送</button>
          </div>
        </footer>
      </div>
      <div class="info-panel" id="infoPanel" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h3>📋信息提取</h3>
          <button id="closeInfoPanel" style="background:none; border:none; font-size:1.2rem; cursor:pointer;">&times;</button>
        </div>
        <div id="infoContent" class="info-content"></div>
      </div>
    </div>
  `;

  const userInput = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');
  const exportBtn = document.getElementById('exportBtn');
  const summaryBtn = document.getElementById('summaryBtn');
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.onclick = () => { userInput.value = btn.dataset.question; sendMessage(); };
  });
  sendBtn.onclick = sendMessage;
  userInput.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !isTyping) { e.preventDefault(); sendMessage(); } };
  exportBtn.onclick = exportCurrentChat;

  // 生成摘要逻辑（电脑端显示面板，移动端弹窗）
  summaryBtn.onclick = async () => {
    const sessionId = appState.currentSessionId;
    if (!sessionId) return;
    summaryBtn.disabled = true;
    summaryBtn.textContent = '生成中...';
    try {
      const res = await fetchWithAuth('/api/chat/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      const data = await res.json();
      const summary = data.summary || { points: [], status: '', reasons: [], suggestions: [], references: [] };
      let html = '<div style="font-size:0.9rem;">';
      if (summary.points.length) html += `<div><strong>📌 要点</strong><ul>${summary.points.map(p=>`<li>${escapeHtml(p)}</li>`).join('')}</ul></div>`;
      if (summary.status) html += `<div><strong>📋 现状</strong><div>${escapeHtml(summary.status)}</div></div>`;
      if (summary.reasons.length) html += `<div><strong>🔍 原因</strong><ul>${summary.reasons.map(r=>`<li>${escapeHtml(r)}</li>`).join('')}</ul></div>`;
      if (summary.suggestions.length) html += `<div><strong>💡 建议</strong><ul>${summary.suggestions.map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ul></div>`;
      if (summary.references.length) html += `<div><strong>📚 参考</strong><ul>${summary.references.map(r=>`<li>${escapeHtml(r)}</li>`).join('')}</ul></div>`;
      html += `</div>`;

      const isMobile = window.innerWidth <= 768;
      if (isMobile) {
        showMobileSummaryModal(html);
      } else {
        const infoPanel = document.getElementById('infoPanel');
        const infoContent = document.getElementById('infoContent');
        if (infoContent) infoContent.innerHTML = html;
        if (infoPanel) infoPanel.style.display = 'block';
      }
    } catch(e) {
      alert('生成摘要失败');
    } finally {
      summaryBtn.disabled = false;
      summaryBtn.textContent = '📋 生成摘要';
    }
  };

  // 关闭电脑端信息面板
  const closeInfoBtn = document.getElementById('closeInfoPanel');
  if (closeInfoBtn) {
    closeInfoBtn.onclick = () => {
      const panel = document.getElementById('infoPanel');
      if (panel) panel.style.display = 'none';
    };
  }

  setupVoiceInput(userInput, document.getElementById('voiceBtn'));

  if (appState.currentSessionId && !existingSession) {
    const res = await fetchWithAuth(`/api/session/${appState.currentSessionId}`);
    const session = await res.json();
    document.getElementById('currentSessionTitle').textContent = session.title || '村官AI伙伴';
    displayMessages(session.messages || []);
    document.getElementById('infoContent').innerHTML = '<div style="color:#888;">点击"生成摘要"获取分析</div>';
  } else if (existingSession) {
    document.getElementById('currentSessionTitle').textContent = existingSession.title || '村官AI伙伴';
    displayMessages(existingSession.messages || []);
    document.getElementById('infoContent').innerHTML = '<div style="color:#888;">点击"生成摘要"获取分析</div>';
  }

  document.getElementById('policyQuickSearch')?.addEventListener('click', showPolicyQuickSearch);
  setActiveNavByView('chat');
}

async function exportCurrentChat() {
  if (!appState.currentSessionId) return;
  const res = await fetchWithAuth(`/api/session/${appState.currentSessionId}`);
  const session = await res.json();
  if (!session.messages || !session.messages.length) { alert('暂无对话'); return; }
  let text = `会话：${session.title}\n时间：${new Date(session.createdAt).toLocaleString()}\n\n`;
  session.messages.forEach(m => {
    text += `${m.role === 'user' ? '👤村官' : '🤖AI伙伴'}：${m.content}\n\n`;
  });
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `会话_${session.title}_${new Date().toISOString().slice(0,10)}.txt`; a.click();
  URL.revokeObjectURL(url);
}

async function showPolicyQuickSearch() {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content" style="width:450px;">
      <button class="modal-close" style="position:absolute;right:12px;top:12px;">&times;</button>
      <h3>📜 政策速查</h3>
      <input type="text" id="policySearchInput" placeholder="请输入关键词..." style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;">
      <div id="searchResults" style="margin-top:16px;max-height:300px;overflow-y:auto;"></div>
      <div style="margin-top:16px;text-align:right;"><button id="policySearchCancel" style="background:#ccc;padding:6px 16px;border:none;border-radius:4px;">取消</button></div>
    </div>
  `;
  document.body.appendChild(modal);
  const input = modal.querySelector('#policySearchInput');
  const resultsDiv = modal.querySelector('#searchResults');
  const doSearch = async () => {
    const keyword = input.value.trim();
    if (!keyword) return;
    resultsDiv.innerHTML = '<div style="text-align:center;padding:20px;">搜索中...</div>';
    try {
      const res = await fetchWithAuth(`/api/knowledge/search?q=${encodeURIComponent(keyword)}`);
      const results = await res.json();
      if (results.length === 0) { resultsDiv.innerHTML = '<div style="text-align:center;padding:20px;color:#999;">未找到相关内容</div>'; return; }
      resultsDiv.innerHTML = results.map(r => `
        <div style="margin-bottom:12px;padding:8px;border-bottom:1px solid #eee;cursor:pointer;" data-id="${r.id}">
          <div style="font-weight:bold;color:#2e5d34;">${escapeHtml(r.title)}</div>
          <div style="font-size:0.8rem;color:#666;margin-top:4px;">${escapeHtml(r.content.substring(0,150))}...</div>
        </div>
      `).join('');
      resultsDiv.querySelectorAll('[data-id]').forEach(el => {
        el.onclick = () => { showKnowledgeDetail(results.find(r => r.id === el.dataset.id)); };
      });
    } catch(e) { resultsDiv.innerHTML = `<div style="color:red;">搜索失败</div>`; }
  };
  input.onkeypress = e => { if (e.key === 'Enter') doSearch(); };
  modal.querySelector('#policySearchCancel').onclick = () => document.body.removeChild(modal);
  modal.querySelector('.modal-close').onclick = () => document.body.removeChild(modal);
  input.focus();
}

function showKnowledgeDetail(item) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content">
      <button class="modal-close">&times;</button>
      <div class="modal-title">${escapeHtml(item.title)}</div>
      <div class="modal-type">${item.type}·${item.category}</div>
      <div class="modal-content-body">${escapeHtml(item.content)}</div>
    </div>
  `;
  modal.querySelector('.modal-close').onclick = () => document.body.removeChild(modal);
  modal.onclick = e => { if (e.target === modal) document.body.removeChild(modal); };
  document.body.appendChild(modal);
}

export function switchToChat() {
  if (appState.currentSessionId && appState.sessions.find(s => s.id === appState.currentSessionId)?.type === 'chat') {
    renderChatView();
  } else {
    createNewSession('新会话').then(() => {
      renderChatView();
    });
  }
}