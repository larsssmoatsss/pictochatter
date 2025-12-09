/**
 * Room Manager
 * 
 * Handles room state with database persistence:
 * - Player tracking (in-memory for active connections)
 * - Chat history (persisted to database)
 * - Canvas drawing events (persisted to database)
 * - Canvas snapshots (periodic saves)
 */

const db = require('./db');

class RoomManager {
  constructor() {
    // In-memory state for active connections
    this.activeRooms = new Map(); // roomId -> { players, lastActivity }
    
    // Configuration
    this.MAX_PLAYERS_PER_ROOM = 4;
    this.MAX_CHAT_HISTORY = 50;
    this.MAX_DRAWING_EVENTS_MEMORY = 500;
    this.SNAPSHOT_INTERVAL = 60000; // Save canvas snapshot every 60 seconds
    
    // Start snapshot interval
    this.snapshotInterval = setInterval(() => this.saveAllSnapshots(), this.SNAPSHOT_INTERVAL);
  }

  /**
   * Initialize default rooms in database
   */
  async initializeDefaultRooms() {
    const defaultRooms = ['A', 'B', 'C', 'D'];
    
    for (const name of defaultRooms) {
      const roomId = `chat-${name.toLowerCase()}`;
      const existing = db.getRoom(roomId);
      
      if (!existing) {
        db.createRoom(roomId, `Chat ${name}`, false);
        console.log(`[RoomManager] Created default room: Chat ${name}`);
      }
    }
  }

  /**
   * Create a new room
   */
  createRoom(name, roomId, isCustom = false) {
    // Save to database
    db.createRoom(roomId, name, isCustom);
    
    console.log(`[RoomManager] Created room: ${name} (${roomId})`);
    return this.getRoomInfo(roomId);
  }

  /**
   * Check if a room exists
   */
  roomExists(roomId) {
    return db.getRoom(roomId) !== null;
  }

  /**
   * Get all rooms with their current state
   */
  getAllRooms() {
    const dbRooms = db.getAllRooms();
    
    return dbRooms.map(room => ({
      id: room.id,
      name: room.name,
      playerCount: this.getActivePlayerCount(room.id),
      maxPlayers: room.max_players || this.MAX_PLAYERS_PER_ROOM,
      isCustom: room.is_custom === 1
    }));
  }

  /**
   * Get room info (safe for client consumption)
   */
  getRoomInfo(roomId) {
    const room = db.getRoom(roomId);
    if (!room) return null;

    return {
      id: room.id,
      name: room.name,
      playerCount: this.getActivePlayerCount(roomId),
      maxPlayers: room.max_players || this.MAX_PLAYERS_PER_ROOM,
      isCustom: room.is_custom === 1
    };
  }

  /**
   * Get or create active room state
   */
  getActiveRoom(roomId) {
    if (!this.activeRooms.has(roomId)) {
      this.activeRooms.set(roomId, {
        players: new Map(),
        drawingEventsCache: [], // In-memory cache for fast access
        lastActivity: Date.now()
      });
    }
    return this.activeRooms.get(roomId);
  }

  /**
   * Get active player count for a room
   */
  getActivePlayerCount(roomId) {
    const activeRoom = this.activeRooms.get(roomId);
    return activeRoom ? activeRoom.players.size : 0;
  }

  /**
   * Add a player to a room
   */
  addPlayer(roomId, player) {
    const room = db.getRoom(roomId);
    if (!room) return false;

    const activeRoom = this.getActiveRoom(roomId);
    
    if (activeRoom.players.size >= (room.max_players || this.MAX_PLAYERS_PER_ROOM)) {
      console.log(`[RoomManager] Room ${roomId} is full`);
      return false;
    }

    activeRoom.players.set(player.playerId, player);
    activeRoom.lastActivity = Date.now();
    
    console.log(`[RoomManager] Player ${player.playerName} added to ${roomId}`);
    return true;
  }

  /**
   * Remove a player from a room
   */
  removePlayer(roomId, playerId) {
    const activeRoom = this.activeRooms.get(roomId);
    if (!activeRoom) return false;

    const removed = activeRoom.players.delete(playerId);
    
    if (removed) {
      console.log(`[RoomManager] Player ${playerId} removed from ${roomId}`);
      
      // If room is empty and custom, consider cleanup
      if (activeRoom.players.size === 0) {
        const room = db.getRoom(roomId);
        if (room && room.is_custom === 1) {
          // Keep custom rooms for a while, cleanup handled elsewhere
          activeRoom.lastActivity = Date.now();
        }
      }
    }
    
    return removed;
  }

  /**
   * Get all players in a room
   */
  getPlayersInRoom(roomId) {
    const activeRoom = this.activeRooms.get(roomId);
    if (!activeRoom) return [];
    return Array.from(activeRoom.players.values());
  }

