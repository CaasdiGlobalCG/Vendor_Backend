import { WebSocketServer, WebSocket } from 'ws';
import url from 'url';

// ============================================================
// Canvas WebSocket Server — Real-Time Collaborative Canvas Sync
// ============================================================
// Manages workspace "rooms" where multiple users collaborate
// on the same canvas in real time via granular operations.
// Buffers changes in memory and flushes to DynamoDB periodically.
// ============================================================

// Room state: { [workspaceId]: { users: Map<ws, userInfo>, buffer: [], lastFlush: Date, flushTimer } }
const rooms = new Map();

// Flush interval (ms) — how often buffered ops are persisted to DynamoDB
const FLUSH_INTERVAL_MS = 5000;

// Maximum ops to buffer before forcing an early flush
const MAX_BUFFER_SIZE = 200;

// Heartbeat interval — native WS ping every 25s keeps ALB/nginx alive (< 60s idle timeout)
const HEARTBEAT_INTERVAL_MS = 25000;

// If no pong received within this time after ping, consider connection dead
const HEARTBEAT_TIMEOUT_MS = 10000;

// Reference to DynamoDB helpers — lazily loaded to avoid circular imports
let _DynamoWorkspace = null;
let _dynamoDB = null;
let _WORKSPACES_TABLE = null;

const getDeps = async () => {
  if (!_DynamoWorkspace) {
    const mod = await import('../modules/workspace/models/DynamoWorkspace.js');
    _DynamoWorkspace = mod;
  }
  if (!_dynamoDB) {
    const aws = await import('../config/aws.js');
    _dynamoDB = aws.dynamoDB;
    _WORKSPACES_TABLE = aws.WORKSPACES_TABLE;
  }
  return { DynamoWorkspace: _DynamoWorkspace, dynamoDB: _dynamoDB, WORKSPACES_TABLE: _WORKSPACES_TABLE };
};

// ---- Room helpers ----

function getOrCreateRoom(workspaceId) {
  if (!rooms.has(workspaceId)) {
    rooms.set(workspaceId, {
      users: new Map(),
      buffer: [],        // Array of { op, userId, timestamp }
      lastFlush: Date.now(),
      flushTimer: null,
      // In-memory snapshot of latest canvas per subtask: { [subtaskKey]: { nodes, edges, zoomLevel } }
      canvasSnapshots: new Map(),
    });
  }
  return rooms.get(workspaceId);
}

function removeUserFromRoom(ws) {
  for (const [workspaceId, room] of rooms.entries()) {
    if (room.users.has(ws)) {
      const userInfo = room.users.get(ws);
      room.users.delete(ws);

      // Broadcast user left
      broadcastToRoom(workspaceId, {
        type: 'USER_LEFT',
        userId: userInfo.userId,
        userName: userInfo.userName,
        timestamp: Date.now(),
      }, ws);

      // If room is empty, flush remaining buffer and clean up
      if (room.users.size === 0) {
        flushBuffer(workspaceId).then(() => {
          if (room.flushTimer) clearInterval(room.flushTimer);
          rooms.delete(workspaceId);
          console.log(`🧹 Canvas room ${workspaceId} cleaned up (no users)`);
        });
      }
      return;
    }
  }
}

