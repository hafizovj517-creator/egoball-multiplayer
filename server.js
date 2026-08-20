// server.js
// EgoBall Multiplayer - server-authoritative futbol o'yini serveri.
// Barcha fizika hisob-kitoblari SHU YERDA bajariladi (client faqat input yuboradi,
// shuning uchun speed-hack/teleport-cheat qilib bo'lmaydi).
// Bir nechta stadium (1v1 - 5v5) parallel xonalar sifatida ishlaydi, har birida
// o'z jamoalari, spectatorlari va chat kanali bor.

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const accounts = require('./accounts');
const { STADIUMS, PLAYER_RADIUS, BALL_RADIUS } = require('./stadiums');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const TICK_RATE = 60;

// ---------- Xonalarni yaratish ----------
// Har stadium turi uchun bitta xona (masalan "1v1", "2v2", ...).
const rooms = {};
for (const key in STADIUMS) {
  rooms[key] = createRoom(STADIUMS[key]);
}

function createRoom(config) {
  return {
    config,
    players: {},       // socket.id -> player (faqat maydondagilar)
    spectators: {},     // socket.id -> { username }
    ball: { x: (config.fieldLeft + config.fieldRight) / 2, y: (config.fieldTop + config.fieldBottom) / 2, vx: 0, vy: 0 },
    score: { red: 0, blue: 0 },
    paused: true,
    pauseReason: 'waiting',
    matchActive: false
  };
}

function teamCounts(room) {
  let red = 0, blue = 0;
  for (const id in room.players) {
    if (room.players[id].team === 'red') red++; else blue++;
  }
  return { red, blue };
}

function assignSlot(room) {
  const c = teamCounts(room);
  const redOpen = c.red < room.config.teamSize;
  const blueOpen = c.blue < room.config.teamSize;
  if (!redOpen && !blueOpen) return null; // joy yo'q -> spectator
  if (redOpen && (!blueOpen || c.red <= c.blue)) return 'red';
  return 'blue';
}

function spawnPositionFor(room, team) {
  const cfg = room.config;
  const c = teamCounts(room);
  const index = team === 'red' ? c.red : c.blue;
  const midX = (cfg.fieldLeft + cfg.fieldRight) / 2;
  const midY = (cfg.fieldTop + cfg.fieldBottom) / 2;
  const baseX = team === 'red' ? midX - (cfg.fieldRight - cfg.fieldLeft) * 0.22 : midX + (cfg.fieldRight - cfg.fieldLeft) * 0.22;
  const row = Math.ceil(index / 2);
  const baseY = midY + (index % 2 === 0 ? -1 : 1) * row * 42;
  return {
    x: baseX,
    y: Math.max(cfg.fieldTop + 20, Math.min(cfg.fieldBottom - 20, baseY))
  };
}

function resetKickoff(room) {
  const cfg = room.config;
  room.ball.x = (cfg.fieldLeft + cfg.fieldRight) / 2;
  room.ball.y = (cfg.fieldTop + cfg.fieldBottom) / 2;
  room.ball.vx = 0;
  room.ball.vy = 0;
  for (const id in room.players) {
    const p = room.players[id];
    const pos = spawnPositionFor(room, p.team);
    p.x = pos.x; p.y = pos.y; p.vx = 0; p.vy = 0;
  }
}

function checkMatchReadiness(room) {
  const c = teamCounts(room);
  if (c.red >= 1 && c.blue >= 1) {
    if (!room.matchActive) {
      room.matchActive = true;
      room.score.red = 0;
      room.score.blue = 0;
      resetKickoff(room);
    }
    room.paused = false;
    room.pauseReason = null;
  } else {
    room.paused = true;
    room.pauseReason = 'waiting';
  }
}

// ---------- Kollizyon funksiyalari ----------
function resolveWallCollision(room, obj, radius) {
  const cfg = room.config;
  const inGoalMouth = obj.y > cfg.goalTop && obj.y < cfg.goalBottom;

  if (obj.y - radius < cfg.fieldTop) { obj.y = cfg.fieldTop + radius; obj.vy *= -0.4; }
  if (obj.y + radius > cfg.fieldBottom) { obj.y = cfg.fieldBottom - radius; obj.vy *= -0.4; }

  if (!inGoalMouth) {
    if (obj.x - radius < cfg.fieldLeft) { obj.x = cfg.fieldLeft + radius; obj.vx *= -0.4; }
    if (obj.x + radius > cfg.fieldRight) { obj.x = cfg.fieldRight - radius; obj.vx *= -0.4; }
  } else {
    if (obj.x - radius < cfg.fieldLeft - cfg.goalDepth) { obj.x = cfg.fieldLeft - cfg.goalDepth + radius; obj.vx *= -0.4; }
    if (obj.x + radius > cfg.fieldRight + cfg.goalDepth) { obj.x = cfg.fieldRight + cfg.goalDepth - radius; obj.vx *= -0.4; }
  }
}

