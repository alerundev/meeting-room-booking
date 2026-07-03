const state = {
  rooms: [],
};

const roomsGrid = document.getElementById('rooms-grid');
const statusGrid = document.getElementById('status-grid');
const todayDateEl = document.getElementById('today-date');
const modalBackdrop = document.getElementById('modal-backdrop');
const form = document.getElementById('reservation-form');
const formMessage = document.getElementById('form-message');
const roomRadioGroup = document.getElementById('room-radio-group');
const inputDate = document.getElementById('input-date');
const inputStart = document.getElementById('input-start');
const inputEnd = document.getElementById('input-end');
const toast = document.getElementById('toast');

const ROOM_ICONS = { '대회의실': '🏢', '소회의실': '🧩' };

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdays[d.getDay()]})`;
}

function buildTimeOptions(selectEl) {
  selectEl.innerHTML = '';
  for (let h = 8; h <= 20; h++) {
    for (const m of ['00', '30']) {
      if (h === 20 && m === '30') continue;
      const value = `${String(h).padStart(2, '0')}:${m}`;
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      selectEl.appendChild(opt);
    }
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

async function loadRooms() {
  try {
    const res = await fetch('/api/rooms');
    const rooms = await res.json();
    state.rooms = rooms;

    roomsGrid.innerHTML = rooms.map((r) => `
      <div class="room-card">
        <div class="room-icon">${ROOM_ICONS[r.name] || '🏬'}</div>
        <h3>${r.name}</h3>
        <p>편하게 예약하고 사용해보세요.</p>
      </div>
    `).join('');

    roomRadioGroup.innerHTML = rooms.map((r, i) => `
      <div class="room-radio">
        <input type="radio" name="room" id="room-${r.id}" value="${r.id}" ${i === 0 ? 'checked' : ''} />
        <label for="room-${r.id}">${ROOM_ICONS[r.name] || ''} ${r.name}</label>
      </div>
    `).join('');
  } catch (err) {
    roomsGrid.innerHTML = `<div class="empty-state">회의실 목록을 불러오지 못했습니다.</div>`;
  }
}

async function loadTodayStatus() {
  const date = todayStr();
  todayDateEl.textContent = formatDateLabel(date);
  try {
    const res = await fetch(`/api/reservations?date=${date}`);
    const reservations = await res.json();

    if (reservations.length === 0) {
      statusGrid.innerHTML = `<div class="empty-state">오늘 등록된 예약이 없습니다. 첫 예약을 등록해보세요!</div>`;
      return;
    }

    statusGrid.innerHTML = reservations.map((r) => `
      <div class="status-card">
        <div class="status-top">
          <span class="room-tag">${r.room_name}</span>
          <span class="time-range">${r.start_time} - ${r.end_time}</span>
        </div>
        <div class="reserver">예약자: ${escapeHtml(r.name)}</div>
      </div>
    `).join('');
  } catch (err) {
    statusGrid.innerHTML = `<div class="empty-state">예약 현황을 불러오지 못했습니다.</div>`;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function openModal() {
  formMessage.className = 'form-message';
  formMessage.textContent = '';
  form.reset();
  inputDate.value = todayStr();
  buildTimeOptions(inputStart);
  buildTimeOptions(inputEnd);
  inputEnd.selectedIndex = 1;
  modalBackdrop.classList.add('open');
}

function closeModal() {
  modalBackdrop.classList.remove('open');
}

document.getElementById('open-modal-btn').addEventListener('click', openModal);
document.getElementById('close-modal-btn').addEventListener('click', closeModal);
document.getElementById('cancel-btn').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) closeModal();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formMessage.className = 'form-message';
  formMessage.textContent = '';

  const name = document.getElementById('input-name').value.trim();
  const roomInput = form.querySelector('input[name="room"]:checked');
  const date = inputDate.value;
  const start_time = inputStart.value;
  const end_time = inputEnd.value;

  if (!roomInput) {
    formMessage.className = 'form-message error';
    formMessage.textContent = '회의실을 선택해 주세요.';
    return;
  }
  if (start_time >= end_time) {
    formMessage.className = 'form-message error';
    formMessage.textContent = '종료 시간은 시작 시간보다 늦어야 합니다.';
    return;
  }

  try {
    const res = await fetch('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        room_id: Number(roomInput.value),
        date,
        start_time,
        end_time,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      formMessage.className = 'form-message error';
      formMessage.textContent = data.error || '예약에 실패했습니다. 다른 시간대를 선택해 주세요. (마감)';
      return;
    }

    formMessage.className = 'form-message success';
    formMessage.textContent = '예약이 완료되었습니다!';
    showToast('✅ 예약이 완료되었습니다.');
    await loadTodayStatus();
    setTimeout(closeModal, 700);
  } catch (err) {
    formMessage.className = 'form-message error';
    formMessage.textContent = '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  }
});

(async function init() {
  await loadRooms();
  await loadTodayStatus();
})();