function broadcastToRoom(workspaceId, message, excludeWs = null) {
  const room = rooms.get(workspaceId);
  if (!room) return;

  const data = JSON.stringify(message);
  for (const [ws] of room.users) {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

// ---- Buffer & Flush ----

function bufferOperation(workspaceId, op) {
  const room = rooms.get(workspaceId);
  if (!room) return;

  room.buffer.push(op);

  // Force flush if buffer is large
  if (room.buffer.length >= MAX_BUFFER_SIZE) {
    flushBuffer(workspaceId);
  }
}

/**
 * Flush buffered operations to DynamoDB.
 * Instead of replaying ops one-by-one, we use the in-memory canvas snapshot
 * which already reflects all ops applied optimistically on every incoming message.
 */
async function flushBuffer(workspaceId) {
  const room = rooms.get(workspaceId);
  if (!room || room.buffer.length === 0) return;

  const opsToFlush = [...room.buffer];
  room.buffer = [];
  room.lastFlush = Date.now();

  try {
    const { DynamoWorkspace } = await getDeps();

    // For each subtask snapshot that was touched, persist to DynamoDB
    const touchedSubtasks = new Set();
    for (const op of opsToFlush) {
      if (op.taskId && op.subtaskId) {
        touchedSubtasks.add(`${op.taskId}::${op.subtaskId}`);
      }
    }

    if (touchedSubtasks.size > 0) {
      // Get latest workspace from DB to merge
      const workspace = await DynamoWorkspace.getWorkspaceById(workspaceId);
      if (!workspace) {
        console.error(`❌ Canvas flush: workspace ${workspaceId} not found`);
        return;
      }

      const tasks = [...(workspace.tasks || [])];
      let modified = false;

      for (const key of touchedSubtasks) {
        const [taskId, subtaskId] = key.split('::');
        const snapshot = room.canvasSnapshots.get(key);
        if (!snapshot) continue;

        const taskIndex = tasks.findIndex(t => t.id === taskId);
        if (taskIndex === -1) continue;

        const subtaskIndex = (tasks[taskIndex].subtasks || []).findIndex(s => s.id === subtaskId);
        if (subtaskIndex === -1) continue;

        tasks[taskIndex].subtasks[subtaskIndex].canvasData = {
          nodes: snapshot.nodes,
          edges: snapshot.edges,
          zoomLevel: snapshot.zoomLevel || 100,
        };
        tasks[taskIndex].subtasks[subtaskIndex].updatedAt = new Date().toISOString();
        tasks[taskIndex].updatedAt = new Date().toISOString();
        modified = true;
      }

      if (modified) {
        await DynamoWorkspace.updateWorkspace(workspaceId, { tasks });
        console.log(`💾 Canvas flush: persisted ${opsToFlush.length} ops for workspace ${workspaceId} (${touchedSubtasks.size} subtasks)`);
      }
    }

    // Also handle root-level canvas ops (no subtask selected)
    const rootOps = opsToFlush.filter(op => !op.taskId && !op.subtaskId);
    if (rootOps.length > 0) {
      const rootSnapshot = room.canvasSnapshots.get('__root__');
      if (rootSnapshot) {
        await DynamoWorkspace.updateWorkspace(workspaceId, {
          nodes: rootSnapshot.nodes,
          edges: rootSnapshot.edges,
          zoomLevel: rootSnapshot.zoomLevel || 100,
        });
        console.log(`💾 Canvas flush: persisted ${rootOps.length} root-level ops for workspace ${workspaceId}`);
      }
    }

  } catch (err) {
    console.error(`❌ Canvas flush error for workspace ${workspaceId}:`, err.message);
    // Re-add failed ops to buffer for retry
    room.buffer = [...opsToFlush, ...room.buffer];
  }
}

// ---- Operation application (in-memory) ----

function getSnapshotKey(op) {
  if (op.taskId && op.subtaskId) return `${op.taskId}::${op.subtaskId}`;
  return '__root__';
}

function ensureSnapshot(room, key, initialData = {}) {
  if (!room.canvasSnapshots.has(key)) {
    room.canvasSnapshots.set(key, {
      nodes: initialData.nodes || [],
      edges: initialData.edges || [],
      zoomLevel: initialData.zoomLevel || 100,
    });
  }
  return room.canvasSnapshots.get(key);
}

function applyOpToSnapshot(snapshot, op) {
  switch (op.type) {
    case 'NODE_ADD': {
      // Add node if it doesn't already exist
      if (!snapshot.nodes.find(n => n.id === op.node?.id)) {
        snapshot.nodes.push(op.node);
      }
      break;
    }

    case 'NODE_MOVE': {
      const node = snapshot.nodes.find(n => n.id === op.nodeId);
      if (node) {
        node.position = op.position;
      }
      break;
    }

    case 'NODE_RESIZE': {
      const node = snapshot.nodes.find(n => n.id === op.nodeId);
      if (node) {
        if (op.dimensions) {
          node.style = { ...(node.style || {}), ...op.dimensions };
        }
        if (op.position) {
          node.position = op.position;
        }
      }
      break;
    }

    case 'NODE_UPDATE': {
      const node = snapshot.nodes.find(n => n.id === op.nodeId);
      if (node) {
        node.data = { ...(node.data || {}), ...(op.patch || {}) };
      }
      break;
    }

    case 'NODE_DELETE': {
      snapshot.nodes = snapshot.nodes.filter(n => n.id !== op.nodeId);
      // Also remove edges connected to this node
      snapshot.edges = snapshot.edges.filter(
        e => e.source !== op.nodeId && e.target !== op.nodeId
      );
      break;
    }

    case 'NODES_BATCH_UPDATE': {
      // Batch update for multiple node changes (e.g., onNodesChange with multiple items)
      if (Array.isArray(op.changes)) {
        for (const change of op.changes) {
          if (change.type === 'position' && change.id && change.position) {
            const node = snapshot.nodes.find(n => n.id === change.id);
            if (node) node.position = change.position;
          } else if (change.type === 'dimensions' && change.id) {
            const node = snapshot.nodes.find(n => n.id === change.id);
            if (node && change.dimensions) {
              node.style = { ...(node.style || {}), width: change.dimensions.width, height: change.dimensions.height };
            }
          } else if (change.type === 'remove' && change.id) {
            snapshot.nodes = snapshot.nodes.filter(n => n.id !== change.id);
            snapshot.edges = snapshot.edges.filter(e => e.source !== change.id && e.target !== change.id);
          }
        }
      }
      break;
    }

    case 'EDGE_ADD': {
      if (op.edge && !snapshot.edges.find(e => e.id === op.edge.id)) {
        snapshot.edges.push(op.edge);
      }
      break;
    }

    case 'EDGE_DELETE': {
      snapshot.edges = snapshot.edges.filter(e => e.id !== op.edgeId);
      break;
    }

    case 'EDGES_BATCH_UPDATE': {
      if (Array.isArray(op.changes)) {
        for (const change of op.changes) {
          if (change.type === 'remove' && change.id) {
            snapshot.edges = snapshot.edges.filter(e => e.id !== change.id);
          }
        }
      }
      break;
    }

    case 'ZOOM_CHANGE': {
      snapshot.zoomLevel = op.zoomLevel;
      break;
    }

    case 'FULL_SYNC': {
      // Full state replacement (used on initial load or reconnect)
      snapshot.nodes = op.nodes || [];
      snapshot.edges = op.edges || [];
      snapshot.zoomLevel = op.zoomLevel || 100;
      break;
    }

    default:
      console.warn(`⚠️ Unknown canvas op type: ${op.type}`);
  }
}

// ---- WebSocket Server Initialization ----

let canvasWss = null;

export const initCanvasWebSocketServer = (server) => {
  console.log('🎨 Initializing Canvas WebSocket server...');

  canvasWss = new WebSocketServer({ noServer: true });

  // Register upgrade handler
  // NOTE: The existing notification WS handles /api/notifications/ws/*
  // We handle /api/workspace/ws/*
  server.on('upgrade', (request, socket, head) => {
    const pathname = url.parse(request.url).pathname;
    console.log(`🎨 Canvas WS: Upgrade request received for path: ${pathname}`);

    if (pathname.startsWith('/api/workspace/ws/')) {
      console.log('🎨 Canvas WS: Path matched! Handling upgrade...');
      canvasWss.handleUpgrade(request, socket, head, (ws) => {
        console.log('🎨 Canvas WS: Upgrade successful, emitting connection');
        canvasWss.emit('connection', ws, request);
      });
    }
    // Don't destroy socket here — let the notification WS handler or others handle their paths
  });

  // Connection handler
  canvasWss.on('connection', (ws, request) => {
    const pathname = url.parse(request.url).pathname;
    const query = url.parse(request.url, true).query;

    // Extract workspaceId from path: /api/workspace/ws/:workspaceId
    const pathParts = pathname.split('/');
    const workspaceId = pathParts[4]; // ['', 'api', 'workspace', 'ws', ':workspaceId']

    const userId = query.userId || 'anonymous';
    const userName = query.userName ? decodeURIComponent(query.userName) : 'Anonymous';
    const userRole = query.userRole || 'vendor';

    if (!workspaceId) {
      ws.close(4000, 'Missing workspaceId');
      return;
    }

    console.log(`🎨 Canvas WS: User ${userName} (${userId}) joined workspace ${workspaceId}`);

    const room = getOrCreateRoom(workspaceId);
    const userInfo = { userId, userName, userRole, joinedAt: Date.now() };
    room.users.set(ws, userInfo);

    // Start periodic flush timer if this is the first user
    if (room.users.size === 1 && !room.flushTimer) {
      room.flushTimer = setInterval(() => {
        flushBuffer(workspaceId);
      }, FLUSH_INTERVAL_MS);
    }

    // ---- Server-side heartbeat (native WS ping/pong) ----
    // Keeps ALB/nginx connections alive and detects dead clients
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; }); // Native pong response

    const heartbeatTimer = setInterval(() => {
      if (ws.isAlive === false) {
        // No pong received since last ping — connection is dead
        console.log(`🎨 Canvas WS: Heartbeat timeout for ${userName} (${userId}), terminating`);
        clearInterval(heartbeatTimer);
        ws.terminate(); // Force close — will trigger 'close' handler
        return;
      }
      ws.isAlive = false;
      ws.ping(); // Send native WebSocket ping frame
    }, HEARTBEAT_INTERVAL_MS);

    // Send confirmation
    ws.send(JSON.stringify({
      type: 'CONNECTED',
      workspaceId,
      userId,
      connectedUsers: Array.from(room.users.values()).map(u => ({
        userId: u.userId,
        userName: u.userName,
        userRole: u.userRole,
      })),
    }));

    // Broadcast user joined to others
    broadcastToRoom(workspaceId, {
      type: 'USER_JOINED',
      userId,
      userName,
      userRole,
      timestamp: Date.now(),
    }, ws);

    // Handle messages
    ws.on('message', (raw) => {
      try {
        const message = JSON.parse(raw);
        handleCanvasMessage(ws, workspaceId, userInfo, message);
      } catch (err) {
        console.error('🎨 Canvas WS: Error parsing message:', err.message);
      }
    });

    ws.on('close', () => {
      console.log(`🎨 Canvas WS: User ${userName} (${userId}) left workspace ${workspaceId}`);
      clearInterval(heartbeatTimer);
      removeUserFromRoom(ws);
    });

    ws.on('error', (err) => {
      console.error(`🎨 Canvas WS: Error for user ${userId} in workspace ${workspaceId}:`, err.message);
      clearInterval(heartbeatTimer);
    });
  });

  console.log('🎨 Canvas WebSocket server initialized');
  return canvasWss;
};

