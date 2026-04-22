// frontend/src/modules/voice.js

import TRTC from 'trtc-js-sdk';
import { fetchWithAuth } from '../utils/api';

let client = null;
let localStream = null;
let currentRoomId = null;
let currentUserId = null;
let currentSessionId = null;
let recognition = null;
let isRecognizing = false;
let audioContext = null;
let analyserNode = null;
let animationId = null;
let statusCallback = null;
let volumeCallback = null;
let currentTaskId = null;

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
    startSpeechRecognition();

    const robotRes = await fetchWithAuth('/api/voice/start-robot', {
      method: 'POST',
      body: { roomId, userId, sceneType, sessionId, roleName }
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
      body: { taskId: currentTaskId }
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
      body: { roomId: currentRoomId, userId: currentUserId, sceneType, sessionId, roleName }
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
  stopSpeechRecognition();
  cleanup();
  if (client) await client.leave();
  client = null;
  currentRoomId = null;
  currentUserId = null;
  currentSessionId = null;
}

// 支持参数化静音：如果传入 muted 参数，则强制静音或取消静音；否则切换状态
export async function toggleMute(muted) {
  if (!localStream) return false;
  if (muted !== undefined) {
    // 参数明确指定静音或取消静音
    if (muted) {
      localStream.muteAudio();
    } else {
      localStream.unmuteAudio();
    }
  } else {
    // 无参数时切换状态
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
  if (animationId) cancelAnimationFrame(animationId);
  if (audioContext) audioContext.close();
  if (analyserNode) analyserNode.disconnect();
  if (localStream) localStream.close();
  localStream = null;
  analyserNode = null;
  audioContext = null;
}

function startVolumeDetection(stream, callback) {
  if (!stream.getAudioTrack) return;
  const audioTrack = stream.getAudioTrack();
  if (!audioTrack) return;
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 256;
  source.connect(analyserNode);
  const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
  function update() {
    if (!analyserNode) return;
    analyserNode.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    let volume = Math.min(1, sum / dataArray.length / 128);
    callback(volume);
    animationId = requestAnimationFrame(update);
  }
  update();
}

function startSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'zh-CN';
  let final = '';
  recognition.onresult = async (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += transcript;
      else interim += transcript;
    }
    if (final.trim()) {
      await storeTranscript(final.trim());
      if (window.appendUserMessageToChat) window.appendUserMessageToChat(final.trim());
      final = '';
    }
  };
  recognition.onerror = (e) => console.warn('语音识别错误', e.error);
  recognition.onend = () => { if (client && !isRecognizing) setTimeout(() => recognition?.start(), 500); };
  recognition.start();
  isRecognizing = true;
}

function stopSpeechRecognition() {
  if (recognition) {
    recognition.stop();
    recognition = null;
    isRecognizing = false;
  }
}

async function storeTranscript(text) {
  if (!currentSessionId) return;
  try {
    await fetchWithAuth('/api/voice/transcript', {
      method: 'POST',
      body: { sessionId: currentSessionId, text }
    });
  } catch (err) { console.error('存储转写失败', err); }
}