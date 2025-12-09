/**
 * PictoChat Clone - Backend Server
 * 
 * Express HTTP server with WebSocket support for real-time drawing and chat.
 * Features:
 * - SQLite database for persistence
 * - Custom room creation
 * - Canvas snapshots
 * - Queue replay on reconnect
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const db = require('./db');
const RoomManager = require('./roomManager');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Room manager instance (initialized after DB)
let roomManager = null;

// =============================================================================
// REST API Endpoints
// =============================================================================

/**
 * GET /api/rooms
 * Returns list of available chat rooms with player counts
 */
app.get('/api/rooms', (req, res) => {
  const rooms = roomManager.getAllRooms();
  res.json({ rooms });
});

/**
 * POST /api/rooms
 * Create a custom room
 */
app.post('/api/rooms', (req, res) => {
  const { name } = req.body;
  
  if (!name || name.trim().length === 0) {
    return res.status(400).json({ error: 'Room name required' });
  }
  
  if (name.trim().length > 20) {
    return res.status(400).json({ error: 'Room name too long (max 20 characters)' });
  }
  
  const roomId = `custom-${uuidv4().slice(0, 8)}`;
  const room = roomManager.createRoom(name.trim(), roomId, true);
  res.json({ room });
});

/**
 * DELETE /api/rooms/:roomId
 * Delete a custom room (only if empty)
 */
app.delete('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  
  const roomInfo = roomManager.getRoomInfo(roomId);
  if (!roomInfo) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  if (!roomInfo.isCustom) {
    return res.status(403).json({ error: 'Cannot delete default rooms' });
  }
  
  if (roomInfo.playerCount > 0) {
    return res.status(400).json({ error: 'Cannot delete room with active players' });
  }
  
  roomManager.deleteRoom(roomId);
  res.json({ success: true });
});

/**
 * GET /api/rooms/:roomId/history
 * Get chat history for a room
 */
app.get('/api/rooms/:roomId/history', (req, res) => {
  const { roomId } = req.params;
  const history = roomManager.getChatHistory(roomId);
  res.json({ history });
});

// =============================================================================
// WebSocket Connection Handling
// =============================================================================

