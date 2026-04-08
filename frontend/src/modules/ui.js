// 渲染会话列表、消息收藏列表等 UI 组件
import { appState, toggleSessionFavorite, deleteSession, switchSession, switchToMessage } from './state';
import { escapeHtml } from '../utils/helpers';

export function renderSessionList() {
  const sessionListDiv = document.getElementById('sessionList');
  if (!sessionListDiv) return;
  const filtered = appState.currentFilter === 'all' ? appState.sessions : appState.sessions.filter(s => s.favorite);
  sessionListDiv.innerHTML = '';
  if (filtered.length === 0) {
    sessionListDiv.innerHTML = '<div class="empty">暂无会话</div>';
    return;
  }
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
  const sessionListDiv = document.getElementById('sessionList');
  const messageFavoriteList = document.getElementById('messageFavoriteList');

  allSessionsTab.onclick = () => {
    allSessionsTab.classList.add('active');
    favoritesTab.classList.remove('active');
    messageFavoritesTab.classList.remove('active');
    appState.currentFilter = 'all';
    sessionListDiv.style.display = 'block';
    messageFavoriteList.style.display = 'none';
    renderSessionList();
  };
  favoritesTab.onclick = () => {
    favoritesTab.classList.add('active');
    allSessionsTab.classList.remove('active');
    messageFavoritesTab.classList.remove('active');
    appState.currentFilter = 'favorites';
    sessionListDiv.style.display = 'block';
    messageFavoriteList.style.display = 'none';
    renderSessionList();
  };
  messageFavoritesTab.onclick = () => {
    messageFavoritesTab.classList.add('active');
    allSessionsTab.classList.remove('active');
    favoritesTab.classList.remove('active');
    sessionListDiv.style.display = 'none';
    messageFavoriteList.style.display = 'block';
    renderMessageFavoriteList();
  };
}