// frontend/src/utils/api.js
let refreshPromise = null;

export async function refreshToken() {
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

export async function fetchWithAuth(url, options = {}) {
  let token = localStorage.getItem('token');
  if (!token) throw new Error('未登录');
  let res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    }
  });
  if (res.status === 401) {
    const refreshed = await refreshToken();
    if (refreshed) {
      token = localStorage.getItem('token');
      res = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          'Authorization': `Bearer ${token}`
        }
      });
    } else {
      localStorage.removeItem('token');
      window.location.reload();
      throw new Error('登录已过期');
    }
  }
  return res;
}

// ========== 每日任务 API ==========
export async function getDailyTasks() {
  const res = await fetchWithAuth('/api/daily-tasks');
  if (!res.ok) throw new Error('获取每日任务失败');
  return res.json();
}

export async function updateDailyTaskProgress(taskType, delta = 1) {
  const res = await fetchWithAuth('/api/daily-tasks/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskType, delta })
  });
  if (!res.ok) throw new Error('更新任务进度失败');
  return res.json();
}

export async function claimDailyReward() {
  const res = await fetchWithAuth('/api/daily-tasks/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error('领取奖励失败');
  return res.json();
}