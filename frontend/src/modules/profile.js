import { fetchWithAuth } from '../utils/api';
import { appState } from './state';
import { escapeHtml } from '../utils/helpers';

export async function renderProfileView() {
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="profile-view">
      <div class="profile-header">
        <div class="profile-avatar">👤</div>
        <div class="profile-info"><h2>${escapeHtml(appState.username)}</h2><p>村官</p></div>
      </div>
      <div class="profile-stats">
        <div class="stat-card"><div class="stat-value" id="points">0</div><div class="stat-label">总积分</div></div>
        <div class="stat-card"><div class="stat-value" id="level">Lv.0</div><div class="stat-label">等级</div></div>
        <div class="stat-card"><div class="stat-value" id="nextLevel">0</div><div class="stat-label">距下一级</div></div>
      </div>
      <div class="profile-section"><h3>🏅 勋章</h3><div id="badges" class="badges">加载中...</div></div>
      <div class="profile-section"><h3>📊 统计</h3><div id="stats" class="stats-grid">加载中...</div></div>
      <div class="profile-section"><h3>📈 成长曲线</h3><canvas id="growthChart" width="400" height="200"></canvas></div>
      <div class="profile-section"><h3>🎮 游戏设置</h3>
        <div><label><input type="checkbox" id="audioToggle" checked> 音效</label>
        <label style="margin-left:20px;"><input type="checkbox" id="particleToggle" checked> 粒子特效</label></div>
      </div>
    </div>
  `;

  const growthRes = await fetchWithAuth('/api/user/growth');
  const data = await growthRes.json();
  document.getElementById('points').textContent = data.points;
  document.getElementById('level').textContent = `Lv.${data.level}`;
  const need = data.nextLevelPoints - data.points;
  document.getElementById('nextLevel').textContent = need > 0 ? need : 0;

  const badgesDiv = document.getElementById('badges');
  if (data.badges.length === 0) badgesDiv.innerHTML = '<p>暂无勋章</p>';
  else badgesDiv.innerHTML = data.badges.map(b => `<div class="badge-item"><span class="badge-icon">${b.icon}</span><span class="badge-name">${b.name}</span></div>`).join('');

  document.getElementById('stats').innerHTML = `
    <div class="stat-item">对话次数：${data.stats.sessionCount}</div>
    <div class="stat-item">收藏消息：${data.stats.favoriteCount}</div>
    <div class="stat-item">收藏会话：${data.stats.favoriteSessionCount}</div>
    <div class="stat-item">已采纳上传：${data.stats.approvedUploads}</div>
    <div class="stat-item">待审核上传：${data.stats.pendingUploads}</div>
  `;

  // 简单成长曲线（模拟数据）
  const ctx = document.getElementById('growthChart').getContext('2d');
  const base = Math.max(10, Math.floor(data.points / 7));
  const days = ['周一','周二','周三','周四','周五','周六','周日'];
  const vals = days.map(() => base + Math.floor(Math.random() * 20) - 5);
  const w = 400, h = 200;
  ctx.clearRect(0, 0, w, h);
  const barW = 30, startX = 50;
  const maxVal = Math.max(...vals) * 1.2;
  ctx.fillStyle = '#2e5d34';
  days.forEach((d, i) => {
    const bh = (vals[i] / maxVal) * (h - 50);
    const x = startX + i * (barW + 10);
    const y = h - 30 - bh;
    ctx.fillRect(x, y, barW, bh);
    ctx.fillStyle = '#333';
    ctx.font = '12px Arial';
    ctx.fillText(d, x, h - 10);
    ctx.fillStyle = '#2e5d34';
  });

  const audioToggle = document.getElementById('audioToggle');
  const particleToggle = document.getElementById('particleToggle');
  audioToggle.addEventListener('change', e => {
    window.audioEnabled = e.target.checked;
  });
  particleToggle.addEventListener('change', e => {
    window.particleEnabled = e.target.checked;
    if (e.target.checked && !window.particlesCanvas) {
      import('../utils/helpers').then(({ initParticles }) => initParticles());
    }
  });
}