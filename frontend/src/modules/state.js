// frontend/src/modules/state.js
import { fetchWithAuth } from '../utils/api';
import { renderSessionList, renderMessageFavoriteList } from './ui';

export const appState = {
  currentSessionId: null,
  sessions: [],
  messageFavorites: [],
  currentFilter: 'all',
  currentCategoryFilter: 'all',
  currentView: 'chat',
  username: '',
  userLevel: 1,
  userPoints: 0,
  userNextLevelPoints: 100,
  knowledgeData: [],
  isTyping: false
};

export function setAppState(newState) {
  Object.assign(appState, newState);
}

// ==================== 会话相关 ====================
export async function loadSessions() {
  const res = await fetchWithAuth('/api/sessions');
  if (!res.ok) throw new Error('加载会话失败');
  let sessionsData = await res.json();
  if (!Array.isArray(sessionsData)) sessionsData = [];
  sessionsData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  appState.sessions = sessionsData;
  renderSessionList();
}

export async function loadMessageFavorites() {
  const res = await fetchWithAuth('/api/user/favorites');
  if (res.ok) {
    appState.messageFavorites = await res.json();
    renderMessageFavoriteList();
  }
}

export async function loadLevelProgress() {
  try {
    const res = await fetchWithAuth('/api/user/growth');
    const data = await res.json();
    appState.userPoints = data.points;
    appState.userLevel = data.level;
    appState.userNextLevelPoints = data.nextLevelPoints;
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
  const percent = (appState.userPoints / appState.userNextLevelPoints) * 100;
  levelContainer.innerHTML = `
    <div class="level-info"><span>Lv.${appState.userLevel}</span><span>${appState.userPoints}/${appState.userNextLevelPoints}</span></div>
    <div class="level-progress-bar"><div class="level-progress-fill" style="width: ${percent}%"></div></div>
  `;
}

export async function toggleSessionFavorite(sessionId, favorite) {
  if (appState.isTyping) return;
  try {
    const res = await fetchWithAuth(`/api/session/${sessionId}/favorite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite })
    });
    if (!res.ok) throw new Error('操作失败');
    const session = appState.sessions.find(s => s.id === sessionId);
    if (session) session.favorite = favorite;
    renderSessionList();
  } catch(err) { alert('收藏操作失败：'+err.message); }
}

export async function deleteSession(sessionId) {
  if (appState.isTyping) return;
  if (!confirm('删除会话？')) return;
  await fetchWithAuth(`/api/session/${sessionId}`, { method: 'DELETE' });
  appState.sessions = appState.sessions.filter(s => s.id !== sessionId);
  if (appState.currentSessionId === sessionId) {
    if (appState.sessions.length > 0) {
      await switchSession(appState.sessions[0].id);
    } else {
      await createNewSession();
    }
  } else {
    renderSessionList();
  }
}

export async function switchSession(sessionId) {
  if (appState.isTyping) return;
  appState.currentSessionId = sessionId;
  const res = await fetchWithAuth(`/api/session/${sessionId}`);
  const session = await res.json();
  if (!session.messages) session.messages = [];
  if (session.type === 'chat') {
    appState.currentView = 'chat';
    const { renderChatView } = await import('./chat');
    renderChatView(session);
  } else if (session.type === 'simulate') {
    appState.currentView = 'simulate';
    const { renderSimulateChat } = await import('./simulate');
    renderSimulateChat(session);
  } else if (session.type === 'meeting') {
    appState.currentView = 'meeting';
    const { renderMeetingChat } = await import('./meeting');
    renderMeetingChat(session);
  }
  renderSessionList();
}

export async function switchToMessage(sessionId, messageId) {
  if (appState.isTyping) return;
  await switchSession(sessionId);
  setTimeout(() => {
    const msgElem = document.querySelector(`.message[data-message-id="${messageId}"]`);
    if (msgElem) {
      msgElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgElem.style.backgroundColor = '#fff3cd';
      setTimeout(() => msgElem.style.backgroundColor = '', 2000);
    }
  }, 500);
}

export async function createNewSession(title = '新会话') {
  if (appState.isTyping) return;
  const res = await fetchWithAuth('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title })
  });
  const data = await res.json();
  if (!data.session) { alert('创建失败'); return; }
  appState.sessions.push(data.session);
  appState.sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  renderSessionList();
  await switchSession(data.sessionId);
}

export function setTyping(typing) {
  appState.isTyping = typing;
}