wss.on('connection', (ws) => {
  let playerId = null;
  let playerName = null;
  let currentRoomId = null;
  let lastDisconnectTime = null;

  console.log('[WS] New connection established');

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      handleMessage(ws, message);
    } catch (err) {
      console.error('[WS] Invalid message format:', err);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    if (currentRoomId && playerId) {
      console.log(`[WS] Player ${playerName} (${playerId}) disconnected from ${currentRoomId}`);
      
      // Remove player from room
      roomManager.removePlayer(currentRoomId, playerId);
      
      // Broadcast leave notification to room
      broadcastToRoom(currentRoomId, {
        type: 'userLeft',
        playerId,
        playerName,
        timestamp: Date.now()
      }, playerId);
    }
  });

  ws.on('error', (err) => {
    console.error('[WS] Connection error:', err);
  });

  /**
   * Handle incoming WebSocket messages
   */
  function handleMessage(ws, message) {
    const { type } = message;

    switch (type) {
      case 'join':
        handleJoin(ws, message);
        break;
      
      case 'rejoin':
        handleRejoin(ws, message);
        break;
      
      case 'draw':
        handleDraw(ws, message);
        break;
      
      case 'clear':
        handleClear(ws, message);
        break;
      
      case 'message':
        handleChatMessage(ws, message);
        break;
      
      case 'drawStart':
        handleDrawIndicator(ws, message, true);
        break;
      
      case 'drawEnd':
        handleDrawIndicator(ws, message, false);
        break;
      
      case 'canvasSnapshot':
        handleCanvasSnapshot(ws, message);
        break;
      
      case 'queueReplay':
        handleQueueReplay(ws, message);
        break;
      
      default:
        console.warn(`[WS] Unknown message type: ${type}`);
    }
  }

  /**
   * Handle player joining a room
   */
  function handleJoin(ws, message) {
    const { roomId, playerId: pid, playerName: pname } = message;
    
    playerId = pid || uuidv4();
    playerName = pname || `Player ${playerId.slice(0, 4)}`;
    currentRoomId = roomId;

    // Check if room exists
    if (!roomManager.roomExists(roomId)) {
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Room does not exist' 
      }));
      return;
    }

    // Add player to room
    const player = { playerId, playerName, ws, isDrawing: false };
    const added = roomManager.addPlayer(roomId, player);
    
    if (!added) {
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Room is full' 
      }));
      return;
    }

    console.log(`[WS] ${playerName} (${playerId}) joined ${roomId}`);

    // Send room state to the new player
    const roomState = roomManager.getRoomState(roomId);
    ws.send(JSON.stringify({
      type: 'roomState',
      ...roomState,
      playerId, // Confirm their ID
      playerName
    }));

    // Broadcast join notification to other players
    broadcastToRoom(roomId, {
      type: 'userJoined',
      playerId,
      playerName,
      timestamp: Date.now()
    }, playerId);
  }

  /**
   * Handle player rejoining after disconnect
   */
  function handleRejoin(ws, message) {
    const { roomId, playerId: pid, playerName: pname, lastEventTimestamp } = message;
    
    playerId = pid;
    playerName = pname;
    currentRoomId = roomId;

    // Check if room exists
    if (!roomManager.roomExists(roomId)) {
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Room no longer exists' 
      }));
      return;
    }

    // Add player back to room
    const player = { playerId, playerName, ws, isDrawing: false };
    const added = roomManager.addPlayer(roomId, player);
    
    if (!added) {
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Room is full' 
      }));
      return;
    }

    console.log(`[WS] ${playerName} (${playerId}) rejoined ${roomId}`);

    // Send current room state
    const roomState = roomManager.getRoomState(roomId);
    
    // If they have a lastEventTimestamp, only send events after that
    let missedEvents = [];
    if (lastEventTimestamp && roomState.drawingEvents) {
      missedEvents = roomState.drawingEvents.filter(e => e.timestamp > lastEventTimestamp);
    }
    
    ws.send(JSON.stringify({
      type: 'rejoinState',
      ...roomState,
      missedEvents,
      playerId,
      playerName
    }));

    // Broadcast rejoin notification
    broadcastToRoom(roomId, {
      type: 'userJoined',
      playerId,
      playerName,
      isRejoin: true,
      timestamp: Date.now()
    }, playerId);
  }

  /**
   * Handle drawing events
   */
  function handleDraw(ws, message) {
    if (!currentRoomId || !playerId) return;

    const { points, color, size, tool } = message;
    
    const drawEvent = {
      type: 'draw',
      points,
      color,
      size,
      tool: tool || 'pen',
      playerId,
      timestamp: Date.now()
    };

    // Store the drawing event
    roomManager.addDrawingEvent(currentRoomId, drawEvent);

    // Broadcast to all other players in the room
    broadcastToRoom(currentRoomId, drawEvent, playerId);
  }

  /**
   * Handle canvas clear events
   */
  function handleClear(ws, message) {
    if (!currentRoomId || !playerId) return;

    const clearEvent = {
      type: 'clear',
      playerId,
      playerName,
      timestamp: Date.now()
    };

    // Clear canvas state in room manager
    roomManager.clearCanvas(currentRoomId);

    // Broadcast to all players including sender
    broadcastToRoom(currentRoomId, clearEvent);
  }

  /**
   * Handle chat messages
   */
  function handleChatMessage(ws, message) {
    if (!currentRoomId || !playerId) return;

    const { text } = message;
    
    // Validate message
    if (!text || text.trim().length === 0) return;
    if (text.length > 140) return; // DS-like character limit

    const chatMessage = {
      type: 'message',
      text: text.trim(),
      playerId,
      playerName,
      timestamp: Date.now()
    };

    // Store in chat history
    roomManager.addChatMessage(currentRoomId, chatMessage);

    // Broadcast to all players including sender
    broadcastToRoom(currentRoomId, chatMessage);
  }

  /**
   * Handle drawing indicator (player is drawing / stopped drawing)
   */
  function handleDrawIndicator(ws, message, isDrawing) {
    if (!currentRoomId || !playerId) return;

    // Update player state
    roomManager.setPlayerDrawing(currentRoomId, playerId, isDrawing);

    // Broadcast indicator to other players
    broadcastToRoom(currentRoomId, {
      type: isDrawing ? 'drawStart' : 'drawEnd',
      playerId,
      playerName
    }, playerId);
  }

  /**
   * Handle canvas snapshot from client
   */
  function handleCanvasSnapshot(ws, message) {
    if (!currentRoomId || !playerId) return;

    const { snapshotData } = message;
    
    if (snapshotData) {
      roomManager.saveCanvasSnapshot(currentRoomId, snapshotData);
    }
  }

  /**
   * Handle queued events replay from reconnecting client
   */
  function handleQueueReplay(ws, message) {
    if (!currentRoomId || !playerId) return;

    const { events } = message;
    
    if (!Array.isArray(events)) return;

    console.log(`[WS] Replaying ${events.length} queued events from ${playerName}`);

    events.forEach(event => {
      if (event.type === 'draw') {
        const drawEvent = {
          type: 'draw',
          points: event.points,
          color: event.color,
          size: event.size,
          tool: event.tool || 'pen',
          playerId,
          timestamp: event.timestamp || Date.now()
        };
        
        roomManager.addDrawingEvent(currentRoomId, drawEvent);
        broadcastToRoom(currentRoomId, drawEvent, playerId);
      } else if (event.type === 'message') {
        const chatMessage = {
          type: 'message',
          text: event.text,
          playerId,
          playerName,
          timestamp: event.timestamp || Date.now()
        };
        
        roomManager.addChatMessage(currentRoomId, chatMessage);
        broadcastToRoom(currentRoomId, chatMessage);
      }
    });
  }
});

