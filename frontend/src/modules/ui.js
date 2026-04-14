// frontend/src/modules/ui.js

import { appState, toggleSessionFavorite, deleteSession, switchSession, deleteSessions, switchToMessage } from './state';
import { escapeHtml } from '../utils/helpers';

// 存储分组折叠状态
let groupCollapsed = {
  chat: localStorage.getItem('groupCollapsed_chat') === 'true',
  simulate: localStorage.getItem('groupCollapsed_simulate') === 'true',
  meeting: localStorage.getItem('groupCollapsed_meeting') === 'true'
};

// 渲染分组会话列表（支持整行点击折叠/展开）
export function renderSessionList() {
  const sessionListDiv = document.getElementById('sessionList');
  if (!sessionListDiv) return;

  sessionListDiv.innerHTML = '';

  // 获取当前会话数据
  let sessions = appState.sessions || [];
  if (appState.currentFilter === 'favorites') {
    sessions = sessions.filter(s => s.favorite);
  }

  // 分组
  const groups = {
    chat: { title: '💬 问答会话', items: [] },
    simulate: { title: '🎭 模拟对练', items: [] },
    meeting: { title: '🏛️ 会议模式', items: [] }
  };

  sessions.forEach(s => {
    const type = s.type;
    if (groups[type]) groups[type].items.push(s);
    else groups.chat.items.push(s);
  });

  // 全选栏
  const totalSessions = sessions.length;
  const selectedCount = appState.selectedSessions?.length || 0;
  const allChecked = totalSessions > 0 && selectedCount === totalSessions;
  const selectAllDiv = document.createElement('div');
  selectAllDiv.className = 'session-select-all';
  selectAllDiv.innerHTML = `
    <label class="select-all-label">
      <input type="checkbox" id="selectAllCheckbox" ${allChecked ? 'checked' : ''}>
      <span>全选</span>
    </label>
    <span class="select-all-info">已选 ${selectedCount} / ${totalSessions}</span>
  `;
  sessionListDiv.appendChild(selectAllDiv);

  // 渲染每个分组
  for (const [key, group] of Object.entries(groups)) {
    if (group.items.length === 0) continue;

    const isCollapsed = groupCollapsed[key];
    const groupDiv = document.createElement('div');
    groupDiv.className = 'session-group';
    groupDiv.dataset.group = key;

    // 分组头部（整行可点击）
    const headerDiv = document.createElement('div');
    headerDiv.className = 'session-group-header';
    headerDiv.style.cursor = 'pointer';
    headerDiv.innerHTML = `
      <span class="session-group-title">${escapeHtml(group.title)}</span>
      <button class="group-toggle" data-group="${key}">${isCollapsed ? '▶' : '▼'}</button>
    `;
    groupDiv.appendChild(headerDiv);

    // 内容区域
    const contentDiv = document.createElement('div');
    contentDiv.className = 'session-group-content';
    contentDiv.style.overflow = 'hidden';
    contentDiv.style.transition = 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)';

    // 添加所有会话项
    group.items.forEach(session => {
      const isActive = session.id === appState.currentSessionId;
      const isChecked = appState.selectedSessions?.includes(session.id) ? 'checked' : '';
      const itemDiv = document.createElement('div');
      itemDiv.className = `session-item ${isActive ? 'active' : ''}`;
      itemDiv.dataset.id = session.id;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'session-title';
      titleSpan.textContent = session.title || '新会话';
      itemDiv.appendChild(titleSpan);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'session-actions';

      const favBtn = document.createElement('button');
      favBtn.className = `favorite-btn ${session.favorite ? 'favorited' : ''}`;
      favBtn.dataset.id = session.id;
      favBtn.textContent = session.favorite ? '★' : '☆';
      actionsDiv.appendChild(favBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'delete-session';
      delBtn.dataset.id = session.id;
      delBtn.textContent = '✕';
      actionsDiv.appendChild(delBtn);

      const checkBox = document.createElement('input');
      checkBox.type = 'checkbox';
      checkBox.className = 'session-checkbox';
      checkBox.dataset.id = session.id;
      if (isChecked) checkBox.checked = true;
      actionsDiv.appendChild(checkBox);

      itemDiv.appendChild(actionsDiv);
      contentDiv.appendChild(itemDiv);
    });

    groupDiv.appendChild(contentDiv);
    sessionListDiv.appendChild(groupDiv);

    // 设置初始高度
    if (isCollapsed) {
      contentDiv.style.maxHeight = '0';
    } else {
      requestAnimationFrame(() => {
        contentDiv.style.maxHeight = contentDiv.scrollHeight + 'px';
      });
    }

    // 绑定分组头部点击事件（整行可点击）
    headerDiv.onclick = (e) => {
      // 如果点击的是按钮本身，也正常触发折叠（不阻止冒泡）
      const groupKey = key;
      const content = groupDiv.querySelector('.session-group-content');
      if (!content) return;

      const newCollapsed = !groupCollapsed[groupKey];
      groupCollapsed[groupKey] = newCollapsed;
      localStorage.setItem(`groupCollapsed_${groupKey}`, newCollapsed);

      if (newCollapsed) {
        // 折叠：先获取当前高度，再设为0
        const currentHeight = content.scrollHeight;
        content.style.maxHeight = currentHeight + 'px';
        content.offsetHeight; // 强制重绘
        content.style.maxHeight = '0';
      } else {
        // 展开：设为 auto 获取实际高度，再设为该高度
        content.style.maxHeight = content.scrollHeight + 'px';
      }
      // 更新按钮图标
      const toggleBtn = headerDiv.querySelector('.group-toggle');
      if (toggleBtn) toggleBtn.innerHTML = newCollapsed ? '▶' : '▼';
    };
  }

  if (sessions.length === 0) {
    sessionListDiv.innerHTML = '<div class="empty-sessions">暂无会话</div>';
  }

  bindSessionListEvents(sessions);
}

