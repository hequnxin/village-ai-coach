// frontend/src/modules/voice.js

import TRTC from 'trtc-js-sdk';
import { fetchWithAuth } from '../utils/api';

let client = null;
let localStream = null;
let currentRoomId = null;
let currentUserId = null;
let currentSessionId = null;
let currentTaskId = null;
let statusCallback = null;
let volumeCallback = null;

// ========== 一句话识别相关变量 ==========
let mediaRecorder = null;
let audioChunks = [];
let isAsrActive = false;

// 简单的 Toast 提示
function showToast(message, type = 'error') {
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
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ========== 一句话识别核心功能 ==========
async function startAsrRecognition() {
  if (isAsrActive) {
    showToast('请勿重复点击', 'error');
    throw new Error('ASR 识别已在进行中');
  }
  isAsrActive = true;
  audioChunks = [];

  try {
    // 1. 获取麦克风权限
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // 2. 创建 MediaRecorder，录制 PCM 格式音频 (需要与后端 VoiceFormat 匹配)
    // 注意：MediaRecorder 默认格式通常是 webm 或 mp4，但腾讯云要求 pcm/wav/mp3 等。
    // 为了简化并确保兼容性，我们限制录音时长为 3 秒，然后发送 base64 编码的数据。
    // 更稳健的做法是使用 AudioContext 处理成 PCM，但为了快速解决问题，我们采用一个折中方案：
    // 直接发送录制的 webm 音频，但修改后端 VoiceFormat 为 webm。
    // 为了避免格式问题，我们直接使用 MediaRecorder 录制 webm 格式，并在后端修改 VoiceFormat 为 webm。
    // 这里我们创建 MediaRecorder，录制 webm 格式。
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };
    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64Audio = reader.result.split(',')[1]; // 去除 data:audio/webm;base64, 前缀
        try {
          // 3. 调用后端识别接口
          const res = await fetchWithAuth('/api/voice/recognize', {
            method: 'POST',
            body: JSON.stringify({ audioBase64: base64Audio }),
          });
          const data = await res.json();
          if (res.ok && data.text) {
            // 4. 识别成功，将文本填入输入框并发送
            if (window.appendUserMessageToChat) {
              window.appendUserMessageToChat(data.text);
            } else {
              const input = document.getElementById('simulateInput') || document.getElementById('meetingInput');
              if (input) {
                input.value = data.text;
                const sendBtn = document.getElementById('simulateSendBtn') || document.getElementById('sendMeetingBtn');
                if (sendBtn) sendBtn.click();
              }
            }
          } else {
            showToast(data.error || '识别失败，请重试', 'error');
          }
        } catch (err) {
          console.error('识别请求失败', err);
          showToast('识别服务异常，请重试', 'error');
        } finally {
          // 5. 清理资源
          stream.getTracks().forEach(track => track.stop());
          isAsrActive = false;
          mediaRecorder = null;
          audioChunks = [];
        }
      };
    };
    mediaRecorder.start();
    // 设置录音时长 (例如 3 秒，可根据需要调整)
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    }, 3000);
  } catch (err) {
    console.error('启动语音识别失败', err);
    showToast('无法获取麦克风权限或启动录音', 'error');
    isAsrActive = false;
    throw err;
  }
}

function stopAsrRecognition() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  isAsrActive = false;
}

// 挂载到全局供 UI 调用（PTT 按住说话）
window.__voiceRecognition = {
  start: startAsrRecognition,
  stop: stopAsrRecognition,
  isActive: () => isAsrActive
};

// ========== TRTC 通话相关（保持原有） ==========

