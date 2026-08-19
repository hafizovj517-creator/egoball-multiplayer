// server.js
// EgoBall Multiplayer - server-authoritative futbol o'yini serveri.
// Barcha fizika hisob-kitoblari SHU YERDA, serverda bajariladi.
// Client faqat "input" (harakat yo'nalishi + urish tugmasi) yuboradi,
// pozitsiyani hech qachon o'zi yubormaydi -> shu sabab cheat qilib bo'lmaydi.

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const accounts = require('./accounts');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ---------- Maydon / fizika konstantalari ----------
const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 400;

const FIELD_LEFT = 50, FIELD_RIGHT = 750;
const FIELD_TOP = 50, FIELD_BOTTOM = 350;
const GOAL_TOP = 150, GOAL_BOTTOM = 250;
const GOAL_DEPTH = 20;

const PLAYER_RADIUS = 15;
const BALL_RADIUS = 9;

const PLAYER_MAX_SPEED = 5.2;
const PLAYER_ACCEL = 0.28;
const PLAYER_DAMPING = 0.94;

const BALL_DAMPING = 0.993;
const KICK_STRENGTH = 6.8;
const KICK_RANGE = PLAYER_RADIUS + BALL_RADIUS + 6;

const SCORE_LIMIT = 3;
const TICK_RATE = 60;

const WORLD_INFO = {
  WORLD_WIDTH, WORLD_HEIGHT, FIELD_LEFT, FIELD_RIGHT, FIELD_TOP, FIELD_BOTTOM,
  GOAL_TOP, GOAL_BOTTOM, GOAL_DEPTH, PLAYER_RADIUS, BALL_RADIUS
};

// ---------- Xona holati (hozircha bitta umumiy xona "main") ----------
const room = {
  players: {},
  ball: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, vx: 0, vy: 0 },
  score: { red: 0, blue: 0 },
  paused: true,
  pauseReason: 'waiting',
  matchActive: false
};

function teamCounts() {
  let red = 0, blue = 0;
  for (const id in room.players) {
    if (room.players[id].team === 'red') red++; else blue++;
  }
  return { red, blue };
}

function assignTeam() {
  const c = teamCounts();
  return c.red <= c.blue ? 'red' : 'blue';
}

function spawnPositionFor(team) {
  const c = teamCounts();
  const index = team === 'red' ? c.red : c.blue;
  const baseX = team === 'red' ? 300 : 500;
  const row = Math.ceil(index / 2);
  const baseY = WORLD_HEIGHT / 2 + (index % 2 === 0 ? -1 : 1) * row * 45;
  return { x: baseX, y: Math.max(FIELD_TOP + 20, Math.min(FIELD_BOTTOM - 20, baseY)) };
}

function resetKickoff() {
  room.ball.x = WORLD_WIDTH / 2;
  room.ball.y = WORLD_HEIGHT / 2;
  room.ball.vx = 0;
  room.ball.vy = 0;
  for (const id in room.players) {
    const p = room.players[id];
    const pos = spawnPositionFor(p.team);
    p.x = pos.x; p.y = pos.y; p.vx = 0; p.vy = 0;
  }
}

function checkMatchReadiness() {
  const c = teamCounts();
  if (c.red >= 1 && c.blue >= 1) {
    if (!room.matchActive) {
      room.matchActive = true;
      room.score.red = 0;
      room.score.blue = 0;
      resetKickoff();
    }
    room.paused = false;
    room.pauseReason = null;
  } else {
    room.paused = true;
    room.pauseReason = 'waiting';
  }
}

// ---------- Kollizyon funksiyalari ----------
function resolveWallCollision(obj, radius) {
  const inGoalMouth = obj.y > GOAL_TOP && obj.y < GOAL_BOTTOM;

  if (obj.y - radius < FIELD_TOP) { obj.y = FIELD_TOP + radius; obj.vy *= -0.4; }
  if (obj.y + radius > FIELD_BOTTOM) { obj.y = FIELD_BOTTOM - radius; obj.vy *= -0.4; }

  if (!inGoalMouth) {
    if (obj.x - radius < FIELD_LEFT) { obj.x = FIELD_LEFT + radius; obj.vx *= -0.4; }
    if (obj.x + radius > FIELD_RIGHT) { obj.x = FIELD_RIGHT - radius; obj.vx *= -0.4; }
  } else {
    if (obj.x - radius < FIELD_LEFT - GOAL_DEPTH) { obj.x = FIELD_LEFT - GOAL_DEPTH + radius; obj.vx *= -0.4; }
    if (obj.x + radius > FIELD_RIGHT + GOAL_DEPTH) { obj.x = FIELD_RIGHT + GOAL_DEPTH - radius; obj.vx *= -0.4; }
  }
}

function resolveCircleCollision(a, b, ra, rb, massA, massB) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minDist = ra + rb;
  if (dist === 0 || dist >= minDist) return;

  const nx = dx / dist, ny = dy / dist;
  const overlap = minDist - dist;
  const totalMass = massA + massB;

  a.x -= nx * overlap * (massB / totalMass);
  a.y -= ny * overlap * (massB / totalMass);
  b.x += nx * overlap * (massA / totalMass);
  b.y += ny * overlap * (massA / totalMass);

  const relVx = b.vx - a.vx, relVy = b.vy - a.vy;
  const relSpeed = relVx * nx + relVy * ny;
  if (relSpeed > 0) return;

  const impulse = (-1.6 * relSpeed) / totalMass;
  a.vx -= impulse * massB * nx;
  a.vy -= impulse * massB * ny;
  b.vx += impulse * massA * nx;
  b.vy += impulse * massA * ny;
}

