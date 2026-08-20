// stadiums.js
// EgoBall uchun 5 ta original stadium (1v1 - 5v5).
// Haqiqiy Haxball stadium fayllaridagi g'oya (maydon/gol/fizika parametrlari
// tuzilishi)dan ilhomlanib, lekin butunlay o'zimizning o'lcham, nisbat va
// rang dizayni bilan qurilgan.

const PLAYER_RADIUS = 15;
const BALL_RADIUS = 10;
const MARGIN = 60; // maydon atrofidagi bo'sh joy (chiziqlar/UI uchun)

function buildStadium({ key, name, teamSize, fieldW, fieldH, goalH, accel, kickBase, kickCharged, colors }) {
  return {
    key, name, teamSize,
    worldWidth: fieldW + MARGIN * 2,
    worldHeight: fieldH + MARGIN * 2,
    fieldLeft: MARGIN, fieldRight: MARGIN + fieldW,
    fieldTop: MARGIN, fieldBottom: MARGIN + fieldH,
    goalTop: MARGIN + (fieldH - goalH) / 2,
    goalBottom: MARGIN + (fieldH + goalH) / 2,
    goalDepth: 22,
    playerAccel: accel,
    kickBase, kickCharged,
    kickChargeTime: 350,
    maxSpeed: 5.0 + teamSize * 0.05,
    playerDamping: 0.96,
    ballDamping: 0.99,
    restitution: 0.5,
    scoreLimit: 3,
    colors
  };
}

const STADIUMS = {
  '1v1': buildStadium({
    key: '1v1', name: 'Arena Micro', teamSize: 1,
    fieldW: 480, fieldH: 240, goalH: 90,
    accel: 0.12, kickBase: 4.6, kickCharged: 8.6,
    colors: { field: '#2b1046', field2: '#3a1660', line: '#e8c6ff', accentRed: '#ff4d6d', accentBlue: '#4d7dff', bg: '#120a1f' }
  }),
  '2v2': buildStadium({
    key: '2v2', name: "Futsal Hovlisi", teamSize: 2,
    fieldW: 600, fieldH: 280, goalH: 110,
    accel: 0.11, kickBase: 4.4, kickCharged: 8.2,
    colors: { field: '#0d4a4a', field2: '#116060', line: '#d9fff5', accentRed: '#ff6b4d', accentBlue: '#4dd9ff', bg: '#052424' }
  }),
  '3v3': buildStadium({
    key: '3v3', name: 'Klassik Maydon', teamSize: 3,
    fieldW: 700, fieldH: 320, goalH: 130,
    accel: 0.105, kickBase: 4.2, kickCharged: 8.0,
    colors: { field: '#155e2b', field2: '#1c7a38', line: '#eaffea', accentRed: '#ff4d4d', accentBlue: '#4d8dff', bg: '#0a2814' }
  }),
  '4v4': buildStadium({
    key: '4v4', name: 'Katta Maydon', teamSize: 4,
    fieldW: 800, fieldH: 360, goalH: 150,
    accel: 0.10, kickBase: 4.0, kickCharged: 7.8,
    colors: { field: '#123a5e', field2: '#174a78', line: '#eaf4ff', accentRed: '#ff5b5b', accentBlue: '#5bb0ff', bg: '#081b2e' }
  }),
  '5v5': buildStadium({
    key: '5v5', name: 'Stadion Elite', teamSize: 5,
    fieldW: 900, fieldH: 400, goalH: 170,
    accel: 0.098, kickBase: 3.9, kickCharged: 7.6,
    colors: { field: '#3a1010', field2: '#4a1414', line: '#ffe0e0', accentRed: '#ff3b3b', accentBlue: '#8a8aff', bg: '#1a0808' }
  })
};

module.exports = { STADIUMS, PLAYER_RADIUS, BALL_RADIUS };
