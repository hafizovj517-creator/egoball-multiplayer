// accounts.js
// Foydalanuvchilarni ro'yxatdan o'tkazish, login qilish va statistikasini saqlash.
// Ma'lumotlar users.json faylida saqlanadi (oddiy, serverga o'rnatilgan holda ishlaydi).

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const USERS_FILE = path.join(__dirname, 'users.json');

function loadUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return {};
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function registerUser(username, password) {
  username = String(username || '').trim();
  password = String(password || '');

  if (username.length < 3 || username.length > 16) {
    return { success: false, message: "Foydalanuvchi nomi 3-16 belgidan iborat bo'lishi kerak." };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return { success: false, message: "Foydalanuvchi nomida faqat harf, raqam va _ bo'lishi mumkin." };
  }
  if (password.length < 4) {
    return { success: false, message: "Parol kamida 4 belgidan iborat bo'lishi kerak." };
  }

  const users = loadUsers();
  const key = username.toLowerCase();

  if (users[key]) {
    return { success: false, message: "Bu foydalanuvchi nomi band." };
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  users[key] = {
    username,
    passwordHash,
    wins: 0,
    losses: 0,
    goals: 0,
    createdAt: Date.now()
  };
  saveUsers(users);

  return { success: true, user: { username, wins: 0, losses: 0, goals: 0 } };
}

function loginUser(username, password) {
  username = String(username || '').trim();
  password = String(password || '');

  const users = loadUsers();
  const key = username.toLowerCase();
  const user = users[key];

  if (!user) {
    return { success: false, message: "Bunday foydalanuvchi topilmadi." };
  }

  if (!bcrypt.compareSync(password, user.passwordHash)) {
    return { success: false, message: "Parol noto'g'ri." };
  }

  return {
    success: true,
    user: { username: user.username, wins: user.wins, losses: user.losses, goals: user.goals }
  };
}

function recordMatchResult(username, didWin, goalsScored) {
  const users = loadUsers();
  const key = String(username || '').trim().toLowerCase();
  if (!users[key]) return;

  if (didWin) users[key].wins += 1;
  else users[key].losses += 1;
  users[key].goals += goalsScored || 0;

  saveUsers(users);
}

module.exports = { registerUser, loginUser, recordMatchResult };