  /**
   * Get the current state of a room for syncing
   */
  getRoomState(roomId) {
    const room = db.getRoom(roomId);
    if (!room) return null;

    const activeRoom = this.getActiveRoom(roomId);

    // Get active players info (without ws reference)
    const activePlayers = Array.from(activeRoom.players.values()).map(p => ({
      playerId: p.playerId,
      playerName: p.playerName,
      isDrawing: p.isDrawing || false
    }));

    // Get chat history from database
    const chatHistory = db.getChatHistory(roomId, this.MAX_CHAT_HISTORY);

    // Get drawing events - first check for snapshot, then get events after
    const snapshot = db.getCanvasSnapshot(roomId);
    let drawingEvents = [];
    
    if (snapshot) {
      // Get events after the snapshot
      drawingEvents = db.getDrawingEvents(roomId, snapshot.timestamp);
    } else {
      // No snapshot, get all recent events
      drawingEvents = db.getDrawingEvents(roomId, 0);
    }

    return {
      roomId: room.id,
      roomName: room.name,
      activePlayers,
      chatHistory,
      drawingEvents,
      canvasSnapshot: snapshot ? snapshot.snapshotData : null
    };
  }

  /**
   * Add a chat message to room history
   */
  addChatMessage(roomId, message) {
    db.addChatMessage(
      roomId,
      message.playerId,
      message.playerName,
      message.text,
      message.timestamp
    );
    
    const activeRoom = this.activeRooms.get(roomId);
    if (activeRoom) {
      activeRoom.lastActivity = Date.now();
    }
  }

  /**
   * Get chat history for a room
   */
  getChatHistory(roomId) {
    return db.getChatHistory(roomId, this.MAX_CHAT_HISTORY);
  }

  /**
   * Add a drawing event to the room
   */
  addDrawingEvent(roomId, event) {
    // Save to database
    db.addDrawingEvent(
      roomId,
      event.playerId,
      event.type || 'draw',
      {
        points: event.points,
        color: event.color,
        size: event.size,
        tool: event.tool
      },
      event.timestamp
    );
    
    // Also cache in memory for fast access
    const activeRoom = this.getActiveRoom(roomId);
    activeRoom.drawingEventsCache.push(event);
    
    // Limit memory cache
    if (activeRoom.drawingEventsCache.length > this.MAX_DRAWING_EVENTS_MEMORY) {
      activeRoom.drawingEventsCache = activeRoom.drawingEventsCache.slice(-this.MAX_DRAWING_EVENTS_MEMORY);
    }
    
    activeRoom.lastActivity = Date.now();
  }

  /**
   * Clear the canvas for a room
   */
  clearCanvas(roomId) {
    // Clear from database
    db.clearDrawingEvents(roomId);
    db.clearCanvasSnapshot(roomId);
    
    // Clear memory cache
    const activeRoom = this.activeRooms.get(roomId);
    if (activeRoom) {
      activeRoom.drawingEventsCache = [];
      activeRoom.lastActivity = Date.now();
    }
    
    console.log(`[RoomManager] Canvas cleared for room ${roomId}`);
  }

  /**
   * Save canvas snapshot for a room
   */
  saveCanvasSnapshot(roomId, snapshotData) {
    db.saveCanvasSnapshot(roomId, snapshotData, Date.now());
    
    // Clear old drawing events since we have a snapshot
    const activeRoom = this.activeRooms.get(roomId);
    if (activeRoom) {
      activeRoom.drawingEventsCache = [];
    }
    
    console.log(`[RoomManager] Canvas snapshot saved for room ${roomId}`);
  }

  /**
   * Save snapshots for all active rooms
   */
  saveAllSnapshots() {
    // This would be called by clients sending their canvas state
    // For now, just log
    console.log('[RoomManager] Snapshot interval tick');
  }

  /**
   * Update a player's drawing state
   */
  setPlayerDrawing(roomId, playerId, isDrawing) {
    const activeRoom = this.activeRooms.get(roomId);
    if (!activeRoom) return;

    const player = activeRoom.players.get(playerId);
    if (player) {
      player.isDrawing = isDrawing;
    }
  }

  /**
   * Delete a custom room
   */
  deleteRoom(roomId) {
    const room = db.getRoom(roomId);
    if (!room || room.is_custom !== 1) {
      return false; // Can't delete default rooms
    }
    
    db.deleteRoom(roomId);
    this.activeRooms.delete(roomId);
    
    console.log(`[RoomManager] Deleted custom room ${roomId}`);
    return true;
  }

  /**
   * Cleanup inactive custom rooms
   */
  cleanupInactiveRooms(maxInactiveMs = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    
    this.activeRooms.forEach((activeRoom, roomId) => {
      if (activeRoom.players.size === 0 && now - activeRoom.lastActivity > maxInactiveMs) {
        const room = db.getRoom(roomId);
        if (room && room.is_custom === 1) {
          this.deleteRoom(roomId);
        }
      }
    });
  }
}

module.exports = RoomManager;