/**
 * Broadcast a message to all players in a room
 */
function broadcastToRoom(roomId, message, excludePlayerId = null) {
  const players = roomManager.getPlayersInRoom(roomId);
  const messageStr = JSON.stringify(message);

  players.forEach(player => {
    if (player.playerId !== excludePlayerId && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(messageStr);
    }
  });
}

// =============================================================================
// Server Initialization
// =============================================================================

async function startServer() {
  try {
    // Initialize database
    await db.initDatabase();
    
    // Initialize room manager
    roomManager = new RoomManager();
    await roomManager.initializeDefaultRooms();
    
    // Start periodic cleanup
    setInterval(() => {
      roomManager.cleanupInactiveRooms();
      db.cleanupOldData();
    }, 60 * 60 * 1000); // Every hour
    
    // Start server
    server.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════════╗
║           PictoChat Clone Server               ║
║────────────────────────────────────────────────║
║  HTTP Server: http://localhost:${PORT}            ║
║  WebSocket:   ws://localhost:${PORT}              ║
║────────────────────────────────────────────────║
║  Features:                                     ║
║  ✓ SQLite Database Persistence                 ║
║  ✓ Custom Room Creation                        ║
║  ✓ Canvas Snapshots                            ║
║  ✓ Queue Replay on Reconnect                   ║
║────────────────────────────────────────────────║
║  Default Rooms: Chat A, B, C, D                ║
╚════════════════════════════════════════════════╝
      `);
    });
    
    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n[Server] Shutting down...');
      db.saveDatabase();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('\n[Server] Shutting down...');
      db.saveDatabase();
      process.exit(0);
    });
    
  } catch (err) {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  }
}

startServer();

module.exports = { app, server, wss };