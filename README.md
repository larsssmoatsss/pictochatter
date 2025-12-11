# PictoChatter

A real-time collaborative drawing and messaging application inspired by Nintendo DS PictoChat. Built to explore **distributed systems patterns**, **real-time synchronization**, and **persistent messaging** - core concepts in enterprise architecture.

### **[Live Demo, try here with a friend!](https://pictochatter.onrender.com/)**

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-010101?style=flat&logo=socketdotio&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)

## Why This Project?

This project demonstrates practical implementations of patterns used in enterprise systems:

| Pattern | Implementation | Enterprise Equivalent |
|---------|---------------|----------------------|
| **Event-Driven Architecture** | WebSocket message broadcasting | Message queues, event buses |
| **State Synchronization** | Canvas sync across clients | Distributed cache invalidation |
| **Persistent Messaging** | SQLite chat/event storage | Message persistence in Kafka, RabbitMQ |
| **Reconnection & Recovery** | Queue replay on reconnect | At-least-once delivery guarantees |
| **Room/Channel Management** | Multi-room isolation | Topic-based pub/sub, namespacing |

## Features

### Core Functionality
- **Real-time Drawing** - Shared canvas with instant sync across all connected clients
- **Live Chat** - Persistent messaging with timestamp and user attribution
- **Multiple Rooms** - Isolated channels (Chat A-D) with 4-player capacity
- **Custom Rooms** - Dynamic room creation for ad-hoc collaboration

### Drawing Tools
| Tool | Description |
|------|-------------|
| ✏️ Pen | Freehand drawing |
| 🖌️ Brush | Thicker strokes |
| ╱ Line | Straight lines |
| ▢ Rectangle | Rectangle shapes |
| ○ Circle | Circles/ellipses |
| 🪣 Fill | Flood fill algorithm |
| ✕ Eraser | Erase content |

### Technical Features
- **8 Colors & 5 Brush Sizes** - Customizable drawing options
- **Undo Support** - Up to 10 steps of local undo
- **Canvas Snapshots** - Periodic state persistence for fast recovery
- **Auto-Reconnect** - Exponential backoff with offline queue
- **Mobile Optimized** - Touch controls and responsive design

---

## Tech Stack & Architecture

### Overview

```
┌─────────────────┐         WebSocket          ┌─────────────────┐
│                 │◄─────────────────────────►│                 │
│  Browser Client │                            │  Node.js Server │
│  (Vanilla JS)   │         HTTP/REST          │  (Express + ws) │
│                 │◄─────────────────────────►│                 │
└─────────────────┘                            └────────┬────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │     SQLite      │
                                               │   (sql.js)      │
                                               └─────────────────┘
```

### Backend

| Technology | Purpose | Why This Choice |
|------------|---------|-----------------|
| **Node.js** | Runtime | Event-driven, non-blocking I/O ideal for real-time apps |
| **Express** | HTTP Server | Lightweight, serves static files + REST API |
| **ws** | WebSocket | Raw WebSocket library (not Socket.io) for learning the protocol |
| **sql.js** | Database | SQLite compiled to WASM - portable, no native dependencies |

### Frontend

| Technology | Purpose |
|------------|---------|
| **Vanilla JavaScript** | No framework overhead, direct DOM/Canvas manipulation |
| **HTML5 Canvas API** | 2D drawing surface with immediate mode rendering |
| **CSS3** | Responsive layout, DS-inspired aesthetic |

### Data Flow

```
Client Action (draw stroke)
       │
       ▼
┌──────────────────┐
│ Collect points   │  Local rendering (immediate feedback)
│ into stroke      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Send via         │  WebSocket message: { type: 'draw', points, color, size }
│ WebSocket        │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Server receives  │  Validate, store in DB, broadcast
│ & broadcasts     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Other clients    │  Render stroke on their canvas
│ receive & render │
└──────────────────┘
```

---

## Distributed Systems Concepts Demonstrated

### 1. Event-Driven Architecture
The entire application is built around events. Clients emit events (draw, message, join) and react to events from the server. This mirrors how enterprise systems use message brokers like **RabbitMQ**, **Apache Kafka**, or **AWS SNS/SQS**.

```javascript
// Event types mirror enterprise messaging patterns
{ type: 'draw', points: [...], color: '#000', playerId: 'abc123' }
{ type: 'message', text: 'Hello!', playerId: 'abc123', timestamp: 1699999999 }
{ type: 'userJoined', playerId: 'xyz789', playerName: 'Alice' }
```