function checkGoal() {
  const ball = room.ball;
  if (ball.y > GOAL_TOP && ball.y < GOAL_BOTTOM) {
    if (ball.x + BALL_RADIUS < FIELD_LEFT) scoreGoal('blue');
    else if (ball.x - BALL_RADIUS > FIELD_RIGHT) scoreGoal('red');
  }
}

function scoreGoal(scoringTeam) {
  room.score[scoringTeam] += 1;
  room.paused = true;
  room.pauseReason = 'goal';
  io.to('main').emit('goal', { team: scoringTeam, score: room.score });

  if (room.score[scoringTeam] >= SCORE_LIMIT) {
    endMatch(scoringTeam);
  } else {
    setTimeout(() => {
      resetKickoff();
      checkMatchReadiness();
    }, 1800);
  }
}

function endMatch(winningTeam) {
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

  io.to('main').emit('matchEnd', { winningTeam, score: room.score });

  setTimeout(() => {
    room.score.red = 0;
    room.score.blue = 0;
    resetKickoff();
    checkMatchReadiness();
  }, 4000);
}

// ---------- O'yin sikli (60 marta/sekund) ----------
function tick() {
  if (!room.paused) {
    for (const id in room.players) {
      const p = room.players[id];
      const inp = p.input;

      let ax = inp.x, ay = inp.y;
      const mag = Math.hypot(ax, ay);
      if (mag > 1) { ax /= mag; ay /= mag; }

      p.vx += ax * PLAYER_ACCEL;
      p.vy += ay * PLAYER_ACCEL;
      p.vx *= PLAYER_DAMPING;
      p.vy *= PLAYER_DAMPING;

      const speed = Math.hypot(p.vx, p.vy);
      if (speed > PLAYER_MAX_SPEED) {
        p.vx = (p.vx / speed) * PLAYER_MAX_SPEED;
        p.vy = (p.vy / speed) * PLAYER_MAX_SPEED;
      }

      p.x += p.vx;
      p.y += p.vy;
      resolveWallCollision(p, PLAYER_RADIUS);
    }

    const ids = Object.keys(room.players);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        resolveCircleCollision(room.players[ids[i]], room.players[ids[j]], PLAYER_RADIUS, PLAYER_RADIUS, 1, 1);
      }
    }

    const ball = room.ball;
    ball.vx *= BALL_DAMPING;
    ball.vy *= BALL_DAMPING;
    ball.x += ball.vx;
    ball.y += ball.vy;

    for (const id in room.players) {
      const p = room.players[id];
      resolveCircleCollision(p, ball, PLAYER_RADIUS, BALL_RADIUS, 3, 1);

      if (p.input.kick) {
        const dx = ball.x - p.x, dy = ball.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < KICK_RANGE && dist > 0.01) {
          const nx = dx / dist, ny = dy / dist;
          ball.vx += nx * KICK_STRENGTH;
          ball.vy += ny * KICK_STRENGTH;
        }
      }
    }

    resolveWallCollision(ball, BALL_RADIUS);
    checkGoal();
  }

  broadcastState();
}

function broadcastState() {
  const players = Object.values(room.players).map(p => ({
    id: p.id, username: p.username, team: p.team, x: p.x, y: p.y
  }));

  io.to('main').emit('state', {
    players,
    ball: { x: room.ball.x, y: room.ball.y },
    score: room.score,
    paused: room.paused,
    pauseReason: room.pauseReason
  });
}

setInterval(tick, 1000 / TICK_RATE);

// ---------- Socket ulanishlar ----------
io.on('connection', (socket) => {
  socket.on('register', ({ username, password }, cb) => {
    const result = accounts.registerUser(username, password);
    if (cb) cb(result);
  });

  socket.on('login', ({ username, password }, cb) => {
    const result = accounts.loginUser(username, password);
    if (!result.success) { if (cb) cb(result); return; }

    const team = assignTeam();
    const pos = spawnPositionFor(team);

    room.players[socket.id] = {
      id: socket.id,
      username: result.user.username,
      team,
      x: pos.x, y: pos.y, vx: 0, vy: 0,
      input: { x: 0, y: 0, kick: false },
      goalsThisMatch: 0
    };

    socket.join('main');
    checkMatchReadiness();

    if (cb) cb({ success: true, user: result.user, team, world: WORLD_INFO });
  });

  socket.on('input', (inp) => {
    const p = room.players[socket.id];
    if (!p || typeof inp !== 'object') return;

    let x = Number(inp.x) || 0;
    let y = Number(inp.y) || 0;
    const mag = Math.hypot(x, y);
    if (mag > 1) { x /= mag; y /= mag; } // hile qilib tez yurishning oldini olish

    p.input.x = x;
    p.input.y = y;
    p.input.kick = !!inp.kick;
  });

  socket.on('disconnect', () => {
    delete room.players[socket.id];
    checkMatchReadiness();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`EgoBall Multiplayer server ${PORT}-portda ishga tushdi`);
});
