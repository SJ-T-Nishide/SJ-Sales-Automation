const SLOTS = [
  { key: 'lunch',  label: 'ランチ',   time: '12:00〜14:00' },
  { key: 'cafe',   label: 'カフェ',   time: '11:00〜17:00' },
  { key: 'dinner', label: 'ディナー', time: '18:00〜22:00' },
  { key: 'phone',  label: '電話',     time: '20:00〜23:00' },
];

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateLabel(d) {
  return `${d.getMonth() + 1}/${d.getDate()}(${DAY_NAMES[d.getDay()]})`;
}

function getDays(n = 21) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });
}

// selected: { "2026-06-07": Set(['lunch', 'dinner']), ... }
let selected = {};

function renderGrid() {
  const grid = document.getElementById('grid');
  const days = getDays(21);

  grid.innerHTML = '';

  // ヘッダー行
  const header = document.createElement('div');
  header.className = 'grid-row header-row';
  header.appendChild(Object.assign(document.createElement('div'), { className: 'cell day-cell' }));
  for (const s of SLOTS) {
    const cell = document.createElement('div');
    cell.className = 'cell slot-header';
    cell.innerHTML = `${s.label}<br><span class="time-hint">${s.time}</span>`;
    header.appendChild(cell);
  }
  grid.appendChild(header);

  // 日付行
  for (const d of days) {
    const key = dateKey(d);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const row = document.createElement('div');
    row.className = 'grid-row' + (isWeekend ? ' weekend' : '');

    const dayCell = document.createElement('div');
    dayCell.className = 'cell day-cell';
    dayCell.textContent = dateLabel(d);
    row.appendChild(dayCell);

    for (const slot of SLOTS) {
      const cell = document.createElement('div');
      const active = selected[key]?.has(slot.key);
      cell.className = 'cell check-cell' + (active ? ' active' : '');
      cell.innerHTML = '<span class="check-mark">✓</span>';
      cell.dataset.dateKey = key;
      cell.dataset.slotKey = slot.key;
      cell.addEventListener('click', () => {
        if (!selected[key]) selected[key] = new Set();
        if (selected[key].has(slot.key)) {
          selected[key].delete(slot.key);
          cell.classList.remove('active');
        } else {
          selected[key].add(slot.key);
          cell.classList.add('active');
        }
      });
      row.appendChild(cell);
    }
    grid.appendChild(row);
  }
}

async function init() {
  const { freeDays = {} } = await new Promise((r) => chrome.storage.local.get('freeDays', r));
  selected = {};
  for (const [k, v] of Object.entries(freeDays)) {
    selected[k] = new Set(v);
  }
  renderGrid();
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  const toSave = {};
  for (const [k, v] of Object.entries(selected)) {
    if (v.size > 0) toSave[k] = [...v];
  }
  await new Promise((r) => chrome.storage.local.set({ freeDays: toSave }, r));

  const count = Object.values(toSave).reduce((sum, v) => sum + v.length, 0);
  const msg = document.getElementById('saveMsg');
  msg.textContent = `${count}スロット保存しました ✓`;
  setTimeout(() => { msg.textContent = ''; }, 2000);
});

document.getElementById('clearBtn').addEventListener('click', () => {
  selected = {};
  document.querySelectorAll('.check-cell.active').forEach((el) => el.classList.remove('active'));
});

init();
