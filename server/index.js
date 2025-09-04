const http = require('http');
const { Server } = require('socket.io');
const { normalizeAlias, nextChainTimer, generateId, selectNextHost } = require('../shared/utils');

const WS_PORT = Number(process.env.WS_PORT || process.env.PORT || 4000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ws');
});

const io = new Server(server, {
  cors: { origin: FRONTEND_ORIGIN, methods: ['GET', 'POST'] },
});

// ---- put the rest of your game logic below ----

// Example state containers
const rooms = new Map();
const timers = new Map();
const sessions = new Map();

const PHASES = {
  LOBBY: 'lobby',
  COLLECTING: 'collecting',
  REVEALED: 'revealed',
  IN_TURNS: 'in_turns',
  ENDED: 'ended',
};

function publicState(room) {
  const { passwordHash, ...rest } = room;
  return rest;
}

// ...rest of the socket handlers (unchanged) ...

server.listen(WS_PORT, () => {
  console.log(`WS listening on :${WS_PORT}`);
});