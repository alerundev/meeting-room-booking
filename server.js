const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'roombooking',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
});

const ROOMS = ['대회의실', '소회의실'];

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reservations (
      id SERIAL PRIMARY KEY,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  for (const roomName of ROOMS) {
    await pool.query(
      `INSERT INTO rooms (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [roomName]
    );
  }
}

let dbReady = false;
let dbError = null;

async function connectWithRetry(retries = 20, delayMs = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      await initDb();
      dbReady = true;
      dbError = null;
      console.log('DB connected & initialized');
      return;
    } catch (err) {
      dbError = err.message;
      console.error(`DB connection attempt ${i + 1} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  console.error('Could not connect to DB after retries');
}

connectWithRetry();

// health check reflects DB status
app.get('/health', (req, res) => {
  if (dbReady) {
    res.json({ status: 'ok', db: 'connected' });
  } else {
    res.status(503).json({ status: 'degraded', db: 'disconnected', error: dbError });
  }
});

// 회의실 목록
app.get('/api/rooms', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name FROM rooms ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '회의실 목록을 불러오지 못했습니다.' });
  }
});

// 예약 목록 (date 쿼리로 특정 날짜만 조회 가능)
app.get('/api/reservations', async (req, res) => {
  try {
    const { date } = req.query;
    let query = `
      SELECT r.id, r.room_id, ro.name AS room_name, r.name, r.date,
             to_char(r.start_time, 'HH24:MI') AS start_time,
             to_char(r.end_time, 'HH24:MI') AS end_time,
             r.created_at
      FROM reservations r
      JOIN rooms ro ON ro.id = r.room_id
    `;
    const params = [];
    if (date) {
      params.push(date);
      query += ` WHERE r.date = $1`;
    }
    query += ` ORDER BY r.date ASC, r.start_time ASC`;
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '예약 목록을 불러오지 못했습니다.' });
  }
});

// 예약 신청
app.post('/api/reservations', async (req, res) => {
  try {
    const { name, room_id, date, start_time, end_time } = req.body;

    if (!name || !room_id || !date || !start_time || !end_time) {
      return res.status(400).json({ error: '모든 항목을 입력해 주세요.' });
    }
    if (start_time >= end_time) {
      return res.status(400).json({ error: '종료 시간은 시작 시간보다 늦어야 합니다.' });
    }

    // 중복 예약 체크: 같은 회의실, 같은 날짜, 시간대가 겹치는 예약이 있는지 확인
    const overlapQuery = `
      SELECT id FROM reservations
      WHERE room_id = $1 AND date = $2
        AND start_time < $4 AND end_time > $3
    `;
    const overlap = await pool.query(overlapQuery, [room_id, date, start_time, end_time]);

    if (overlap.rows.length > 0) {
      return res.status(409).json({ error: '이미 해당 시간대에 예약이 있습니다. 다른 시간을 선택해 주세요.' });
    }

    const insert = await pool.query(
      `INSERT INTO reservations (room_id, name, date, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [room_id, name, date, start_time, end_time]
    );

    res.status(201).json({ id: insert.rows[0].id, message: '예약이 완료되었습니다.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '예약 처리 중 오류가 발생했습니다.' });
  }
});

// 예약 취소
app.delete('/api/reservations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM reservations WHERE id = $1', [id]);
    res.json({ message: '예약이 취소되었습니다.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '예약 취소 중 오류가 발생했습니다.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
