// frontend/src/modules/auth.js

import { appState, setAppState } from './state';
import { initApp } from '../main';

function showBottomNav(show) {
  const bottomNav = document.getElementById('bottomNav');
  if (bottomNav) {
    bottomNav.style.display = show ? 'flex' : 'none';
  }
}

export function initAuth() {
  const token = localStorage.getItem('token');
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setAppState({ username: payload.username });
      document.getElementById('usernameDisplay').textContent = payload.username;
      document.getElementById('authContainer').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      showBottomNav(true);  // 登录成功显示底部导航
      initApp();
    } catch {
      localStorage.removeItem('token');
      showAuth();
    }
  } else {
    showAuth();
  }
}

function showAuth() {
  document.getElementById('authContainer').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  showBottomNav(false); // 未登录隐藏底部导航
}

export function bindAuthEvents() {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const loginTab = document.getElementById('loginTab');
  const registerTab = document.getElementById('registerTab');
  const loginError = document.getElementById('loginError');
  const registerError = document.getElementById('registerError');

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
      setAppState({ username: data.username });
      document.getElementById('usernameDisplay').textContent = data.username;
      document.getElementById('authContainer').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      showBottomNav(true);
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

  document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('token');
    // 重置全局状态
    appState.currentSessionId = null;
    appState.sessions = [];
    appState.messageFavorites = [];
    appState.currentFilter = 'all';
    appState.currentCategoryFilter = 'all';
    appState.currentView = 'chat';
    appState.username = '';
    appState.userLevel = 1;
    appState.userPoints = 0;
    appState.userNextLevelPoints = 100;
    appState.knowledgeData = [];
    appState.isTyping = false;
    showBottomNav(false);
    showAuth();
  });
}