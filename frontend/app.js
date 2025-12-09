/**
 * PictoChat Clone - Main Application
 * 
 * Features:
 * - Multiple drawing tools (pen, brush, line, rect, circle, fill, eraser)
 * - Custom room creation
 * - Queue replay on reconnect
 * - Canvas snapshots
 * - Undo functionality
 * - Mobile-optimized touch handling
 */

// =============================================================================
// State Management
// =============================================================================

const state = {
  // Connection
  ws: null,
  isConnected: false,
  playerId: generateId(),
  playerName: 'Player',
  
  // Room
  currentRoom: null,
  activePlayers: [],
  
  // Canvas
  canvas: null,
  ctx: null,
  isDrawing: false,
  currentTool: 'pen',
  currentColor: '#000000',
  currentSize: 3,
  
  // Drawing state
  currentStroke: { points: [], color: null, size: null, tool: null },
  shapeStart: null,
  previewCanvas: null,
  previewCtx: null,
  undoStack: [],
  maxUndoSteps: 10,
  
  // Chat
  messages: [],
  
  // Queues for offline mode
  eventQueue: [],
  lastEventTimestamp: 0,
  
  // Reconnection
  reconnectAttempts: 0,
  maxReconnectAttempts: 5,
  reconnectTimeout: null,
  
  // Snapshot
  snapshotInterval: null,
  SNAPSHOT_INTERVAL_MS: 60000
};

// =============================================================================
// Utility Functions
// =============================================================================

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
}

