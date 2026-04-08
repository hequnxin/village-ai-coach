// 登录、注册、token 管理
import { appState, setAppState } from './state';
import { initApp } from '../main';

export function initAuth() {
  const token = localStorage.getItem('token');
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setAppState({ username: payload.username });
      document.getElementById('usernameDisplay').textContent = payload.username;
      document.getElementById('authContainer').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      initApp();  // 在 main.js 中定义的全局初始化函数
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
}

// 绑定登录注册事件（在 main.js 中调用）
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
      initApp();  // 重新初始化应用
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
    showAuth();
  });
}