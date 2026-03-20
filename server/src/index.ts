import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { setupSocketHandlers } from './socket/handlers.js';
import {
  getAllBoards,
  getBoard,
  createBoard,
  updateBoard,
  deleteBoard,
  duplicateBoard,
  loadBoards,
} from './storage/boardStore.js';

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
});

setupSocketHandlers(io);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Board API endpoints
app.get('/api/boards', (_req, res) => {
  const boards = getAllBoards();
  res.json(boards);
});

app.get('/api/boards/:id', (req, res) => {
  const board = getBoard(req.params.id);
  if (!board) {
    res.status(404).json({ error: 'Board not found' });
    return;
  }
  res.json(board);
});

app.post('/api/boards', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'Board name is required' });
    return;
  }
  const board = createBoard(name);
  res.status(201).json(board);
});

app.put('/api/boards/:id', (req, res) => {
  const { name, accessLevel } = req.body;
  const board = updateBoard(req.params.id, { name, accessLevel });
  if (!board) {
    res.status(404).json({ error: 'Board not found' });
    return;
  }
  res.json(board);
});

app.delete('/api/boards/:id', (req, res) => {
  const success = deleteBoard(req.params.id);
  if (!success) {
    res.status(404).json({ error: 'Board not found' });
    return;
  }
  res.status(204).send();
});

app.post('/api/boards/:id/duplicate', (req, res) => {
  const { name } = req.body;
  const board = duplicateBoard(req.params.id, name);
  if (!board) {
    res.status(404).json({ error: 'Board not found' });
    return;
  }
  res.status(201).json(board);
});

// Initialize storage and start server
loadBoards().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