function getWebSocketURL() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host || 'localhost:5000';
  return `${protocol}//${host}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// =============================================================================
// DOM Elements
// =============================================================================

const elements = {
  roomSelectScreen: document.getElementById('room-select-screen'),
  chatScreen: document.getElementById('chat-screen'),
  playerNameInput: document.getElementById('player-name-input'),
  roomList: document.getElementById('room-list'),
  customRoomName: document.getElementById('custom-room-name'),
  createRoomBtn: document.getElementById('create-room-btn'),
  connectionStatusSelect: document.getElementById('connection-status-select'),
  currentRoomName: document.getElementById('current-room-name'),
  leaveRoomBtn: document.getElementById('leave-room-btn'),
  chatLog: document.getElementById('chat-log'),
  playersBar: document.getElementById('players-bar'),
  canvas: document.getElementById('drawing-canvas'),
  drawingIndicator: document.getElementById('drawing-indicator'),
  toolBtns: document.querySelectorAll('.tool-btn'),
  colorBtns: document.querySelectorAll('.color-btn'),
  sizeBtns: document.querySelectorAll('.size-btn'),
  undoBtn: document.getElementById('undo-btn'),
  clearBtn: document.getElementById('clear-btn'),
  messageInput: document.getElementById('message-input'),
  sendBtn: document.getElementById('send-btn'),
  connectionStatus: document.getElementById('connection-status'),
  reconnectBanner: document.getElementById('reconnect-banner'),
  reconnectQueue: document.getElementById('reconnect-queue')
};

// =============================================================================
// WebSocket Connection
// =============================================================================

function connect() {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) return;
  
  console.log('[WS] Connecting...');
  updateConnectionStatus('connecting');
  
  try {
    state.ws = new WebSocket(getWebSocketURL());
    state.ws.onopen = handleOpen;
    state.ws.onmessage = handleMessage;
    state.ws.onclose = handleClose;
    state.ws.onerror = handleError;
  } catch (err) {
    console.error('[WS] Connection error:', err);
    scheduleReconnect();
  }
}

function handleOpen() {
  console.log('[WS] Connected');
  state.isConnected = true;
  state.reconnectAttempts = 0;
  updateConnectionStatus('connected');
  hideReconnectBanner();
  
  if (state.currentRoom) {
    rejoinRoom();
  } else {
    loadRooms();
  }
}

function handleMessage(event) {
  try {
    const message = JSON.parse(event.data);
    console.log('[WS] Received:', message.type);
    
    if (message.timestamp) {
      state.lastEventTimestamp = Math.max(state.lastEventTimestamp, message.timestamp);
    }
    
    switch (message.type) {
      case 'roomState': handleRoomState(message); break;
      case 'rejoinState': handleRejoinState(message); break;
      case 'userJoined': handleUserJoined(message); break;
      case 'userLeft': handleUserLeft(message); break;
      case 'draw': handleRemoteDraw(message); break;
      case 'clear': handleRemoteClear(message); break;
      case 'message': handleChatMessage(message); break;
      case 'drawStart':
      case 'drawEnd': handleDrawIndicator(message); break;
      case 'error':
        console.error('[WS] Server error:', message.message);
        alert(message.message);
        break;
    }
  } catch (err) {
    console.error('[WS] Message parse error:', err);
  }
}

function handleClose(event) {
  console.log('[WS] Disconnected:', event.code);
  state.isConnected = false;
  updateConnectionStatus('disconnected');
  
  if (state.snapshotInterval) {
    clearInterval(state.snapshotInterval);
    state.snapshotInterval = null;
  }
  
  if (state.currentRoom) {
    showReconnectBanner();
    scheduleReconnect();
  }
}

function handleError(error) {
  console.error('[WS] Error:', error);
}

function scheduleReconnect() {
  if (state.reconnectAttempts >= state.maxReconnectAttempts) {
    elements.reconnectBanner.innerHTML = `
      <span>Unable to reconnect. Please refresh.</span>
      <button onclick="location.reload()" class="ds-btn" style="margin-left:12px">Refresh</button>
    `;
    return;
  }
  
  const delay = 3000 * Math.pow(2, state.reconnectAttempts);
  console.log(`[WS] Reconnecting in ${delay}ms`);
  
  state.reconnectTimeout = setTimeout(() => {
    state.reconnectAttempts++;
    connect();
  }, delay);
}

function send(message) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

// =============================================================================
// Room Management
// =============================================================================

async function loadRooms() {
  try {
    const response = await fetch('/api/rooms');
    const data = await response.json();
    renderRoomList(data.rooms);
  } catch (err) {
    console.error('Failed to load rooms:', err);
    renderRoomList([
      { id: 'chat-a', name: 'Chat A', playerCount: 0, maxPlayers: 4 },
      { id: 'chat-b', name: 'Chat B', playerCount: 0, maxPlayers: 4 },
      { id: 'chat-c', name: 'Chat C', playerCount: 0, maxPlayers: 4 },
      { id: 'chat-d', name: 'Chat D', playerCount: 0, maxPlayers: 4 }
    ]);
  }
}

function renderRoomList(rooms) {
  elements.roomList.innerHTML = rooms.map(room => `
    <button class="room-btn ${room.playerCount >= room.maxPlayers ? 'full' : ''} ${room.isCustom ? 'custom' : ''}" 
            data-room-id="${room.id}"
            ${room.playerCount >= room.maxPlayers ? 'disabled' : ''}>
      <span class="room-name">${escapeHtml(room.name)}</span>
      <span class="room-players">${room.playerCount}/${room.maxPlayers}</span>
    </button>
  `).join('');
  
  elements.roomList.querySelectorAll('.room-btn:not(.full)').forEach(btn => {
    btn.addEventListener('click', () => {
      state.playerName = elements.playerNameInput.value.trim() || 'Player';
      joinRoom(btn.dataset.roomId);
    });
  });
}

async function createCustomRoom() {
  const name = elements.customRoomName.value.trim();
  if (!name) {
    alert('Please enter a room name');
    return;
  }
  
  try {
    const response = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      elements.customRoomName.value = '';
      state.playerName = elements.playerNameInput.value.trim() || 'Player';
      joinRoom(data.room.id);
    } else {
      alert(data.error || 'Failed to create room');
    }
  } catch (err) {
    console.error('Failed to create room:', err);
    alert('Failed to create room');
  }
}

function joinRoom(roomId) {
  state.currentRoom = roomId;
  state.eventQueue = [];
  state.lastEventTimestamp = 0;
  
  send({
    type: 'join',
    roomId,
    playerId: state.playerId,
    playerName: state.playerName
  });
}

function rejoinRoom() {
  console.log('[WS] Rejoining room with queue:', state.eventQueue.length, 'events');
  
  send({
    type: 'rejoin',
    roomId: state.currentRoom,
    playerId: state.playerId,
    playerName: state.playerName,
    lastEventTimestamp: state.lastEventTimestamp
  });
  
  // Replay queued events
  if (state.eventQueue.length > 0) {
    send({
      type: 'queueReplay',
      events: state.eventQueue
    });
    state.eventQueue = [];
  }
  
  updateQueueIndicator();
}

function leaveRoom() {
  state.currentRoom = null;
  state.activePlayers = [];
  state.messages = [];
  state.eventQueue = [];
  state.undoStack = [];
  
  if (state.snapshotInterval) {
    clearInterval(state.snapshotInterval);
    state.snapshotInterval = null;
  }
  
  clearCanvas();
  
  elements.chatScreen.classList.remove('active');
  elements.roomSelectScreen.classList.add('active');
  
  if (state.ws) state.ws.close();
  setTimeout(connect, 100);
}

function handleRoomState(message) {
  state.playerId = message.playerId;
  state.playerName = message.playerName;
  state.activePlayers = message.activePlayers || [];
  
  elements.roomSelectScreen.classList.remove('active');
  elements.chatScreen.classList.add('active');
  elements.currentRoomName.textContent = message.roomName;
  
  // Update connection status to connected
  updateConnectionStatus('connected');
  
  renderPlayers();
  
  state.messages = message.chatHistory || [];
  renderChatLog();
  
  // Restore canvas
  clearCanvas();
  
  if (message.canvasSnapshot) {
    loadCanvasSnapshot(message.canvasSnapshot);
  }
  
  (message.drawingEvents || []).forEach(event => {
    renderDrawEvent(event);
  });
  
  // Start snapshot interval
  startSnapshotInterval();
}

function handleRejoinState(message) {
  state.activePlayers = message.activePlayers || [];
  renderPlayers();
  
  state.messages = message.chatHistory || [];
  renderChatLog();
  
  // Restore canvas
  clearCanvas();
  
  if (message.canvasSnapshot) {
    loadCanvasSnapshot(message.canvasSnapshot);
  }
  
  (message.drawingEvents || []).forEach(event => {
    renderDrawEvent(event);
  });
  
  // Apply missed events
  (message.missedEvents || []).forEach(event => {
    renderDrawEvent(event);
  });
  
  addSystemMessage('Reconnected!');
  startSnapshotInterval();
}

function handleUserJoined(message) {
  state.activePlayers.push({
    playerId: message.playerId,
    playerName: message.playerName,
    isDrawing: false
  });
  renderPlayers();
  
  const verb = message.isRejoin ? 'reconnected' : 'joined';
  addSystemMessage(`${message.playerName} ${verb}`);
}

function handleUserLeft(message) {
  state.activePlayers = state.activePlayers.filter(p => p.playerId !== message.playerId);
  renderPlayers();
  addSystemMessage(`${message.playerName} left`);
}

function renderPlayers() {
  elements.playersBar.innerHTML = state.activePlayers.map(player => `
    <div class="player-indicator ${player.isDrawing ? 'drawing' : ''} ${player.playerId === state.playerId ? 'self' : ''}">
      <span class="player-dot"></span>
      <span>${escapeHtml(player.playerName)}${player.playerId === state.playerId ? ' (you)' : ''}</span>
    </div>
  `).join('');
}

// =============================================================================
// Canvas Setup
// =============================================================================

function initCanvas() {
  state.canvas = elements.canvas;
  state.ctx = state.canvas.getContext('2d');
  state.ctx.lineCap = 'round';
  state.ctx.lineJoin = 'round';
  
  // Create preview canvas for shapes
  state.previewCanvas = document.createElement('canvas');
  state.previewCanvas.width = state.canvas.width;
  state.previewCanvas.height = state.canvas.height;
  state.previewCtx = state.previewCanvas.getContext('2d');
  
  // Mouse events
  state.canvas.addEventListener('mousedown', handlePointerStart);
  state.canvas.addEventListener('mousemove', handlePointerMove);
  state.canvas.addEventListener('mouseup', handlePointerEnd);
  state.canvas.addEventListener('mouseleave', handlePointerEnd);
  
  // Touch events
  state.canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
  state.canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
  state.canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
  state.canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });
}

function getCanvasCoords(e) {
  const rect = state.canvas.getBoundingClientRect();
  const scaleX = state.canvas.width / rect.width;
  const scaleY = state.canvas.height / rect.height;
  
  return {
    x: Math.round((e.clientX - rect.left) * scaleX),
    y: Math.round((e.clientY - rect.top) * scaleY)
  };
}

function getTouchCoords(e) {
  const touch = e.touches[0] || e.changedTouches[0];
  const rect = state.canvas.getBoundingClientRect();
  const scaleX = state.canvas.width / rect.width;
  const scaleY = state.canvas.height / rect.height;
  
  return {
    x: Math.round((touch.clientX - rect.left) * scaleX),
    y: Math.round((touch.clientY - rect.top) * scaleY)
  };
}

// =============================================================================
// Drawing - Pointer Handlers
// =============================================================================

function handlePointerStart(e) {
  e.preventDefault();
  startDrawing(getCanvasCoords(e));
}

function handlePointerMove(e) {
  if (!state.isDrawing) return;
  continueDrawing(getCanvasCoords(e));
}

function handlePointerEnd(e) {
  if (!state.isDrawing) return;
  finishDrawing(getCanvasCoords(e));
}

function handleTouchStart(e) {
  e.preventDefault();
  if (e.touches.length === 1) {
    startDrawing(getTouchCoords(e));
  }
}

function handleTouchMove(e) {
  e.preventDefault();
  if (!state.isDrawing || e.touches.length !== 1) return;
  continueDrawing(getTouchCoords(e));
}

function handleTouchEnd(e) {
  e.preventDefault();
  if (!state.isDrawing) return;
  finishDrawing(getTouchCoords(e));
}

// =============================================================================
// Drawing - Core Logic
// =============================================================================

function startDrawing(coords) {
  state.isDrawing = true;
  
  // Save state for undo
  saveUndoState();
  
  const color = state.currentTool === 'eraser' ? '#FFFFFF' : state.currentColor;
  const size = state.currentTool === 'brush' ? state.currentSize * 2 : state.currentSize;
  
  state.currentStroke = {
    points: [coords],
    color: color,
    size: size,
    tool: state.currentTool
  };
  
  state.shapeStart = coords;
  
  // For freehand tools, draw initial point
  if (['pen', 'brush', 'eraser'].includes(state.currentTool)) {
    state.ctx.beginPath();
    state.ctx.fillStyle = color;
    state.ctx.arc(coords.x, coords.y, size / 2, 0, Math.PI * 2);
    state.ctx.fill();
  }
  
  send({ type: 'drawStart', roomId: state.currentRoom, playerId: state.playerId });
}

function continueDrawing(coords) {
  const { currentStroke, currentTool, ctx, canvas, previewCtx, previewCanvas, shapeStart } = state;
  
  if (['pen', 'brush', 'eraser'].includes(currentTool)) {
    // Freehand drawing
    const lastPoint = currentStroke.points[currentStroke.points.length - 1];
    
    ctx.beginPath();
    ctx.strokeStyle = currentStroke.color;
    ctx.lineWidth = currentStroke.size;
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
    
    currentStroke.points.push(coords);
    
  } else if (['line', 'rect', 'circle'].includes(currentTool)) {
    // Shape preview - restore canvas and draw preview
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(previewCanvas, 0, 0);
    
    ctx.strokeStyle = currentStroke.color;
    ctx.lineWidth = currentStroke.size;
    ctx.fillStyle = currentStroke.color;
    
    drawShape(ctx, currentTool, shapeStart, coords, false);
  }
}

function finishDrawing(coords) {
  state.isDrawing = false;
  
  const { currentStroke, currentTool, shapeStart, ctx } = state;
  
  if (['line', 'rect', 'circle'].includes(currentTool) && shapeStart) {
    // Draw final shape
    ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
    ctx.drawImage(state.previewCanvas, 0, 0);
    
    ctx.strokeStyle = currentStroke.color;
    ctx.lineWidth = currentStroke.size;
    
    drawShape(ctx, currentTool, shapeStart, coords, false);
    
    // Store shape data for sync
    currentStroke.points = [shapeStart, coords];
    currentStroke.tool = currentTool;
    
  } else if (currentTool === 'fill') {
    // Flood fill
    floodFill(coords.x, coords.y, state.currentColor);
    currentStroke.points = [coords];
    currentStroke.tool = 'fill';
    currentStroke.color = state.currentColor;
  }
  
  // Save preview for next shape
  state.previewCtx.clearRect(0, 0, state.previewCanvas.width, state.previewCanvas.height);
  state.previewCtx.drawImage(state.canvas, 0, 0);
  
  // Send stroke
  if (currentStroke.points.length > 0) {
    const strokeData = {
      type: 'draw',
      roomId: state.currentRoom,
      points: currentStroke.points,
      color: currentStroke.color,
      size: currentStroke.size,
      tool: currentStroke.tool,
      playerId: state.playerId
    };
    
    if (!send(strokeData)) {
      state.eventQueue.push(strokeData);
      updateQueueIndicator();
    }
  }
  
  state.currentStroke = { points: [], color: null, size: null, tool: null };
  state.shapeStart = null;
  
  send({ type: 'drawEnd', roomId: state.currentRoom, playerId: state.playerId });
}

function drawShape(ctx, tool, start, end, filled = false) {
  ctx.beginPath();
  
  switch (tool) {
    case 'line':
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      break;
      
    case 'rect':
      const width = end.x - start.x;
      const height = end.y - start.y;
      if (filled) {
        ctx.fillRect(start.x, start.y, width, height);
      } else {
        ctx.strokeRect(start.x, start.y, width, height);
      }
      break;
      
    case 'circle':
      const radiusX = Math.abs(end.x - start.x) / 2;
      const radiusY = Math.abs(end.y - start.y) / 2;
      const centerX = start.x + (end.x - start.x) / 2;
      const centerY = start.y + (end.y - start.y) / 2;
      
      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      if (filled) {
        ctx.fill();
      } else {
        ctx.stroke();
      }
      break;
  }
}

function floodFill(startX, startY, fillColor) {
  const ctx = state.ctx;
  const canvas = state.canvas;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  const targetColor = getPixelColor(data, startX, startY, canvas.width);
  const fill = hexToRgb(fillColor);
  
  if (colorsMatch(targetColor, fill)) return;
  
  const stack = [[startX, startY]];
  const visited = new Set();
  
  while (stack.length > 0) {
    const [x, y] = stack.pop();
    const key = `${x},${y}`;
    
    if (visited.has(key)) continue;
    if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) continue;
    
    const currentColor = getPixelColor(data, x, y, canvas.width);
    if (!colorsMatch(currentColor, targetColor)) continue;
    
    visited.add(key);
    setPixelColor(data, x, y, canvas.width, fill);
    
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  
  ctx.putImageData(imageData, 0, 0);
}

function getPixelColor(data, x, y, width) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
}

function setPixelColor(data, x, y, width, color) {
  const idx = (y * width + x) * 4;
  data[idx] = color.r;
  data[idx + 1] = color.g;
  data[idx + 2] = color.b;
  data[idx + 3] = 255;
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

function colorsMatch(c1, c2, tolerance = 10) {
  return Math.abs(c1.r - c2.r) <= tolerance &&
         Math.abs(c1.g - c2.g) <= tolerance &&
         Math.abs(c1.b - c2.b) <= tolerance;
}

// =============================================================================
// Drawing - Remote & Rendering
// =============================================================================

function handleRemoteDraw(message) {
  if (message.playerId === state.playerId) return;
  renderDrawEvent(message);
}

function renderDrawEvent(event) {
  const { points, color, size, tool } = event;
  if (!points || points.length === 0) return;
  
  const ctx = state.ctx;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  if (tool === 'fill' && points.length === 1) {
    floodFill(points[0].x, points[0].y, color);
    
  } else if (['line', 'rect', 'circle'].includes(tool) && points.length >= 2) {
    drawShape(ctx, tool, points[0], points[1], false);
    
  } else {
    // Freehand stroke
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
    }
  }
  
  // Update preview canvas
  state.previewCtx.clearRect(0, 0, state.previewCanvas.width, state.previewCanvas.height);
  state.previewCtx.drawImage(state.canvas, 0, 0);
}

function clearCanvas() {
  if (state.ctx) {
    state.ctx.fillStyle = '#FFFFFF';
    state.ctx.fillRect(0, 0, state.canvas.width, state.canvas.height);
  }
  if (state.previewCtx) {
    state.previewCtx.fillStyle = '#FFFFFF';
    state.previewCtx.fillRect(0, 0, state.previewCanvas.width, state.previewCanvas.height);
  }
}

function handleRemoteClear(message) {
  clearCanvas();
  state.undoStack = [];
  addSystemMessage(`${message.playerName} cleared the canvas`);
}

// =============================================================================
// Undo & Snapshots
// =============================================================================

function saveUndoState() {
  const imageData = state.ctx.getImageData(0, 0, state.canvas.width, state.canvas.height);
  state.undoStack.push(imageData);
  
  if (state.undoStack.length > state.maxUndoSteps) {
    state.undoStack.shift();
  }
}

function undo() {
  if (state.undoStack.length === 0) return;
  
  const imageData = state.undoStack.pop();
  state.ctx.putImageData(imageData, 0, 0);
  
  // Update preview
  state.previewCtx.clearRect(0, 0, state.previewCanvas.width, state.previewCanvas.height);
  state.previewCtx.drawImage(state.canvas, 0, 0);
}

function startSnapshotInterval() {
  if (state.snapshotInterval) {
    clearInterval(state.snapshotInterval);
  }
  
  state.snapshotInterval = setInterval(() => {
    sendCanvasSnapshot();
  }, state.SNAPSHOT_INTERVAL_MS);
}

function sendCanvasSnapshot() {
  if (!state.isConnected || !state.currentRoom) return;
  
  const snapshotData = state.canvas.toDataURL('image/png');
  send({
    type: 'canvasSnapshot',
    roomId: state.currentRoom,
    snapshotData
  });
}

function loadCanvasSnapshot(dataUrl) {
  const img = new Image();
  img.onload = () => {
    state.ctx.drawImage(img, 0, 0);
    state.previewCtx.drawImage(img, 0, 0);
  };
  img.src = dataUrl;
}

// =============================================================================
// Chat
// =============================================================================

function sendMessage() {
  const text = elements.messageInput.value.trim();
  if (!text) return;
  
  const messageData = {
    type: 'message',
    roomId: state.currentRoom,
    text,
    playerId: state.playerId,
    playerName: state.playerName,
    timestamp: Date.now()
  };
  
  if (!send(messageData)) {
    state.eventQueue.push(messageData);
    updateQueueIndicator();
  }
  
  elements.messageInput.value = '';
}

function handleChatMessage(message) {
  state.messages.push(message);
  renderChatLog();
}

function addSystemMessage(text) {
  state.messages.push({ type: 'system', text, timestamp: Date.now() });
  renderChatLog();
}

function renderChatLog() {
  elements.chatLog.innerHTML = state.messages.map(msg => {
    if (msg.type === 'system') {
      return `<div class="chat-message system">${escapeHtml(msg.text)}</div>`;
    }
    const isSelf = msg.playerId === state.playerId;
    return `
      <div class="chat-message">
        <span class="timestamp">[${formatTime(msg.timestamp)}]</span>
        <span class="player-name">${escapeHtml(msg.playerName)}${isSelf ? ' (you)' : ''}:</span>
        ${escapeHtml(msg.text)}
      </div>
    `;
  }).join('');
  
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function handleDrawIndicator(message) {
  const player = state.activePlayers.find(p => p.playerId === message.playerId);
  if (player) {
    player.isDrawing = message.type === 'drawStart';
    renderPlayers();
    
    const drawingPlayers = state.activePlayers.filter(p => p.isDrawing && p.playerId !== state.playerId);
    if (drawingPlayers.length > 0) {
      elements.drawingIndicator.textContent = `${drawingPlayers.map(p => p.playerName).join(', ')} drawing...`;
      elements.drawingIndicator.classList.add('active');
    } else {
      elements.drawingIndicator.classList.remove('active');
    }
  }
}

// =============================================================================
// UI Helpers
// =============================================================================

function updateConnectionStatus(status) {
  const statusEl = state.currentRoom ? elements.connectionStatus : elements.connectionStatusSelect;
  statusEl.className = 'connection-status ' + status;
  statusEl.querySelector('.status-text').textContent = 
    status === 'connected' ? 'Connected' :
    status === 'disconnected' ? 'Disconnected' : 'Connecting...';
}

function showReconnectBanner() {
  elements.reconnectBanner.classList.remove('hidden');
  updateQueueIndicator();
}

function hideReconnectBanner() {
  elements.reconnectBanner.classList.add('hidden');
}

function updateQueueIndicator() {
  const count = state.eventQueue.length;
  if (count > 0) {
    elements.reconnectQueue.textContent = `(${count} queued)`;
  } else {
    elements.reconnectQueue.textContent = '';
  }
}

// =============================================================================
// Tool Controls
// =============================================================================

function initTools() {
  // Tool picker
  elements.toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.toolBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentTool = btn.dataset.tool;
    });
  });
  
  // Color picker
  elements.colorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.colorBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentColor = btn.dataset.color;
      
      // Switch off eraser when color selected
      if (state.currentTool === 'eraser') {
        state.currentTool = 'pen';
        elements.toolBtns.forEach(b => b.classList.remove('active'));
        document.querySelector('[data-tool="pen"]').classList.add('active');
      }
    });
  });
  
  // Size picker
  elements.sizeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.sizeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentSize = parseInt(btn.dataset.size);
    });
  });
  
  // Undo
  elements.undoBtn.addEventListener('click', undo);
  
  // Clear
  elements.clearBtn.addEventListener('click', () => {
    if (confirm('Clear the canvas for everyone?')) {
      clearCanvas();
      state.undoStack = [];
      send({ type: 'clear', roomId: state.currentRoom, playerId: state.playerId });
    }
  });
  
  // Leave room
  elements.leaveRoomBtn.addEventListener('click', leaveRoom);
  
  // Create custom room
  elements.createRoomBtn.addEventListener('click', createCustomRoom);
  elements.customRoomName.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') createCustomRoom();
  });
  
  // Send message
  elements.sendBtn.addEventListener('click', sendMessage);
  elements.messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
}

// =============================================================================
// Initialization
// =============================================================================

function init() {
  console.log('[App] Initializing PictoChat...');
  
  initCanvas();
  clearCanvas();
  initTools();
  
  elements.playerNameInput.value = `Player ${state.playerId.slice(0, 4)}`;
  
  connect();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}