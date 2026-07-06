import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ── Database ──────────────────────────────────────────────────
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

// ── 기존 API (그대로 유지) ───────────────────────────────────

app.get('/health', (req, res) => {
  if (dbReady) {
    res.json({ status: 'ok', db: 'connected' });
  } else {
    res.status(503).json({ status: 'degraded', db: 'disconnected', error: dbError });
  }
});

app.get('/api/rooms', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name FROM rooms ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '회의실 목록을 불러오지 못했습니다.' });
  }
});

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

app.post('/api/reservations', async (req, res) => {
  try {
    const { name, room_id, date, start_time, end_time } = req.body;

    if (!name || !room_id || !date || !start_time || !end_time) {
      return res.status(400).json({ error: '모든 항목을 입력해 주세요.' });
    }
    if (start_time >= end_time) {
      return res.status(400).json({ error: '종료 시간은 시작 시간보다 늦어야 합니다.' });
    }

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

// ── MCP Server ────────────────────────────────────────────────

const MCP_TOKEN = process.env.MCP_TOKEN;

// auth middleware for MCP endpoints
function mcpAuth(req, res, next) {
  if (!MCP_TOKEN) {
    return next(); // no token configured = allow all
  }
  const auth = req.headers.authorization || '';
  const parts = auth.split(' ');
  if (parts[0] !== 'Bearer' || parts[1] !== MCP_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

const mcpServer = new McpServer({
  name: 'meeting-room-booking-mcp',
  version: '1.0.0',
});

// tool: list_rooms - 회의실 목록 조회
mcpServer.tool(
  'list_rooms',
  '등록된 회의실 목록을 조회합니다.',
  {},
  async () => {
    if (!dbReady) {
      return {
        content: [{ type: 'text', text: 'DB가 아직 연결되지 않았습니다. 잠시 후 다시 시도해 주세요.' }],
        isError: true,
      };
    }
    const { rows } = await pool.query('SELECT id, name FROM rooms ORDER BY id ASC');
    const lines = rows.map(r => `- ${r.name} (ID: ${r.id})`).join('\n');
    return {
      content: [{ type: 'text', text: rows.length ? lines : '등록된 회의실이 없습니다.' }],
    };
  }
);

// tool: list_reservations - 예약 목록 조회
mcpServer.tool(
  'list_reservations',
  '회의실 예약 목록을 조회합니다. 특정 날짜를 지정할 수 있습니다.',
  {
    date: z.string().optional().describe('조회할 날짜 (YYYY-MM-DD 형식). 생략 시 전체 예약 조회'),
  },
  async ({ date }) => {
    if (!dbReady) {
      return {
        content: [{ type: 'text', text: 'DB가 아직 연결되지 않았습니다.' }],
        isError: true,
      };
    }
    let query = `
      SELECT r.id, r.room_id, ro.name AS room_name, r.name, r.date,
             to_char(r.start_time, 'HH24:MI') AS start_time,
             to_char(r.end_time, 'HH24:MI') AS end_time
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
    if (!rows.length) {
      return {
        content: [{ type: 'text', text: date ? `${date}에 예약이 없습니다.` : '등록된 예약이 없습니다.' }],
      };
    }
    const lines = rows.map(row =>
      `[${row.id}] ${row.room_name} | ${row.date} ${row.start_time}~${row.end_time} | 예약자: ${row.name}`
    ).join('\n');
    return {
      content: [{ type: 'text', text: lines }],
    };
  }
);

// tool: create_reservation - 예약 생성
mcpServer.tool(
  'create_reservation',
  '회의실을 예약합니다.',
  {
    room_id: z.number().describe('회의실 ID (list_rooms로 조회 가능)'),
    name: z.string().describe('예약자 이름'),
    date: z.string().describe('예약 날짜 (YYYY-MM-DD)'),
    start_time: z.string().describe('시작 시간 (HH:MM)'),
    end_time: z.string().describe('종료 시간 (HH:MM)'),
  },
  async ({ room_id, name, date, start_time, end_time }) => {
    if (!dbReady) {
      return {
        content: [{ type: 'text', text: 'DB가 아직 연결되지 않았습니다.' }],
        isError: true,
      };
    }
    if (start_time >= end_time) {
      return {
        content: [{ type: 'text', text: '종료 시간은 시작 시간보다 늦어야 합니다.' }],
        isError: true,
      };
    }
    const overlapQuery = `
      SELECT id FROM reservations
      WHERE room_id = $1 AND date = $2
        AND start_time < $4 AND end_time > $3
    `;
    const overlap = await pool.query(overlapQuery, [room_id, date, start_time, end_time]);
    if (overlap.rows.length > 0) {
      return {
        content: [{ type: 'text', text: '이미 해당 시간대에 예약이 있습니다. 다른 시간을 선택해 주세요.' }],
        isError: true,
      };
    }
    const insert = await pool.query(
      `INSERT INTO reservations (room_id, name, date, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [room_id, name, date, start_time, end_time]
    );
    return {
      content: [{ type: 'text', text: `예약이 완료되었습니다. 예약 ID: ${insert.rows[0].id}` }],
    };
  }
);

// tool: cancel_reservation - 예약 취소
mcpServer.tool(
  'cancel_reservation',
  '회의실 예약을 취소합니다.',
  {
    reservation_id: z.number().describe('취소할 예약 ID'),
  },
  async ({ reservation_id }) => {
    if (!dbReady) {
      return {
        content: [{ type: 'text', text: 'DB가 아직 연결되지 않았습니다.' }],
        isError: true,
      };
    }
    await pool.query('DELETE FROM reservations WHERE id = $1', [reservation_id]);
    return {
      content: [{ type: 'text', text: `예약(ID: ${reservation_id})이 취소되었습니다.` }],
    };
  }
);

// SSE transport
const transports = {}; // sessionId -> transport

app.get('/mcp/sse', mcpAuth, async (req, res) => {
  const transport = new SSEServerTransport('/mcp/messages', res);
  transports[transport.sessionId] = transport;
  res.on('close', () => {
    delete transports[transport.sessionId];
  });
  await mcpServer.connect(transport);
});

app.post('/mcp/messages', mcpAuth, express.json(), async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (!transport) {
    res.status(400).send('No transport found for sessionId');
    return;
  }
  await transport.handlePostMessage(req, res);
});

// ── SPA fallback ──────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
