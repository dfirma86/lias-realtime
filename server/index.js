\
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

const io = new Server(server, { cors: { origin: FRONTEND_ORIGIN, methods: ['GET','POST'] } });

const rooms = new Map();
const timers = new Map();
const sessions = new Map();

const PHASES = { LOBBY: 'lobby', COLLECTING: 'collecting', REVEALED: 'revealed', IN_TURNS: 'in_turns', ENDED: 'ended' };

function publicState(room) {
  const { passwordHash, ...rest } = room;
  return rest;
}

function ensureNoTimer(code){
  const t = timers.get(code);
  if (t) { clearInterval(t); timers.delete(code); }
}

function tickStart(code){
  ensureNoTimer(code);
  const room = rooms.get(code);
  if (!room || room.phase !== PHASES.IN_TURNS || !room.currentTurn) return;
  timers.set(code, setInterval(() => {
    const r = rooms.get(code);
    if (!r || r.phase !== PHASES.IN_TURNS || !r.currentTurn) return ensureNoTimer(code);
    r.currentTurn.timer -= 1;
    if (r.currentTurn.timer <= 0) {
      const order = r.turnOrder;
      const idx = order.indexOf(r.currentTurn.playerId);
      let n = (idx + 1) % order.length;
      let nextId = order[n];
      const aliveCheck = (pid) => r.players.find(p => p.id === pid && !p.isEliminated);
      while (!aliveCheck(nextId)) { n = (n + 1) % order.length; nextId = order[n]; }
      r.currentTurn = { playerId: nextId, timer: r.settings.baseTimer };
      io.to(code).emit('room:penalty', { playerId: order[idx], type: 'timeout' });
    }
    io.to(code).emit('room:state', publicState(r));
  }, 1000));
}