// 绑定会话列表中的事件（收藏、删除、切换等）
function bindSessionListEvents(filteredSessions) {
  // 全选事件
  const selectAllCheckbox = document.getElementById('selectAllCheckbox');
  if (selectAllCheckbox) {
    selectAllCheckbox.onchange = (e) => {
      if (e.target.checked) {
        appState.selectedSessions = filteredSessions.map(s => s.id);
      } else {
        appState.selectedSessions = [];
      }
      renderSessionList();
      updateMultiDeleteBar();
    };
  }

  // 复选框事件
  document.querySelectorAll('.session-checkbox').forEach(cb => {
    cb.onchange = (e) => {
      e.stopPropagation();
      const sessionId = cb.dataset.id;
      if (cb.checked) {
        if (!appState.selectedSessions.includes(sessionId)) {
          appState.selectedSessions.push(sessionId);
        }
      } else {
        appState.selectedSessions = appState.selectedSessions.filter(id => id !== sessionId);
      }
      const newTotal = filteredSessions.length;
      const newSelected = appState.selectedSessions.length;
      const allCheckedNow = newTotal > 0 && newSelected === newTotal;
      const selectAll = document.getElementById('selectAllCheckbox');
      if (selectAll) selectAll.checked = allCheckedNow;
      const infoSpan = document.querySelector('.select-all-info');
      if (infoSpan) infoSpan.textContent = `已选 ${newSelected} / ${newTotal}`;
      updateMultiDeleteBar();
    };
  });

  // 收藏、删除、切换会话
  document.querySelectorAll('.session-item').forEach(item => {
    const sessionId = item.dataset.id;
    const favBtn = item.querySelector('.favorite-btn');
    const delBtn = item.querySelector('.delete-session');
    const titleSpan = item.querySelector('.session-title');

    if (favBtn) {
      favBtn.onclick = (e) => {
        e.stopPropagation();
        const isFav = favBtn.classList.contains('favorited');
        toggleSessionFavorite(sessionId, !isFav);
      };
    }
    if (delBtn) {
      delBtn.onclick = (e) => {
        e.stopPropagation();
        deleteSession(sessionId);
      };
    }
    if (titleSpan) {
      titleSpan.onclick = (e) => {
        e.stopPropagation();
        switchSession(sessionId);
      };
    }
  });
}

// 更新底部多选删除栏
function updateMultiDeleteBar() {
  let bar = document.getElementById('multiDeleteBar');
  const selectedCount = appState.selectedSessions?.length || 0;
  if (selectedCount === 0) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'multiDeleteBar';
    bar.className = 'multi-delete-bar';
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.appendChild(bar);
  }
  bar.innerHTML = `
    <span>已选择 ${selectedCount} 个会话</span>
    <div>
      <button id="cancelMultiSelectBtn">取消</button>
      <button id="confirmMultiDeleteBtn" class="danger">删除</button>
    </div>
  `;
  bar.querySelector('#cancelMultiSelectBtn').onclick = () => {
    appState.selectedSessions = [];
    renderSessionList();
    updateMultiDeleteBar();
  };
  bar.querySelector('#confirmMultiDeleteBtn').onclick = async () => {
    if (confirm(`确定删除 ${selectedCount} 个会话吗？`)) {
      try {
        await deleteSessions(appState.selectedSessions);
        appState.selectedSessions = [];
        renderSessionList();
        updateMultiDeleteBar();
      } catch (err) {
        console.error('批量删除失败:', err);
        alert('删除失败，请稍后重试');
      }
    }
  };
}

// 渲染收藏消息列表
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

// 设置顶部标签页切换
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
  showSessionList();
}