// ---- Message handler ----

function handleCanvasMessage(ws, workspaceId, userInfo, message) {
  const room = rooms.get(workspaceId);
  if (!room) return;

  // Debug: log all non-ping messages
  if (message.type !== 'ping' && message.type !== 'CURSOR_MOVE') {
    console.log(`🎨 Canvas WS: Received ${message.type} from ${userInfo.userName} (${userInfo.userId}) in workspace ${workspaceId}`);
  }

  switch (message.type) {
    // ---- Canvas operations ----
    case 'NODE_ADD':
    case 'NODE_MOVE':
    case 'NODE_RESIZE':
    case 'NODE_UPDATE':
    case 'NODE_DELETE':
    case 'NODES_BATCH_UPDATE':
    case 'EDGE_ADD':
    case 'EDGE_DELETE':
    case 'EDGES_BATCH_UPDATE':
    case 'ZOOM_CHANGE':
    case 'FULL_SYNC': {
      const op = {
        ...message,
        userId: userInfo.userId,
        timestamp: Date.now(),
      };

      // Apply to in-memory snapshot
      const key = getSnapshotKey(op);
      const snapshot = ensureSnapshot(room, key);
      applyOpToSnapshot(snapshot, op);

      // Buffer for DynamoDB flush
      bufferOperation(workspaceId, op);

      // Broadcast to all other users in the room
      broadcastToRoom(workspaceId, {
        ...op,
        _from: userInfo.userId,
        _fromName: userInfo.userName,
      }, ws);

      break;
    }

    // ---- Cursor / Presence ----
    case 'CURSOR_MOVE': {
      // Don't buffer cursor movements — just broadcast
      broadcastToRoom(workspaceId, {
        type: 'CURSOR_MOVE',
        userId: userInfo.userId,
        userName: userInfo.userName,
        x: message.x,
        y: message.y,
        timestamp: Date.now(),
      }, ws);
      break;
    }

    // ---- Request full state (on reconnect) ----
    case 'REQUEST_FULL_STATE': {
      const key = getSnapshotKey(message);
      const snapshot = room.canvasSnapshots.get(key);
      if (snapshot) {
        ws.send(JSON.stringify({
          type: 'FULL_STATE',
          nodes: snapshot.nodes,
          edges: snapshot.edges,
          zoomLevel: snapshot.zoomLevel,
          taskId: message.taskId,
          subtaskId: message.subtaskId,
        }));
      }
      break;
    }

    // ---- Initialize snapshot from client's current state ----
    case 'INIT_SNAPSHOT': {
      const key = getSnapshotKey(message);
      // Only initialize if no snapshot exists yet (first user to join)
      if (!room.canvasSnapshots.has(key)) {
        ensureSnapshot(room, key, {
          nodes: message.nodes || [],
          edges: message.edges || [],
          zoomLevel: message.zoomLevel || 100,
        });
        console.log(`🎨 Canvas WS: Initialized snapshot for ${key} in workspace ${workspaceId} (${message.nodes?.length || 0} nodes)`);
      }
      break;
    }

    // ---- Ping/Pong for keepalive ----
    case 'ping': {
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;
    }

    default:
      console.warn(`🎨 Canvas WS: Unknown message type: ${message.type}`);
  }
}

// ---- Exported helpers for external use ----

/**
 * Get the list of connected users in a workspace room
 */
export const getWorkspaceRoomUsers = (workspaceId) => {
  const room = rooms.get(workspaceId);
  if (!room) return [];
  return Array.from(room.users.values());
};

/**
 * Force flush a specific workspace's buffer (useful for graceful shutdown)
 */
export const forceFlush = async (workspaceId) => {
  await flushBuffer(workspaceId);
};

/**
 * Force flush all rooms (for graceful shutdown)
 */
export const flushAll = async () => {
  const promises = [];
  for (const workspaceId of rooms.keys()) {
    promises.push(flushBuffer(workspaceId));
  }
  await Promise.all(promises);
  console.log('💾 All canvas buffers flushed');
};
