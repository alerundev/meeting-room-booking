const state = {
  rooms: [],
  reservations: [],
};

const dom = {
  todayDate: document.getElementById('today-date'),
  roomPills: document.getElementById('room-pills'),
  form: document.getElementById('reservation-form'),
  formMessage: document.getElementById('form-message'),
  inputName: document.getElementById('input-name'),
  inputDate: document.getElementById('input-date'),
  inputStart: document.getElementById('input-start'),
  inputEnd: document.getElementById('input-end'),
  timetableContainer: document.getElementById('timetable-container'),
  toast: document.getElementById('toast'),
};

const ROOM_META = {
  1: { color: 'green', name: '대회의실' },
  2: { color: 'indigo', name: '중회의실' },
  3: { color: 'orange', name: '소회의실' },
};

// ── Utils ──
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const weekdays = ['일','월','화','수','목','금','토'];
  return `${d.getMonth()+1}월 ${d.getDate()}일 ${weekdays[d.getDay()]}`;
}

function parseTimeMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function buildTimes() {
  const times = [];
  for (let h = 8; h <= 20; h++) {
    for (const m of ['00', '30']) {
      if (h === 20 && m === '30') continue;
      times.push(`${String(h).padStart(2,'0')}:${m}`);
    }
  }
  return times;
}

// ── UI ──
function showToast(msg) {
  dom.toast.textContent = msg;
  dom.toast.classList.add('show');
  setTimeout(() => dom.toast.classList.remove('show'), 2400);
}

function showFormMessage(text, type) {
  dom.formMessage.textContent = text;
  dom.formMessage.className = `form-message show ${type}`;
  setTimeout(() => dom.formMessage.classList.remove('show'), 5000);
}

function pickColorName(roomId) {
  const meta = ROOM_META[roomId];
  return meta ? meta.color : 'green';
}

// ── Time selects ──
function fillSelect(select) {
  const oldVal = select.value;
  select.innerHTML = '';
  buildTimes().forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    select.appendChild(opt);
  });
  if (oldVal) select.value = oldVal;
}

// ── Rooms ──
async function loadRooms() {
  try {
    const res = await fetch('/api/rooms');
    const rooms = await res.json();
    state.rooms = rooms;
    renderRoomPills(rooms);
  } catch (err) {
    dom.roomPills.innerHTML = '<span style="color:#ff3b30;font-size:12px;">회의실 목록을 불러오지 못했습니다.</span>';
  }
}

function renderRoomPills(rooms) {
  dom.roomPills.innerHTML = '';
  rooms.forEach((r, i) => {
    const meta = ROOM_META[r.id] || { color: 'green' };
    const pill = document.createElement('div');
    pill.className = `room-pill${i === 0 ? ' selected' : ''}`;
    pill.dataset.id = r.id;
    pill.innerHTML = `<span class="room-pill-dot"></span>${r.name}`;
    pill.addEventListener('click', () => {
      dom.roomPills.querySelectorAll('.room-pill').forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');
    });
    dom.roomPills.appendChild(pill);
  });
}

// ── Timetable ──
async function loadTimetable() {
  try {
    const res = await fetch(`/api/reservations?date=${todayStr()}`);
    const data = await res.json();
    state.reservations = data;
    renderTimetable(data);
  } catch (err) {
    dom.timetableContainer.innerHTML = '<div style="color:#ff3b30;font-size:12px;padding:12px;">예약 현황을 불러오지 못했습니다.</div>';
  }
}

