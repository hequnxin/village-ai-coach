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
// 轮询消息状态（返回一个可取消的轮询对象）
export function pollMessageStatus(messageId, onComplete, onPending, interval = 2000) {
  let timer = null;
  let stopped = false;

  const check = async () => {
    if (stopped) return;
    try {
      const res = await fetchWithAuth(`/api/chat-async/status/${messageId}`);
      const data = await res.json();
      if (data.status === 'completed') {
        if (onComplete) onComplete(data.content);
        if (timer) clearInterval(timer);
      } else {
        if (onPending) onPending();
      }
    } catch (err) {
      console.error('轮询失败', err);
    }
  };

  timer = setInterval(check, interval);
  check(); // 立即执行一次

  // 返回取消函数
  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}