export async function startVoiceCall({ roomId, sceneType, sessionId, roleName, onRemoteAudioReady, onVolumeChange, onStatusChange }) {
  try {
    if (client) return false;
    currentRoomId = roomId;
    currentSessionId = sessionId;
    if (onStatusChange) statusCallback = onStatusChange;
    if (onVolumeChange) volumeCallback = onVolumeChange;
    if (onStatusChange) onStatusChange('connecting');

    const sigRes = await fetchWithAuth('/api/voice/get-user-sig', { method: 'POST' });
    const { userSig, sdkAppId, userId } = await sigRes.json();
    currentUserId = userId;

    client = TRTC.createClient({ mode: 'rtc', sdkAppId, userId, userSig });
    client.on('stream-added', event => client.subscribe(event.stream));
    client.on('stream-subscribed', event => {
      event.stream.play('remote-audio');
      if (onRemoteAudioReady) onRemoteAudioReady();
      if (onStatusChange) onStatusChange('ai_speaking');
    });

    await client.join({ roomId: Number(roomId) });
    localStream = TRTC.createStream({ userId, audio: true, video: false });
    await localStream.initialize();
    await client.publish(localStream);
    if (onVolumeChange) startVolumeDetection(localStream, onVolumeChange);

    const robotRes = await fetchWithAuth('/api/voice/start-robot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, userId, sceneType, sessionId, roleName })
    });
    const robotData = await robotRes.json();
    if (!robotRes.ok) throw new Error(robotData.error);
    currentTaskId = robotData.taskId;

    if (onStatusChange) onStatusChange('speaking');
    return true;
  } catch (err) {
    console.error('通话启动失败', err);
    cleanup();
    return false;
  }
}

export async function stopRobot() {
  if (!currentTaskId) return;
  try {
    await fetchWithAuth('/api/voice/stop-robot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: currentTaskId, roomId: currentRoomId })
    });
    currentTaskId = null;
    console.log('✅ 机器人已停止');
  } catch (err) {
    console.error('停止机器人失败', err);
  }
}

export async function restartRobot({ sceneType, sessionId, roleName }) {
  if (!currentRoomId || !currentUserId) {
    console.error('无法重启机器人：缺少房间信息');
    return false;
  }
  await stopRobot();
  await new Promise(resolve => setTimeout(resolve, 500));
  try {
    const robotRes = await fetchWithAuth('/api/voice/start-robot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: currentRoomId, userId: currentUserId, sceneType, sessionId, roleName })
    });
    const robotData = await robotRes.json();
    if (!robotRes.ok) throw new Error(robotData.error);
    currentTaskId = robotData.taskId;
    console.log(`✅ 机器人已切换为: ${roleName}`);
    return true;
  } catch (err) {
    console.error('重启机器人失败', err);
    return false;
  }
}

export async function stopVoiceCall() {
  await stopRobot();
  stopAsrRecognition();
  cleanup();
  if (client) await client.leave();
  client = null;
  currentRoomId = null;
  currentUserId = null;
  currentSessionId = null;
}

export async function toggleMute(muted) {
  if (!localStream) return false;
  if (muted !== undefined) {
    if (muted) {
      localStream.muteAudio();
    } else {
      localStream.unmuteAudio();
    }
  } else {
    const currentlyMuted = localStream._muted;
    if (currentlyMuted) {
      localStream.unmuteAudio();
    } else {
      localStream.muteAudio();
    }
  }
  return !localStream._muted;
}

export function isInVoiceCall() { return client !== null; }

function cleanup() {
  if (localStream) localStream.close();
  localStream = null;
}

function startVolumeDetection(stream, callback) {
  if (!stream.getAudioTrack) return;
  const audioTrack = stream.getAudioTrack();
  if (!audioTrack) return;
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(new MediaStream([audioTrack]));
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  let animationId;
  function update() {
    if (!analyser) return;
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    let volume = Math.min(1, sum / dataArray.length / 128);
    callback(volume);
    animationId = requestAnimationFrame(update);
  }
  update();
  window.__volumeDetectionCleanup = () => {
    if (animationId) cancelAnimationFrame(animationId);
    audioCtx.close();
  };
}