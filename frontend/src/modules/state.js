// frontend/src/modules/state.js
import { fetchWithAuth } from '../utils/api';
import { renderSessionList, renderMessageFavoriteList } from './ui';
import { updateSidebarLevel } from '../utils/helpers';

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
  isTyping: false,
  selectedSessions: []  // 存储选中的会话ID数组
};

export function setAppState(newState) {
  Object.assign(appState, newState);
}

export async function loadSessions() {
  // 重置选中状态，避免残留
  appState.selectedSessions = [];
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
    updateSidebarLevel(data.level, data.points, data.nextLevelPoints);
  } catch(e) { console.error(e); }
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

export async function deleteSessions(sessionIds) {
  if (!sessionIds.length) return;
  const res = await fetchWithAuth('/api/sessions/batch-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionIds })
  });
  if (!res.ok) throw new Error('批量删除失败');
  appState.sessions = appState.sessions.filter(s => !sessionIds.includes(s.id));
  // 清除选中的ID
  appState.selectedSessions = [];
  if (sessionIds.includes(appState.currentSessionId)) {
    if (appState.sessions.length > 0) {
      await switchSession(appState.sessions[0].id);
    } else {
      await createNewSession();
    }
  }
  renderSessionList();
  loadMessageFavorites();
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
  // 将新会话插入到列表最前面
  appState.sessions.unshift(data.session);
  // 重新排序（按创建时间倒序）
  appState.sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  // 刷新侧边栏
  renderSessionList();
  // 切换到新会话
  await switchSession(data.sessionId);
}

export function setTyping(typing) {
  appState.isTyping = typing;
}