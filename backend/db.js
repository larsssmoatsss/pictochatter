/**
 * Database Module
 * 
 * SQLite database for persistent storage of:
 * - Rooms
 * - Chat messages
 * - Canvas snapshots
 * - Drawing events
 * 
 * Uses sql.js (SQLite compiled to WebAssembly) for compatibility
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/pictochat.db');

let db = null;

/**
 * Initialize the database
 */
async function initDatabase() {
  const SQL = await initSqlJs();
  
  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // Load existing database or create new one
  try {
    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(fileBuffer);
      console.log('[DB] Loaded existing database');
    } else {
      db = new SQL.Database();
      console.log('[DB] Created new database');
    }
  } catch (err) {
    console.error('[DB] Error loading database, creating new one:', err);
    db = new SQL.Database();
  }
  
  // Create tables
  createTables();
  
  // Save periodically (every 30 seconds)
  setInterval(saveDatabase, 30000);
  
  return db;
}

/**
 * Create database tables
 */
function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      max_players INTEGER DEFAULT 4,
      is_custom INTEGER DEFAULT 0
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      message TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY(room_id) REFERENCES rooms(id)
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS canvas_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      snapshot_data TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY(room_id) REFERENCES rooms(id)
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS drawing_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_data TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY(room_id) REFERENCES rooms(id)
    )
  `);
  
  // Create indexes for faster queries
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_room ON chat_messages(room_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON chat_messages(timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_drawing_room ON drawing_events(room_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_room ON canvas_snapshots(room_id)`);
  
  console.log('[DB] Tables created/verified');
}

/**
 * Save database to disk
 */
function saveDatabase() {
  if (!db) return;
  
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
    console.log('[DB] Database saved to disk');
  } catch (err) {
    console.error('[DB] Error saving database:', err);
  }
}

// =============================================================================
// Room Operations
// =============================================================================

function createRoom(id, name, isCustom = false) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO rooms (id, name, created_at, max_players, is_custom)
    VALUES (?, ?, ?, 4, ?)
  `);
  stmt.run([id, name, Date.now(), isCustom ? 1 : 0]);
  stmt.free();
}

function getRoom(roomId) {
  const stmt = db.prepare(`SELECT * FROM rooms WHERE id = ?`);
  stmt.bind([roomId]);
  
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function getAllRooms() {
  const results = [];
  const stmt = db.prepare(`SELECT * FROM rooms ORDER BY is_custom, name`);
  
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function deleteRoom(roomId) {
  // Delete associated data first
  db.run(`DELETE FROM chat_messages WHERE room_id = ?`, [roomId]);
  db.run(`DELETE FROM drawing_events WHERE room_id = ?`, [roomId]);
  db.run(`DELETE FROM canvas_snapshots WHERE room_id = ?`, [roomId]);
  db.run(`DELETE FROM rooms WHERE id = ?`, [roomId]);
}

// =============================================================================
// Chat Message Operations
// =============================================================================

function addChatMessage(roomId, playerId, playerName, message, timestamp) {
  const stmt = db.prepare(`
    INSERT INTO chat_messages (room_id, player_id, player_name, message, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run([roomId, playerId, playerName, message, timestamp]);
  stmt.free();
}

function getChatHistory(roomId, limit = 50) {
  const results = [];
  const stmt = db.prepare(`
    SELECT * FROM chat_messages 
    WHERE room_id = ? 
    ORDER BY timestamp DESC 
    LIMIT ?
  `);
  stmt.bind([roomId, limit]);
  
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  
  // Return in chronological order
  return results.reverse().map(row => ({
    playerId: row.player_id,
    playerName: row.player_name,
    text: row.message,
    timestamp: row.timestamp
  }));
}

function clearChatHistory(roomId) {
  db.run(`DELETE FROM chat_messages WHERE room_id = ?`, [roomId]);
}

// =============================================================================
// Drawing Event Operations
// =============================================================================

function addDrawingEvent(roomId, playerId, eventType, eventData, timestamp) {
  const stmt = db.prepare(`
    INSERT INTO drawing_events (room_id, player_id, event_type, event_data, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run([roomId, playerId, eventType, JSON.stringify(eventData), timestamp]);
  stmt.free();
}

function getDrawingEvents(roomId, sinceTimestamp = 0) {
  const results = [];
  const stmt = db.prepare(`
    SELECT * FROM drawing_events 
    WHERE room_id = ? AND timestamp > ?
    ORDER BY timestamp ASC
  `);
  stmt.bind([roomId, sinceTimestamp]);
  
  while (stmt.step()) {
    const row = stmt.getAsObject();
    results.push({
      playerId: row.player_id,
      type: row.event_type,
      ...JSON.parse(row.event_data),
      timestamp: row.timestamp
    });
  }
  stmt.free();
  return results;
}

function clearDrawingEvents(roomId) {
  db.run(`DELETE FROM drawing_events WHERE room_id = ?`, [roomId]);
}

// =============================================================================
// Canvas Snapshot Operations
// =============================================================================

function saveCanvasSnapshot(roomId, snapshotData, timestamp) {
  // Keep only the latest snapshot per room
  db.run(`DELETE FROM canvas_snapshots WHERE room_id = ?`, [roomId]);
  
  const stmt = db.prepare(`
    INSERT INTO canvas_snapshots (room_id, snapshot_data, timestamp)
    VALUES (?, ?, ?)
  `);
  stmt.run([roomId, snapshotData, timestamp]);
  stmt.free();
}

function getCanvasSnapshot(roomId) {
  const stmt = db.prepare(`
    SELECT * FROM canvas_snapshots 
    WHERE room_id = ? 
    ORDER BY timestamp DESC 
    LIMIT 1
  `);
  stmt.bind([roomId]);
  
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return {
      snapshotData: row.snapshot_data,
      timestamp: row.timestamp
    };
  }
  stmt.free();
  return null;
}

function clearCanvasSnapshot(roomId) {
  db.run(`DELETE FROM canvas_snapshots WHERE room_id = ?`, [roomId]);
}

// =============================================================================
// Cleanup Operations
// =============================================================================

function cleanupOldData(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  
  // Delete old messages
  db.run(`DELETE FROM chat_messages WHERE timestamp < ?`, [cutoff]);
  
  // Delete old drawing events (but keep if there's no newer snapshot)
  db.run(`
    DELETE FROM drawing_events 
    WHERE timestamp < ? 
    AND room_id IN (
      SELECT room_id FROM canvas_snapshots WHERE timestamp > ?
    )
  `, [cutoff, cutoff]);
  
  console.log('[DB] Cleaned up old data');
}

// =============================================================================
// Export
// =============================================================================

module.exports = {
  initDatabase,
  saveDatabase,
  
  // Rooms
  createRoom,
  getRoom,
  getAllRooms,
  deleteRoom,
  
  // Chat
  addChatMessage,
  getChatHistory,
  clearChatHistory,
  
  // Drawing
  addDrawingEvent,
  getDrawingEvents,
  clearDrawingEvents,
  
  // Snapshots
  saveCanvasSnapshot,
  getCanvasSnapshot,
  clearCanvasSnapshot,
  
  // Cleanup
  cleanupOldData
};