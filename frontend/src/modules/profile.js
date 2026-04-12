// frontend/src/modules/profile.js
import { fetchWithAuth } from '../utils/api';
import { appState } from './state';
import { escapeHtml, setActiveNavByView } from '../utils/helpers';
import Chart from 'chart.js/auto';

// ==================== 辅助函数 ====================
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.backgroundColor = type === 'error' ? '#f44336' : '#4caf50';
  toast.style.color = 'white';
  toast.style.padding = '8px 16px';
  toast.style.borderRadius = '30px';
  toast.style.zIndex = '2000';
  toast.style.fontSize = '0.8rem';
  toast.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function animateNumber(element, start, end, duration = 800) {
  if (!element) return;
  let startTime = null;
  const step = (timestamp) => {
    if (!startTime) startTime = timestamp;
    const progress = Math.min(1, (timestamp - startTime) / duration);
    const current = Math.floor(start + (end - start) * progress);
    element.textContent = current;
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// 使用说明弹窗
function showHelpModal() {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content" style="width:500px; max-width:90vw;">
      <button class="modal-close" style="position:absolute;right:12px;top:12px;">&times;</button>
      <h2>📖 使用说明</h2>
      <div style="max-height:60vh; overflow-y:auto; padding-right:8px;">
        <h3>✨ 快速开始</h3>
        <p>1. 登录后，在左侧边栏可以创建新会话。</p>
        <p>2. 在「问答」模块，可以提问乡村治理相关问题，AI会结合知识库回答。</p>
        <p>3. 在「模拟对练」模块，选择场景和模式，与虚拟村民对话练习调解技巧。</p>
        <p>4. 在「会议模式」模块，可召开村民大会或村干部会议，按议程讨论并投票。</p>
        <p>5. 在「案例库」可以查阅政策、案例和常见问题，也可上传自己的知识。</p>
        <p>6. 在「挑战中心」可进行趣味闯关、每日一练、翻牌配对等游戏赚取积分。</p>
        <p>7. 在「我的」页面查看积分、等级、勋章，管理账户。</p>
        <h3>🎯 积分规则</h3>
        <p>• 每次对话 +10 积分</p>
        <p>• 完成每日一练 +10/题，全对额外+20</p>
        <p>• 通关趣味闯关 +50</p>
        <p>• 参加每周竞赛根据得分获得积分</p>
        <p>• 上传知识被采纳 +20</p>
        <h3>💡 小技巧</h3>
        <p>• 按住麦克风按钮可语音输入</p>
        <p>• 在模拟对练中，点击左侧村民可切换对话对象</p>
        <p>• 会议模式支持自定义议程和村民</p>
      </div>
      <button id="closeHelpBtn" style="margin-top:16px; background:#2e5d34; color:white; border:none; padding:8px 16px; border-radius:30px; cursor:pointer;">关闭</button>
    </div>
  `;
  document.body.appendChild(modal);
  const closeModal = () => modal.remove();
  modal.querySelector('.modal-close').onclick = closeModal;
  modal.querySelector('#closeHelpBtn').onclick = closeModal;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
}

// 修改密码弹窗
async function changePassword() {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content" style="width:320px;">
      <button class="modal-close" style="position:absolute;right:12px;top:12px;">&times;</button>
      <h3>🔑 修改密码</h3>
      <div style="margin:16px 0;">
        <input type="password" id="oldPassword" placeholder="当前密码" style="width:100%; padding:8px; margin-bottom:12px; border:1px solid #ccc; border-radius:6px;">
        <input type="password" id="newPassword" placeholder="新密码（至少6位）" style="width:100%; padding:8px; margin-bottom:12px; border:1px solid #ccc; border-radius:6px;">
        <input type="password" id="confirmPassword" placeholder="确认新密码" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:6px;">
      </div>
      <div style="display:flex; gap:12px; justify-content:flex-end;">
        <button id="cancelPwdBtn" style="background:#ccc; border:none; padding:6px 16px; border-radius:6px; cursor:pointer;">取消</button>
        <button id="submitPwdBtn" style="background:#2e5d34; color:white; border:none; padding:6px 16px; border-radius:6px; cursor:pointer;">确认修改</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const closeModal = () => modal.remove();
  modal.querySelector('.modal-close').onclick = closeModal;
  modal.querySelector('#cancelPwdBtn').onclick = closeModal;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  const submitBtn = modal.querySelector('#submitPwdBtn');
  submitBtn.onclick = async () => {
    const oldPwd = modal.querySelector('#oldPassword').value;
    const newPwd = modal.querySelector('#newPassword').value;
    const confirmPwd = modal.querySelector('#confirmPassword').value;
    if (!oldPwd || !newPwd || !confirmPwd) return showToast('请填写完整', 'error');
    if (newPwd !== confirmPwd) return showToast('两次新密码不一致', 'error');
    if (newPwd.length < 6) return showToast('新密码至少6位', 'error');
    try {
      const res = await fetchWithAuth('/api/user/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '修改失败');
      showToast('密码修改成功，请重新登录');
      setTimeout(() => { localStorage.removeItem('token'); window.location.reload(); }, 1500);
    } catch (err) { showToast(err.message, 'error'); } finally { closeModal(); }
  };
}

// 清除缓存
function clearCache() {
  if (confirm('清除缓存会删除本地保存的任务进度和会议模板，是否继续？')) {
    localStorage.removeItem('dailyTasks');
    localStorage.removeItem('meetingTemplates');
    showToast('缓存已清除');
    setTimeout(() => window.location.reload(), 1000);
  }
}

// 意见反馈（请将邮箱替换为真实邮箱）
function openFeedback() {
  // ⚠️ 重要：部署前请将下面的邮箱地址改为你的真实反馈邮箱
  const email = 'support@example.com';
  const subject = encodeURIComponent('村官AI伙伴反馈');
  const body = encodeURIComponent('请描述您的问题或建议：\n\n');
  window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
}

// 错题本跳转
async function goToWrongQuestions() {
  setActiveNavByView('game');
  setTimeout(async () => {
    try {
      const { startWrongClear } = await import('./game');
      if (typeof startWrongClear === 'function') {
        startWrongClear();
      } else {
        showToast('错题本模块加载失败', 'error');
      }
    } catch (err) {
      console.error('加载错题本失败', err);
      showToast('错题本加载失败，请重试', 'error');
    }
  }, 500);
}

// 勋章配置（增加更多勋章）
const allBadges = [
  {
    name: '勤学好问', icon: '📚',
    condition: (stats) => stats.sessionCount >= 10,
    progress: (stats) => Math.min(100, stats.sessionCount / 10 * 100),
    current: (stats) => stats.sessionCount, target: 10,
    description: '对话次数达到10次'
  },
  {
    name: '知识贡献者', icon: '🏅',
    condition: (stats) => stats.approvedUploads >= 3,
    progress: (stats) => Math.min(100, stats.approvedUploads / 3 * 100),
    current: (stats) => stats.approvedUploads, target: 3,
    description: '上传的知识被采纳3次'
  },
  {
    name: '收藏达人', icon: '⭐',
    condition: (stats) => stats.favoriteCount >= 20,
    progress: (stats) => Math.min(100, stats.favoriteCount / 20 * 100),
    current: (stats) => stats.favoriteCount, target: 20,
    description: '收藏消息达到20条'
  },
  {
    name: '会话收藏家', icon: '💬',
    condition: (stats) => stats.favoriteSessionCount >= 5,
    progress: (stats) => Math.min(100, stats.favoriteSessionCount / 5 * 100),
    current: (stats) => stats.favoriteSessionCount, target: 5,
    description: '收藏会话达到5个'
  },
  {
    name: '对话达人', icon: '🗣️',
    condition: (stats) => stats.sessionCount >= 30,
    progress: (stats) => Math.min(100, stats.sessionCount / 30 * 100),
    current: (stats) => stats.sessionCount, target: 30,
    description: '对话次数达到30次'
  },
  {
    name: '挑战王者', icon: '👑',
    condition: (stats) => (stats.funCompleted || 0) >= 3,
    progress: (stats) => Math.min(100, ((stats.funCompleted || 0) / 3) * 100),
    current: (stats) => stats.funCompleted || 0, target: 3,
    description: '完成3个趣味闯关主题'
  }
];

// 显示勋章详情弹窗
function showBadgeDetail(badge, stats) {
  const achieved = badge.condition(stats);
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content" style="width:280px; text-align:center;">
      <button class="modal-close" style="position:absolute;right:12px;top:12px;">&times;</button>
      <div style="font-size:64px; margin:16px 0;">${badge.icon}</div>
      <h3>${badge.name}</h3>
      <p style="margin:12px 0; color:#666;">${badge.description}</p>
      ${!achieved ? `<div style="background:#f5f5f5; padding:8px; border-radius:12px; margin-top:8px;">进度: ${badge.current(stats)}/${badge.target}</div>` : '<div style="color:#4caf50;">✅ 已获得</div>'}
      <button class="close-modal-btn" style="margin-top:16px; background:#2e5d34; color:white; border:none; padding:6px 20px; border-radius:30px; cursor:pointer;">知道了</button>
    </div>
  `;
  document.body.appendChild(modal);
  const closeModal = () => modal.remove();
  modal.querySelector('.modal-close').onclick = closeModal;
  modal.querySelector('.close-modal-btn').onclick = closeModal;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
}

// 渲染勋章（可点击）
function renderBadges(stats) {
  const container = document.getElementById('badges');
  if (!container) return;
  let html = '<div class="badges-scroll">';
  allBadges.forEach(badge => {
    const achieved = badge.condition(stats);
    const progressPercent = badge.progress(stats);
    html += `
      <div class="badge-card ${achieved ? 'achieved' : 'locked'}" data-badge-name="${badge.name}">
        <div class="badge-icon">${badge.icon}</div>
        <div class="badge-name">${badge.name}</div>
        ${!achieved ? `
          <div class="badge-progress-bar"><div class="badge-progress-fill" style="width: ${progressPercent}%;"></div></div>
          <div class="badge-progress-text">${badge.current(stats)}/${badge.target}</div>
        ` : '<div class="badge-achieved">✅ 已获得</div>'}
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;

  // 绑定点击事件
  document.querySelectorAll('.badge-card').forEach(card => {
    card.addEventListener('click', () => {
      const badgeName = card.dataset.badgeName;
      const badge = allBadges.find(b => b.name === badgeName);
      if (badge) showBadgeDetail(badge, stats);
    });
  });
}

// 渲染统计数字（简洁卡片）
function renderStats(stats) {
  const container = document.getElementById('statsGrid');
  if (!container) return;
  container.innerHTML = `
    <div class="stat-mini-card"><div class="stat-mini-icon">💬</div><div class="stat-mini-info"><span class="stat-mini-label">对话次数</span><span class="stat-mini-number" id="stat-sessions">0</span></div></div>
    <div class="stat-mini-card"><div class="stat-mini-icon">⭐</div><div class="stat-mini-info"><span class="stat-mini-label">收藏消息</span><span class="stat-mini-number" id="stat-favMsgs">0</span></div></div>
    <div class="stat-mini-card"><div class="stat-mini-icon">📝</div><div class="stat-mini-info"><span class="stat-mini-label">已采纳上传</span><span class="stat-mini-number" id="stat-approved">0</span></div></div>
    <div class="stat-mini-card"><div class="stat-mini-icon">⏳</div><div class="stat-mini-info"><span class="stat-mini-label">待审核上传</span><span class="stat-mini-number" id="stat-pending">0</span></div></div>
  `;
  animateNumber(document.getElementById('stat-sessions'), 0, stats.sessionCount);
  animateNumber(document.getElementById('stat-favMsgs'), 0, stats.favoriteCount);
  animateNumber(document.getElementById('stat-approved'), 0, stats.approvedUploads);
  animateNumber(document.getElementById('stat-pending'), 0, stats.pendingUploads);
}

// 渲染真实成长曲线
async function renderGrowthChart() {
  const canvas = document.getElementById('growthChart');
  if (!canvas) return;
  try {
    const res = await fetchWithAuth('/api/user/points-history');
    const data = await res.json();
    const ctx = canvas.getContext('2d');
    if (window.growthChartInstance) window.growthChartInstance.destroy();
    window.growthChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.labels,
        datasets: [{
          label: '累计积分',
          data: data.points,
          borderColor: '#2e5d34',
          backgroundColor: 'rgba(46, 93, 52, 0.1)',
          fill: true,
          tension: 0.3,
          pointBackgroundColor: '#2e5d34',
          pointBorderColor: '#fff',
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.raw} 分` } }, legend: { display: false } },
        scales: { y: { beginAtZero: true, title: { display: true, text: '积分' } }, x: { title: { display: true, text: '日期' } } }
      }
    });
  } catch (err) {
    console.error('加载成长曲线失败', err);
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }
}

