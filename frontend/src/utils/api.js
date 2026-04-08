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