function resolveCircleCollision(a, b, ra, rb, invMassA, invMassB, restitution) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minDist = ra + rb;
  if (dist === 0 || dist >= minDist) return;

  const nx = dx / dist, ny = dy / dist;
  const overlap = minDist - dist;
  const totalInvMass = invMassA + invMassB;
  if (totalInvMass === 0) return;

  a.x -= nx * overlap * (invMassA / totalInvMass);
  a.y -= ny * overlap * (invMassA / totalInvMass);
  b.x += nx * overlap * (invMassB / totalInvMass);
  b.y += ny * overlap * (invMassB / totalInvMass);

  const relVx = b.vx - a.vx, relVy = b.vy - a.vy;
  const relSpeed = relVx * nx + relVy * ny;
  if (relSpeed > 0) return;

  const impulse = (-(1 + restitution) * relSpeed) / totalInvMass;
  a.vx -= impulse * invMassA * nx;
  a.vy -= impulse * invMassA * ny;
  b.vx += impulse * invMassB * nx;
  b.vy += impulse * invMassB * ny;
}

function checkGoal(room) {
  const cfg = room.config;
  const ball = room.ball;
  if (ball.y > cfg.goalTop && ball.y < cfg.goalBottom) {
    if (ball.x + BALL_RADIUS < cfg.fieldLeft) scoreGoal(room, 'blue');
    else if (ball.x - BALL_RADIUS > cfg.fieldRight) scoreGoal(room, 'red');
  }
}

function scoreGoal(room, scoringTeam) {
  room.score[scoringTeam] += 1;
  room.paused = true;
  room.pauseReason = 'goal';
  io.to(room.config.key).emit('goal', { team: scoringTeam, score: room.score });

  if (room.score[scoringTeam] >= room.config.scoreLimit) {
    endMatch(room, scoringTeam);
  } else {
    setTimeout(() => {
      resetKickoff(room);
      checkMatchReadiness(room);
    }, 1800);
  }
}

function endMatch(room, winningTeam) {
  room.matchActive = false;
  room.paused = true;
  room.pauseReason = 'matchEnd';

  for (const id in room.players) {
    const p = room.players[id];
    if (p.username) {
      accounts.recordMatchResult(p.username, p.team === winningTeam, p.goalsThisMatch || 0);
    }
    p.goalsThisMatch = 0;
  }

  io.to(room.config.key).emit('matchEnd', { winningTeam, score: room.score });

  setTimeout(() => {
    room.score.red = 0;
    room.score.blue = 0;
    resetKickoff(room);
    checkMatchReadiness(room);
  }, 4000);
}

// ---------- O'yin sikli (har xona uchun, 60 marta/sekund) ----------
function tickRoom(room) {
  const cfg = room.config;
  const now = Date.now();

  if (!room.paused) {
    for (const id in room.players) {
      const p = room.players[id];
      const inp = p.input;

      let ax = inp.x, ay = inp.y;
      const mag = Math.hypot(ax, ay);
      if (mag > 1) { ax /= mag; ay /= mag; }

      if (inp.kick) {
        if (p.kickHoldStart === null) p.kickHoldStart = now;
      } else {
        p.kickHoldStart = null;
      }

      const accel = cfg.playerAccel + (inp.kick ? cfg.playerAccel * 0.6 : 0);

      p.vx += ax * accel;
      p.vy += ay * accel;
      p.vx *= cfg.playerDamping;
      p.vy *= cfg.playerDamping;

      const speed = Math.hypot(p.vx, p.vy);
      if (speed > cfg.maxSpeed) {
        p.vx = (p.vx / speed) * cfg.maxSpeed;
        p.vy = (p.vy / speed) * cfg.maxSpeed;
      }

      p.x += p.vx;
      p.y += p.vy;
      resolveWallCollision(room, p, PLAYER_RADIUS);
    }

    const ids = Object.keys(room.players);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        resolveCircleCollision(room.players[ids[i]], room.players[ids[j]], PLAYER_RADIUS, PLAYER_RADIUS, 0.5, 0.5, cfg.restitution);
      }
    }

    const ball = room.ball;
    ball.vx *= cfg.ballDamping;
    ball.vy *= cfg.ballDamping;
    ball.x += ball.vx;
    ball.y += ball.vy;

    for (const id in room.players) {
      const p = room.players[id];
      resolveCircleCollision(p, ball, PLAYER_RADIUS, BALL_RADIUS, 0.5, 1, cfg.restitution);

      if (p.input.kick) {
        const dx = ball.x - p.x, dy = ball.y - p.y;
        const dist = Math.hypot(dx, dy);
        const kickRange = PLAYER_RADIUS + BALL_RADIUS + 4;
        if (dist < kickRange && dist > 0.01) {
          const holdMs = p.kickHoldStart ? Math.min(now - p.kickHoldStart, cfg.kickChargeTime) : 0;
          const chargeRatio = holdMs / cfg.kickChargeTime;
          const strength = cfg.kickBase + (cfg.kickCharged - cfg.kickBase) * chargeRatio;

          const nx = dx / dist, ny = dy / dist;
          ball.vx += nx * strength;
          ball.vy += ny * strength;
          p.kickHoldStart = now;
        }
      }
    }

    resolveWallCollision(room, ball, BALL_RADIUS);
    checkGoal(room);
  }

  broadcastState(room);
}