### 2. State Synchronization
When a new client joins, they receive the complete room state (canvas + chat history). This is analogous to:
- **Cache warming** in distributed caches
- **Snapshot + log replay** in event sourcing
- **State transfer** in replicated databases

### 3. Persistent Messaging
All chat messages and drawing events are persisted to SQLite. This ensures:
- Messages survive server restarts
- New clients can see history
- Similar to **durable queues** in enterprise messaging

### 4. Reconnection & Queue Replay
When a client disconnects and reconnects:
1. Events are queued locally during disconnection
2. On reconnect, client requests current state
3. Queued events are replayed to server

This implements **at-least-once delivery** semantics, a core concept in reliable messaging systems.

### 5. Room-Based Isolation
Each room operates independently with its own:
- Player list
- Canvas state
- Chat history

This mirrors **topic-based routing** in pub/sub systems and **namespace isolation** in multi-tenant architectures.

---

## Database Schema

```sql
-- Rooms: Both default and user-created
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  max_players INTEGER DEFAULT 4,
  is_custom INTEGER DEFAULT 0
);

-- Chat messages with full attribution
CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

-- Canvas snapshots for fast state recovery
CREATE TABLE canvas_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  snapshot_data TEXT NOT NULL,  -- Base64 PNG
  timestamp INTEGER NOT NULL
);

-- Drawing events for replay between snapshots
CREATE TABLE drawing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data TEXT NOT NULL,     -- JSON
  timestamp INTEGER NOT NULL
);
```

---

## Getting Started

### Prerequisites
- Node.js 18+ 
- npm

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/pictochatter.git
cd pictochatter

# Install dependencies
npm install

# Start the server
npm start
```

### Usage

1. Open `http://localhost:5000` in your browser
2. Enter your name and join a room
3. Open another tab/browser to test multiplayer
4. Draw and chat in real-time!

---

## Project Structure

```
pictochatter/
├── backend/
│   ├── server.js        # Express + WebSocket server, event handling
│   ├── roomManager.js   # Room state, player management
│   └── db.js            # SQLite operations, persistence layer
├── frontend/
│   ├── index.html       # UI structure, dual-screen DS layout
│   ├── styles.css       # Clean white/grey aesthetic with pastel accents
│   └── app.js           # Client logic, canvas, WebSocket client
├── data/
│   └── pictochatter.db  # SQLite database (auto-created)
├── docs/
│   └── screenshot.png   # Project screenshot
├── package.json
├── .env                 # Configuration (PORT=5000)
├── LICENSE              # MIT License
└── README.md
```
## Deployment

### Local Development
```bash
npm run dev  # Auto-restart on file changes (Node 18+)
```

### Production Deployment

**Option 1: Render (Recommended for simplicity)**
1. Push to GitHub
2. Connect repository to [Render](https://render.com)
3. Deploy automatically

**Option 2: Docker**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 5000
CMD ["npm", "start"]
```

**Option 3: Traditional VPS**
```bash
# On your server
git clone <repo>
cd pictochatter
npm install --production
PORT=80 node backend/server.js
```

---

## WebSocket Protocol Reference

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `join` | `{ roomId, playerId, playerName }` | Join a room |
| `rejoin` | `{ roomId, playerId, playerName, lastEventTimestamp }` | Rejoin after disconnect |
| `draw` | `{ points, color, size, tool }` | Send drawing stroke |
| `clear` | `{ }` | Clear canvas |
| `message` | `{ text }` | Send chat message |
| `drawStart` | `{ }` | Started drawing (for indicator) |
| `drawEnd` | `{ }` | Stopped drawing |
| `canvasSnapshot` | `{ snapshotData }` | Periodic canvas state |
| `queueReplay` | `{ events: [...] }` | Replay offline events |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `roomState` | `{ roomName, activePlayers, chatHistory, drawingEvents, canvasSnapshot }` | Full state on join |
| `rejoinState` | `{ ...roomState, missedEvents }` | State + missed events |
| `userJoined` | `{ playerId, playerName, isRejoin }` | Player joined |
| `userLeft` | `{ playerId, playerName }` | Player left |
| `draw` | `{ points, color, size, tool, playerId }` | Drawing from other player |
| `clear` | `{ playerId, playerName }` | Canvas cleared |
| `message` | `{ text, playerId, playerName, timestamp }` | Chat message |
| `drawStart/drawEnd` | `{ playerId, playerName }` | Drawing indicator |
| `error` | `{ message }` | Error message |

---

## Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest features
- Submit pull requests

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- Inspired by **Nintendo DS PictoChat** (2004)
- Built as an exploration of distributed systems concepts