io.on('connection', (socket) => {
  socket.data.playerId = null;
  socket.data.roomCode = null;
  socket.data.sessionToken = null;

  socket.on('session:resume', ({ token }, ack) => {
    const sess = sessions.get(token);
    if (!sess) return ack?.({ ok:false, error:'NO_SESSION' });
    const room = rooms.get(sess.roomCode);
    if (!room) return ack?.({ ok:false, error:'ROOM_GONE' });

    socket.join(sess.roomCode);
    socket.data.playerId = sess.playerId;
    socket.data.roomCode = sess.roomCode;
    socket.data.sessionToken = token;
    ack?.({ ok:true, roomCode: sess.roomCode, you: sess.playerId, state: publicState(room) });
    io.to(sess.roomCode).emit('room:state', publicState(room));
  });

  socket.on('room:create', ({ name, password }, ack) => {
    try {
      if (!name || !String(name).trim()) return ack({ ok:false, error:'NAME_REQUIRED' });
      if (!password || String(password).trim().length < 4) return ack({ ok:false, error:'PASSWORD_SHORT' });

      const code = genCode();
      const myId = generateId();
      const token = generateId();
      const now = Date.now();
      const room = {
        code,
        phase: PHASES.LOBBY,
        passwordHash: String(hash(password)),
        settings: { baseTimer: 15, timerShrinkEnabled: true, shrinkStep: 3, minTimer: 3, playersCap: 12 },
        players: [{ id: myId, name: String(name).trim(), isEliminated: false, isHost: true, alias: null, joinedAt: now }],
        aliases: {},
        aliasPool: [],
        currentTurn: null,
        turnOrder: [],
        eliminations: [],
        winnerId: null,
      };
      rooms.set(code, room);
      sessions.set(token, { roomCode: code, playerId: myId });

      socket.join(code);
      socket.data.playerId = myId;
      socket.data.roomCode = code;
      socket.data.sessionToken = token;

      ack({ ok:true, roomCode: code, you: myId, token, state: publicState(room) });
      io.to(code).emit('room:state', publicState(room));
    } catch (e) { ack({ ok:false, error: 'SERVER_ERROR' }); }
  });

  socket.on('room:join', ({ code, name, password }, ack) => {
    const room = rooms.get(String(code).toUpperCase());
    if (!room) return ack({ ok:false, error:'ROOM_NOT_FOUND' });
    if (room.phase === PHASES.REVEALED || room.phase === PHASES.IN_TURNS || room.phase === PHASES.ENDED) {
      return ack({ ok:false, error:'GAME_ALREADY_STARTED' });
    }
    if (room.players.length >= (room.settings.playersCap || 12)) return ack({ ok:false, error:'ROOM_FULL' });
    if (String(hash(password)) !== room.passwordHash) return ack({ ok:false, error:'BAD_PASSWORD' });
    if (!name || !String(name).trim()) return ack({ ok:false, error:'NAME_REQUIRED' });

    const myId = generateId();
    const token = generateId();
    room.players.push({ id: myId, name: String(name).trim(), isEliminated: false, isHost: false, alias: null, joinedAt: Date.now() });

    sessions.set(token, { roomCode: room.code, playerId: myId });
    socket.join(room.code);
    socket.data.playerId = myId;
    socket.data.roomCode = room.code;
    socket.data.sessionToken = token;

    ack({ ok:true, you: myId, token, state: publicState(room) });
    io.to(room.code).emit('room:state', publicState(room));
  });

  socket.on('session:leave', (ack) => {
    const token = socket.data.sessionToken;
    if (token) sessions.delete(token);
    socket.data.sessionToken = null;
    ack?.({ ok:true });
  });

  socket.on('alias:submit', ({ code, playerId, alias }, ack) => {
    const room = rooms.get(code);
    if (!room) return ack?.({ ok:false, error:'ROOM_NOT_FOUND' });
    if (playerId !== socket.data.playerId) return ack?.({ ok:false, error:'NOT_YOUR_ID' });
    const text = (alias||'').trim();
    if (!text) return ack?.({ ok:false, error:'EMPTY_ALIAS' });
    const norm = normalizeAlias(text);
    const taken = Object.values(room.aliases).some(a => normalizeAlias(a) === norm);
    if (taken) return ack?.({ ok:false, error:'ALIAS_TAKEN' });

    room.aliases[playerId] = text;
    room.aliasPool = Object.values(room.aliases);
    const me = room.players.find(p => p.id === playerId); if (me) me.alias = text;

    ack?.({ ok:true });
    io.to(code).emit('room:state', publicState(room));
  });

  socket.on('room:reveal', ({ code }, ack) => {
    const room = rooms.get(code);
    if (!room) return ack?.({ ok:false, error:'ROOM_NOT_FOUND' });
    const me = room.players.find(p => p.id === socket.data.playerId);
    if (!me?.isHost) return ack?.({ ok:false, error:'HOST_ONLY' });
    const allSubmitted = room.players.every(p => !!room.aliases[p.id]);
    if (!allSubmitted) return ack?.({ ok:false, error:'PENDING_SUBMISSIONS' });

    room.phase = PHASES.REVEALED;
    ack?.({ ok:true });
    io.to(code).emit('room:state', publicState(room));
  });

  socket.on('game:startTurns', ({ code }, ack) => {
    const room = rooms.get(code);
    if (!room) return ack?.({ ok:false, error:'ROOM_NOT_FOUND' });
    const me = room.players.find(p => p.id === socket.data.playerId);
    if (!me?.isHost) return ack?.({ ok:false, error:'HOST_ONLY' });

    room.turnOrder = room.players.filter(p => !p.isEliminated).sort((a,b)=>a.joinedAt-b.joinedAt).map(p=>p.id);
    room.currentTurn = { playerId: room.turnOrder[0], timer: room.settings.baseTimer };
    room.phase = PHASES.IN_TURNS;

    tickStart(code);
    ack?.({ ok:true });
    io.to(code).emit('room:state', publicState(room));
  });

  socket.on('game:guess', ({ code, playerId, targetId, aliasText }, ack) => {
    const room = rooms.get(code);
    if (!room) return ack?.({ ok:false, error:'ROOM_NOT_FOUND' });
    if (playerId !== socket.data.playerId) return ack?.({ ok:false, error:'NOT_YOUR_ID' });
    if (room.phase !== PHASES.IN_TURNS || !room.currentTurn) return ack?.({ ok:false, error:'NOT_IN_TURNS' });
    if (room.currentTurn.playerId !== playerId) return ack?.({ ok:false, error:'NOT_YOUR_TURN' });

    const correct = room.aliases[targetId] === aliasText;
    if (correct) {
      const tgt = room.players.find(p => p.id === targetId);
      if (tgt && !tgt.isEliminated) {
        tgt.isEliminated = true;
        room.eliminations.push(targetId);
        room.aliasPool = room.aliasPool.filter(a => a !== aliasText);
      }
      const alive = room.players.filter(p => !p.isEliminated);
      if (alive.length === 1) {
        room.phase = PHASES.ENDED;
        room.winnerId = alive[0].id;
        room.currentTurn = null;
        ensureNoTimer(code);
      } else {
        const t = room.currentTurn.timer;
        const nextT = room.settings.timerShrinkEnabled ? nextChainTimer(t, room.settings.shrinkStep, room.settings.minTimer) : room.settings.baseTimer;
        room.currentTurn = { playerId, timer: nextT };
      }
    } else {
      const order = room.turnOrder;
      const idx = order.indexOf(room.currentTurn.playerId);
      let n = (idx + 1) % order.length;
      let nextId = order[n];
      const aliveCheck = (pid) => room.players.find(p => p.id === pid && !p.isEliminated);
      while (!aliveCheck(nextId)) { n = (n + 1) % order.length; nextId = order[n]; }
      room.currentTurn = { playerId: nextId, timer: room.settings.baseTimer };
    }

    ack?.({ ok:true, correct });
    io.to(code).emit('room:state', publicState(room));
    if (room.phase === PHASES.IN_TURNS) tickStart(code);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!code || !playerId) return;
    const room = rooms.get(code);
    if (!room) return;

    const host = room.players.find(p => p.isHost);
    if (host && host.id === playerId) {
      const nextHostId = selectNextHost(room.players, playerId);
      if (nextHostId) {
        host.isHost = false;
        const nh = room.players.find(p => p.id === nextHostId);
        if (nh) nh.isHost = true;
      }
    }
    io.to(code).emit('room:state', publicState(room));
  });
});

function genCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return s;
}

function hash(s) {
  let h = 0; const str = String(s);
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i), h |= 0;
  return String(h);
}

server.listen(WS_PORT, () => console.log(`WS listening on :${WS_PORT}`));