function renderTimetable(reservations) {
  dom.timetableContainer.innerHTML = '';
  const startHour = 8;
  const endHour = 20;
  const startMin = startHour * 60;
  const spanMin = (endHour - startHour) * 60;

  state.rooms.forEach(room => {
    const roomRes = reservations.filter(r => r.room_id === room.id);
    const color = pickColorName(room.id);

    const card = document.createElement('div');
    card.className = 'timetable-card';

    const header = document.createElement('div');
    header.className = 'timetable-header';
    header.innerHTML = `
      <span class="room-badge ${color}"></span>
      <h3>${room.name}</h3>
      <span class="room-count">${roomRes.length}건 예약</span>
    `;
    card.appendChild(header);

    const wrapper = document.createElement('div');
    wrapper.className = 'timeline-wrapper';

    // Hour markers
    const ruler = document.createElement('div');
    ruler.className = 'timeline-ruler';
    for (let h = startHour; h <= endHour; h++) {
      const s = document.createElement('span');
      s.textContent = `${h}:00`;
      ruler.appendChild(s);
    }
    wrapper.appendChild(ruler);

    const track = document.createElement('div');
    track.className = 'timeline-track';

    if (roomRes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'timeline-empty';
      empty.textContent = '예약 없음';
      track.appendChild(empty);
    }

    roomRes.forEach(r => {
      const sMin = parseTimeMin(r.start_time);
      const eMin = parseTimeMin(r.end_time);
      const left = ((sMin - startMin) / spanMin) * 100;
      const width = ((eMin - sMin) / spanMin) * 100;

      const slot = document.createElement('div');
      slot.className = `timeline-slot ${color}`;
      slot.style.left = `${Math.max(0, left)}%`;
      slot.style.width = `${Math.max(2, width)}%`;
      slot.innerHTML = `
        <span class="slot-time">${r.start_time}–${r.end_time}</span>
        <span class="slot-name">${escapeHtml(r.name)}</span>
      `;
      track.appendChild(slot);
    });

    // Vertical grid lines every 2 hours
    for (let h = startHour + 2; h < endHour; h += 2) {
      const line = document.createElement('div');
      line.className = 'timeline-grid-line';
      line.style.left = `${((h - startHour) / 12) * 100}%`;
      track.appendChild(line);
    }

    wrapper.appendChild(track);
    card.appendChild(wrapper);
    dom.timetableContainer.appendChild(card);
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Submit ──
dom.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  dom.formMessage.classList.remove('show');

  const name = dom.inputName.value.trim();
  const roomInput = dom.roomPills.querySelector('.room-pill.selected');
  const room_id = roomInput ? Number(roomInput.dataset.id) : null;
  const date = dom.inputDate.value;
  const start_time = dom.inputStart.value;
  const end_time = dom.inputEnd.value;

  if (!name) { showFormMessage('예약자 이름을 입력해 주세요.', 'error'); return; }
  if (!room_id) { showFormMessage('회의실을 선택해 주세요.', 'error'); return; }
  if (start_time >= end_time) { showFormMessage('종료 시간은 시작 시간보다 늦어야 합니다.', 'error'); return; }

  try {
    const res = await fetch('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, room_id, date, start_time, end_time }),
    });
    const data = await res.json();

    if (!res.ok) {
      showFormMessage(data.error || '예약에 실패했습니다.', 'error');
      return;
    }

    showFormMessage('예약이 완료되었습니다!', 'success');
    showToast('예약이 완료되었습니다.');
    dom.form.reset();
    dom.inputDate.value = todayStr();

    // re-select first room
    const firstPill = dom.roomPills.querySelector('.room-pill');
    if (firstPill) {
      dom.roomPills.querySelectorAll('.room-pill').forEach(p => p.classList.remove('selected'));
      firstPill.classList.add('selected');
    }

    await loadTimetable();
  } catch (err) {
    showFormMessage('서버 오류가 발생했습니다.', 'error');
  }
});

// ── Init ──
(async function init() {
  dom.todayDate.textContent = formatDateLabel(todayStr());
  dom.inputDate.value = todayStr();
  fillSelect(dom.inputStart);
  fillSelect(dom.inputEnd);
  // default end = start + 1 hour
  dom.inputEnd.selectedIndex = Math.min(dom.inputEnd.options.length - 1, 2);

  await loadRooms();
  await loadTimetable();
})();