// ==================== 主渲染函数 ====================
export async function renderProfileView() {
  const isMobile = window.innerWidth <= 768;
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="profile-new">
      <!-- 用户卡片 -->
      <div class="profile-user-card">
        <div class="profile-avatar-large">👤</div>
        <div class="profile-user-info">
          <h2>${escapeHtml(appState.username)}</h2>
          <p>村官 · 基层治理者</p>
        </div>
        <div class="profile-level-badge" id="levelBadge">Lv.1</div>
      </div>

      <!-- 积分与等级进度 -->
      <div class="profile-points-card">
        <div class="points-display">
          <span class="points-label">总积分</span>
          <span class="points-value" id="points">0</span>
        </div>
        <div class="level-progress">
          <div class="level-progress-bar"><div class="level-progress-fill" id="levelProgressFill" style="width:0%"></div></div>
          <div class="level-progress-text"><span id="currentPoints">0</span> / <span id="nextLevelPoints">100</span></div>
        </div>
      </div>

      <!-- 统计网格 -->
      <div class="profile-section-title">📊 数据统计</div>
      <div class="stats-mini-grid" id="statsGrid"></div>

      <!-- 功能入口分组 -->
      <div class="profile-section-title">🛠️ 学习工具</div>
      <div class="action-grid action-grid-tools">
        <button id="wrongQuestionsBtn" class="action-btn-new"><span class="btn-icon">❌</span> 错题本</button>
        <button id="helpBtn" class="action-btn-new"><span class="btn-icon">📖</span> 使用说明</button>
        <button id="feedbackBtn" class="action-btn-new"><span class="btn-icon">💬</span> 意见反馈</button>
      </div>

      <div class="profile-section-title">🔐 账户管理</div>
      <div class="action-grid action-grid-account">
        <button id="changePwdBtn" class="action-btn-new"><span class="btn-icon">🔑</span> 修改密码</button>
        <button id="clearCacheBtn" class="action-btn-new"><span class="btn-icon">🗑️</span> 清除缓存</button>
        <button id="logoutBtn" class="action-btn-new"><span class="btn-icon">🚪</span> 退出登录</button>
      </div>

      <!-- 勋章区域 -->
      <div class="profile-section-title">🏅 我的勋章</div>
      <div id="badges" class="badges-container"></div>

      <!-- 成长曲线 -->
      <div class="profile-section-title">📈 成长曲线</div>
      <div class="growth-chart-container">
        <canvas id="growthChart" width="400" height="200"></canvas>
      </div>

      <!-- 游戏设置 -->
      <div class="profile-section-title">🎮 游戏设置</div>
      <div class="settings-card">
        <label><input type="checkbox" id="audioToggle" checked> 音效</label>
        <label><input type="checkbox" id="particleToggle" checked> 粒子特效</label>
      </div>
    </div>
  `;

  // 加载数据
  try {
    const growthRes = await fetchWithAuth('/api/user/growth');
    const data = await growthRes.json();
    const pointsEl = document.getElementById('points');
    const levelBadge = document.getElementById('levelBadge');
    const currentPointsSpan = document.getElementById('currentPoints');
    const nextLevelPointsSpan = document.getElementById('nextLevelPoints');
    const progressFill = document.getElementById('levelProgressFill');
    if (pointsEl) animateNumber(pointsEl, 0, data.points);
    if (levelBadge) levelBadge.textContent = `Lv.${data.level}`;
    if (currentPointsSpan) currentPointsSpan.textContent = data.points;
    if (nextLevelPointsSpan) nextLevelPointsSpan.textContent = data.nextLevelPoints;
    const percent = (data.points / data.nextLevelPoints) * 100;
    if (progressFill) progressFill.style.width = `${percent}%`;

    // 处理 funCompleted 字段（如果后端未返回则默认为0）
    if (data.stats.funCompleted === undefined) {
      data.stats.funCompleted = 0;
      console.warn('后端未返回 funCompleted 字段，挑战王者勋章进度将显示为0');
    }

    renderBadges(data.stats);
    renderStats(data.stats);
    await renderGrowthChart();
  } catch (err) {
    console.error('加载数据失败', err);
  }

  // 绑定事件
  document.getElementById('audioToggle').addEventListener('change', e => window.audioEnabled = e.target.checked);
  document.getElementById('particleToggle').addEventListener('change', e => {
    window.particleEnabled = e.target.checked;
    if (e.target.checked && !window.particlesCanvas) import('../utils/helpers').then(({ initParticles }) => initParticles());
  });
  document.getElementById('logoutBtn').onclick = () => { if (confirm('确定退出登录吗？')) { localStorage.removeItem('token'); window.location.reload(); } };
  document.getElementById('changePwdBtn').onclick = changePassword;
  document.getElementById('clearCacheBtn').onclick = clearCache;
  document.getElementById('wrongQuestionsBtn').onclick = goToWrongQuestions;
  document.getElementById('feedbackBtn').onclick = openFeedback;
  document.getElementById('helpBtn').onclick = showHelpModal;

  setActiveNavByView('profile');
}