function broadcastState(room) {
  const players = Object.values(room.players).map(p => ({
    id: p.id, username: p.username, team: p.team, x: p.x, y: p.y
  }));

  io.to(room.config.key).emit('state', {
    players,
    ball: { x: room.ball.x, y: room.ball.y },
    score: room.score,
    paused: room.paused,
    pauseReason: room.pauseReason,
    spectatorCount: Object.keys(room.spectators).length
  });
}

setInterval(() => {
  for (const key in rooms) tickRoom(rooms[key]);
}, 1000 / TICK_RATE);

// ---------- Yordamchi: o'yinchini joriy xonadan chiqarish ----------
function leaveCurrentRoom(socket) {
  const roomKey = socket.data.roomKey;
  if (!roomKey || !rooms[roomKey]) return;
  const room = rooms[roomKey];

  if (room.players[socket.id]) {
    delete room.players[socket.id];
    checkMatchReadiness(room);
  }
  if (room.spectators[socket.id]) {
    delete room.spectators[socket.id];
  }

  socket.leave(roomKey);
  socket.data.roomKey = null;
}

// ---------- Socket ulanishlar ----------
io.on('connection', (socket) => {
  socket.data.username = null;
  socket.data.roomKey = null;

  socket.on('register', ({ username, password }, cb) => {
    const result = accounts.registerUser(username, password);
    if (cb) cb(result);
  });

  socket.on('login', ({ username, password }, cb) => {
    const result = accounts.loginUser(username, password);
    if (!result.success) { if (cb) cb(result); return; }
    socket.data.username = result.user.username;

    const stadiumList = Object.values(STADIUMS).map(cfg => ({
      key: cfg.key, name: cfg.name, teamSize: cfg.teamSize, colors: cfg.colors
    }));

    if (cb) cb({ success: true, user: result.user, stadiums: stadiumList });
  });

  socket.on('joinStadium', (mode, cb) => {
    const config = STADIUMS[mode];
    if (!config || !socket.data.username) {
      if (cb) cb({ success: false, message: "Noto'g'ri so'rov." });
      return;
    }

    leaveCurrentRoom(socket);
    const room = rooms[mode];
    const team = assignSlot(room);

    socket.join(mode);
    socket.data.roomKey = mode;

    if (team === null) {
      room.spectators[socket.id] = { username: socket.data.username };
      if (cb) cb({ success: true, role: 'spectator', config });
      return;
    }

    const pos = spawnPositionFor(room, team);
    room.players[socket.id] = {
      id: socket.id,
      username: socket.data.username,
      team,
      x: pos.x, y: pos.y, vx: 0, vy: 0,
      input: { x: 0, y: 0, kick: false },
      kickHoldStart: null,
      goalsThisMatch: 0
    };

    checkMatchReadiness(room);
    if (cb) cb({ success: true, role: 'player', team, config });
  });

  socket.on('leaveStadium', () => {
    leaveCurrentRoom(socket);
  });

  socket.on('input', (inp) => {
    const roomKey = socket.data.roomKey;
    if (!roomKey) return;
    const p = rooms[roomKey].players[socket.id];
    if (!p || typeof inp !== 'object') return;

    let x = Number(inp.x) || 0;
    let y = Number(inp.y) || 0;
    const mag = Math.hypot(x, y);
    if (mag > 1) { x /= mag; y /= mag; }

    p.input.x = x;
    p.input.y = y;
    p.input.kick = !!inp.kick;
  });

  socket.on('chat', (text) => {
    const roomKey = socket.data.roomKey;
    if (!roomKey || !socket.data.username) return;
    const clean = String(text || '').slice(0, 140).trim();
    if (!clean) return;

    const room = rooms[roomKey];
    const isSpectator = !!room.spectators[socket.id];
    io.to(roomKey).emit('chat', {
      username: socket.data.username,
      text: clean,
      team: room.players[socket.id] ? room.players[socket.id].team : null,
      isSpectator
    });
  });

  socket.on('disconnect', () => {
    leaveCurrentRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`EgoBall Multiplayer server ${PORT}-portda ishga tushdi`);
});
