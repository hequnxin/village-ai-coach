import { appState, toggleSessionFavorite, deleteSession, switchSession, switchToMessage } from './state';
import { escapeHtml } from '../utils/helpers';

export function renderSessionList() {
  const sessionListDiv = document.getElementById('sessionList');
  if (!sessionListDiv) return;
  const filtered = appState.currentFilter === 'all' ? appState.sessions : appState.sessions.filter(s => s.favorite);
  sessionListDiv.innerHTML = '';
  filtered.forEach(session => {
    const item = document.createElement('div');
    item.className = `session-item ${session.id === appState.currentSessionId ? 'active' : ''}`;
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

export function renderMessageFavoriteList() {
  const container = document.getElementById('messageFavoriteList');
  if (!container) return;
  container.innerHTML = '';
  if (appState.messageFavorites.length === 0) {
    container.innerHTML = '<div class="empty">暂无收藏的消息</div>';
    return;
  }
  appState.messageFavorites.forEach(fav => {
    const item = document.createElement('div');
    item.className = 'favorite-message-item';
    item.dataset.sessionId = fav.sessionId;
    item.dataset.messageId = fav.messageId;
    item.innerHTML = `
      <div class="session-title">📁 ${escapeHtml(fav.sessionTitle || '未命名会话')}</div>
      <div class="message-preview">${escapeHtml(fav.content.substring(0,50))}${fav.content.length>50?'...':''}</div>
      <div class="meta"><span>${fav.role==='user'?'👤':'🤖'}</span><span>${new Date(fav.favoritedAt).toLocaleString()}</span></div>
    `;
    item.addEventListener('click', () => switchToMessage(fav.sessionId, fav.messageId));
    container.appendChild(item);
  });
}

export function setupSessionTabs() {
  const allSessionsTab = document.getElementById('allSessionsTab');
  const favoritesTab = document.getElementById('favoritesTab');
  const messageFavoritesTab = document.getElementById('messageFavoritesTab');
  const sessionList = document.getElementById('sessionList');
  const messageFavoriteList = document.getElementById('messageFavoriteList');

  const setActiveTab = (active) => {
    [allSessionsTab, favoritesTab, messageFavoritesTab].forEach(tab => tab.classList.remove('active'));
    active.classList.add('active');
  };

  const showSessionList = () => {
    if (sessionList) sessionList.style.display = 'block';
    if (messageFavoriteList) messageFavoriteList.style.display = 'none';
    renderSessionList();
  };

  const showMessageFavorites = () => {
    if (sessionList) sessionList.style.display = 'none';
    if (messageFavoriteList) messageFavoriteList.style.display = 'block';
    renderMessageFavoriteList();
  };

  allSessionsTab.addEventListener('click', () => {
    appState.currentFilter = 'all';
    setActiveTab(allSessionsTab);
    showSessionList();
  });
  favoritesTab.addEventListener('click', () => {
    appState.currentFilter = 'favorites';
    setActiveTab(favoritesTab);
    showSessionList();
  });
  messageFavoritesTab.addEventListener('click', () => {
    setActiveTab(messageFavoritesTab);
    showMessageFavorites();
  });

  // 初始显示会话列表
  showSessionList();
}