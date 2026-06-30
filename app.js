/* ============================================================
   Dashboard Monitoring Pekerjaan — OSDM
   app.js — terhubung ke Google Sheets
   ============================================================ */

/* ── KONFIGURASI GOOGLE SHEETS ───────────────────────────────
   1. Buka Google Sheet kamu → klik "Share" → ubah ke
      "Anyone with the link" (Viewer) supaya bisa dibaca publik.
   2. Salin ID Sheet dari URL:
      https://docs.google.com/spreadsheets/d/  >>ID<<  /edit
   3. Tempel ID itu ke SHEET_ID di bawah ini.
   4. GID adalah angka di akhir URL setelah "gid=" (lihat tab sheet).
   5. Pastikan baris pertama sheet berisi header yang namanya
      SAMA seperti di kolom kiri COLUMN_MAP berikut (boleh ubah
      urutan kolom, tapi nama header harus sama persis).
   ──────────────────────────────────────────────────────────── */
const SHEET_ID        = "1NLLG-XKkXvctZA-fs1xhqymGOv5n9TFsdMhiT9S7EsE";
const GID             = "0"; // sheet "Pekerjaan" — ganti jika gid tab kamu berbeda
const AUTO_REFRESH_MS = 5 * 60 * 1000;

const COLUMN_MAP = {
  "ID"                      : "id",
  "Tanggal"                 : "tanggal",
  "Triwulan"                : "triwulan",
  "Bulan"                   : "bulan",
  "Minggu ke"               : "minggu",
  "Nama Kegiatan/Pekerjaan" : "pekerjaan",
  "PIC"                     : "pic",
  "Prioritas"               : "prioritas",
  "Progres (%)"             : "progres",
  "Status"                  : "status",
  "Deadline"                : "deadline",
  "Kendala"                 : "kendala",
  "Tindak Lanjut"           : "tindak"
};

// Status yang dikenal sistem (sesuaikan jika nama status di sheet berbeda)
const STATUS_LIST   = ["Selesai", "In Progress", "Review", "Terlambat"];
const statusColor    = { "Selesai": "#16a34a", "In Progress": "#2563eb", "Review": "#f59e0b", "Terlambat": "#ef4444" };
const statusBadgeCls = { "Selesai": "selesai", "In Progress": "progress", "Review": "review", "Terlambat": "terlambat" };
const prioCls         = { "Tinggi": "tinggi", "Sedang": "sedang", "Rendah": "rendah" };

const MONTHS_ID = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];

/* ── STATE ────────────────────────────────────────────────── */
let RAW_DATA    = [];
let filtered    = [];
let currentPage = 1;
const PAGE_SIZE = 5;
let donutChart  = null;
let barChart    = null;

/* ── FETCH DATA DARI GOOGLE SHEETS (via GViz JSONP) ──────── */
function loadSheetData() {
  return new Promise((resolve, reject) => {
    const cb    = "gsCallback_" + Date.now();
    const timer = setTimeout(() => { cleanup(); reject(new Error("Timeout: koneksi ke Google Sheets habis waktu.")); }, 15000);

    function cleanup() {
      delete window[cb];
      if (sc.parentNode) sc.parentNode.removeChild(sc);
      clearTimeout(timer);
    }

    window[cb] = function (res) {
      cleanup();
      try {
        if (res.status === "error") {
          reject(new Error("Google Sheets menolak permintaan. Pastikan sharing diset ke 'Anyone with the link'."));
          return;
        }
        const headers = res.table.cols.map(c => (c.label || c.id || "").trim());
        const rows    = res.table.rows.map(r =>
          r.c.map(cell => {
            if (!cell)          return "";
            if (cell.f != null) return cell.f;
            return cell.v != null ? cell.v : "";
          })
        );
        resolve({ headers, rows });
      } catch (e) { reject(e); }
    };

    const sc   = document.createElement("script");
    sc.src     = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${GID}&headers=1&tqx=responseHandler:${cb}`;
    sc.onerror = () => { cleanup(); reject(new Error("Gagal menghubungi Google Sheets. Cek koneksi internet dan SHEET_ID.")); };
    document.body.appendChild(sc);
  });
}

/* ── PARSE ROWS → DATA OBJEK ─────────────────────────────── */
function rowsToData(headers, rows) {
  const idx = {};
  headers.forEach((h, i) => {
    const key = COLUMN_MAP[h.trim()];
    if (key) idx[key] = i;
  });

  return rows.map(r => {
    const get = k => idx[k] !== undefined ? String(r[idx[k]] ?? "").trim() : "";
    const pekerjaan = get("pekerjaan");
    if (!pekerjaan) return null;

    let progres = parseFloat(String(get("progres")).replace("%", "").replace(",", "."));
    if (isNaN(progres)) progres = 0;

    let status = get("status");
    if (!STATUS_LIST.includes(status)) {
      status = progres >= 100 ? "Selesai" : progres > 0 ? "In Progress" : "Review";
    }

    let prioritas = get("prioritas");
    if (!prioCls[prioritas]) prioritas = "Sedang";

    return {
      id        : get("id"),
      tanggal   : get("tanggal"),
      triwulan  : get("triwulan"),
      bulan     : get("bulan"),
      minggu    : get("minggu"),
      pekerjaan,
      pic       : get("pic") || "Belum ditentukan",
      prioritas,
      progres   : Math.max(0, Math.min(100, progres)),
      status,
      deadline  : get("deadline"),
      kendala   : get("kendala"),
      tindak    : get("tindak")
    };
  }).filter(Boolean);
}

/* ── PARSE TANGGAL (dukung dd/mm/yyyy, Date(...), atau teks bebas) ── */
function parseDate(str) {
  if (!str) return null;
  // Format Google Visualization: Date(2026,5,30)
  const m = String(str).match(/Date\((\d+),(\d+),(\d+)\)/);
  if (m) return new Date(+m[1], +m[2], +m[3]);
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDateShort(str) {
  const d = parseDate(str);
  if (!d) return str || "-";
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

/* ── POPULATE FILTER DROPDOWNS ───────────────────────────── */
function populateFilters() {
  const unique = (field) => [...new Set(RAW_DATA.map(d => d[field]).filter(v => v && v.trim()))].sort();

  const fill = (id, values, placeholder) => {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    values.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      if (v === cur) opt.selected = true;
      sel.appendChild(opt);
    });
  };

  fill("filterTriwulan", unique("triwulan"), "Semua Triwulan");
  fill("filterBulan",    unique("bulan"),    "Semua Bulan");
  fill("filterMinggu",   unique("minggu"),   "Semua Minggu");
  fill("filterPic",      unique("pic"),      "Semua PIC");

  // Filter tahun untuk grafik bar
  const years = [...new Set(RAW_DATA.map(d => {
    const dt = parseDate(d.tanggal) || parseDate(d.deadline);
    return dt ? dt.getFullYear() : null;
  }).filter(Boolean))].sort();
  const yearSel = document.getElementById("yearFilter");
  const curY = yearSel.value;
  yearSel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("") || `<option value="${new Date().getFullYear()}">${new Date().getFullYear()}</option>`;
  if (years.includes(+curY)) yearSel.value = curY;
}

/* ── APPLY FILTERS ────────────────────────────────────────── */
function applyFilters() {
  const tw  = document.getElementById("filterTriwulan").value;
  const bln = document.getElementById("filterBulan").value;
  const mg  = document.getElementById("filterMinggu").value;
  const pic = document.getElementById("filterPic").value;

  filtered = RAW_DATA.filter(d => {
    if (tw  && d.triwulan !== tw)  return false;
    if (bln && d.bulan    !== bln) return false;
    if (mg  && d.minggu   !== mg)  return false;
    if (pic && d.pic      !== pic) return false;
    return true;
  });

  currentPage = 1;
  renderAll();
}

/* ── UI STATE ─────────────────────────────────────────────── */
function setLoading(v) {
  document.getElementById("loadingBanner").classList.toggle("show", v);
  document.getElementById("refreshBtn").classList.toggle("loading", v);
  if (v) document.getElementById("errorBanner").classList.remove("show");
}

function setError(msg) {
  document.getElementById("errorBanner").classList.add("show");
  document.getElementById("errorMsg").textContent = msg;
}

function setSynced() {
  document.getElementById("errorBanner").classList.remove("show");
  const now = new Date();
  document.getElementById("dateMain").textContent = now.toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  document.getElementById("dateSub").textContent   = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + " WIB";
}

/* ── REFRESH / MAIN ENTRY POINT ──────────────────────────── */
async function refresh() {
  setLoading(true);
  try {
    const { headers, rows } = await loadSheetData();
    const data = rowsToData(headers, rows);
    if (!data.length) throw new Error("Tidak ada data terbaca. Periksa nama kolom header di sheet sesuai COLUMN_MAP.");
    RAW_DATA    = data;
    filtered    = [...data];
    currentPage = 1;
    populateFilters();
    renderAll();
    setSynced();
  } catch (e) {
    setError(e.message || "Terjadi kesalahan saat memuat data.");
  } finally {
    setLoading(false);
  }
}

/* ── RENDER SEMUA KOMPONEN ───────────────────────────────── */
function renderAll() {
  renderKpi();
  renderDonut();
  renderBar();
  renderPicSummary();
  renderTable();
  renderMendesak();
  renderAktivitas();
  renderDeadline();
}

/* ── KPI CARDS ────────────────────────────────────────────── */
function pct(n, total) { return total ? Math.round((n / total) * 1000) / 10 : 0; }

function renderKpi() {
  const total     = filtered.length;
  const selesai   = filtered.filter(d => d.status === "Selesai").length;
  const progress  = filtered.filter(d => d.status === "In Progress").length;
  const terlambat = filtered.filter(d => d.status === "Terlambat").length;

  document.getElementById("kpiTotal").textContent     = total;
  document.getElementById("kpiProgress").textContent  = progress;
  document.getElementById("kpiSelesai").textContent   = selesai;
  document.getElementById("kpiTerlambat").textContent = terlambat;

  document.getElementById("kpiProgressPct").textContent  = `${pct(progress, total)}% dari total`;
  document.getElementById("kpiSelesaiPct").textContent    = `${pct(selesai, total)}% dari total`;
  document.getElementById("kpiTerlambatPct").textContent  = `${pct(terlambat, total)}% dari total`;

  document.getElementById("notifBadge").textContent = terlambat;
}

/* ── DONUT: STATUS PEKERJAAN ─────────────────────────────── */
function renderDonut() {
  const counts = STATUS_LIST.map(s => filtered.filter(d => d.status === s).length);
  const total  = filtered.length;
  const ctx    = document.getElementById("donutChart").getContext("2d");

  if (donutChart) donutChart.destroy();
  donutChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: STATUS_LIST,
      datasets: [{ data: counts, backgroundColor: STATUS_LIST.map(s => statusColor[s]), borderWidth: 0 }]
    },
    options: {
      cutout: "68%",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${c.label}: ${c.parsed} (${pct(c.parsed, total)}%)` } }
      }
    }
  });

  document.getElementById("legendList").innerHTML = STATUS_LIST.map((s, i) => `
    <div class="legend-row">
      <span class="lbl"><span class="dot" style="background:${statusColor[s]}"></span>${s}</span>
      <span class="val">${pct(counts[i], total)}% (${counts[i]})</span>
    </div>`).join("");
}

/* ── BAR CHART: PEKERJAAN PER BULAN ──────────────────────── */
function renderBar() {
  const year = +document.getElementById("yearFilter").value || new Date().getFullYear();
  document.getElementById("barYear").textContent = year;

  const counts = new Array(12).fill(0);
  RAW_DATA.forEach(d => {
    const dt = parseDate(d.tanggal) || parseDate(d.deadline);
    if (dt && dt.getFullYear() === year) counts[dt.getMonth()]++;
  });

  const ctx = document.getElementById("barChart").getContext("2d");
  if (barChart) barChart.destroy();
  barChart = new Chart(ctx, {
    type: "bar",
    data: { labels: MONTHS_ID, datasets: [{ data: counts, backgroundColor: "#2563eb", borderRadius: 5, maxBarThickness: 30 }] },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.y} Pekerjaan` } } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 25 } }, x: { grid: { display: false } } }
    }
  });
}

/* ── RINGKASAN PER PIC ────────────────────────────────────── */
function initials(name) {
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

function renderPicSummary() {
  const map = {};
  filtered.forEach(d => { map[d.pic] = (map[d.pic] || 0) + 1; });
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);

  document.getElementById("picList").innerHTML = sorted.map(([name, count]) => `
    <div class="pic-row">
      <span class="pic-avatar">${esc(initials(name))}</span>
      <span class="pic-name">${esc(name)}</span>
      <span class="pic-count">${count}</span>
    </div>`).join("") || '<div style="color:var(--muted);font-size:12.5px;">Belum ada data PIC.</div>';
}

/* ── TABEL PEKERJAAN ──────────────────────────────────────── */
function renderTable() {
  const q   = document.getElementById("searchInput").value.toLowerCase().trim();
  const src = q ? filtered.filter(d => d.pekerjaan.toLowerCase().includes(q) || d.pic.toLowerCase().includes(q)) : filtered;

  const totalPages = Math.max(1, Math.ceil(src.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = 1;
  const start = (currentPage - 1) * PAGE_SIZE;
  const page  = src.slice(start, start + PAGE_SIZE);

  document.getElementById("mainTableBody").innerHTML = page.map((d, i) => {
    const isLate = d.status === "Terlambat";
    return `
    <tr>
      <td style="color:var(--muted);text-align:center;">${start + i + 1}</td>
      <td style="white-space:nowrap;">${esc(fmtDateShort(d.tanggal))}</td>
      <td>${esc(d.pekerjaan)}</td>
      <td><div class="pic-cell"><span class="pic-avatar">${esc(initials(d.pic))}</span>${esc(d.pic)}</div></td>
      <td><span class="prio ${prioCls[d.prioritas] || 'sedang'}">${esc(d.prioritas)}</span></td>
      <td><span class="badge ${statusBadgeCls[d.status] || 'review'}">${esc(d.status)}</span></td>
      <td>
        <div class="prog-cell">
          <div class="track"><div class="fill" style="width:${d.progres}%;background:${statusColor[d.status] || '#64748b'}"></div></div>
          <span class="pct">${d.progres}%</span>
        </div>
      </td>
      <td><span class="deadline-cell ${isLate ? 'late' : ''}">${esc(fmtDateShort(d.deadline))}</span></td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:24px;">Tidak ada data.</td></tr>`;

  document.getElementById("pageInfo").textContent =
    `Menampilkan ${src.length ? start + 1 : 0} – ${Math.min(start + PAGE_SIZE, src.length)} dari ${src.length} data`;
}

/* ── PEKERJAAN MENDESAK (deadline terdekat & belum selesai) ── */
function renderMendesak() {
  const now = new Date();
  const list = filtered
    .filter(d => d.status !== "Selesai" && parseDate(d.deadline))
    .map(d => ({ ...d, _diff: Math.ceil((parseDate(d.deadline) - now) / 86400000) }))
    .filter(d => d._diff <= 5)
    .sort((a, b) => a._diff - b._diff)
    .slice(0, 5);

  document.getElementById("mendesakList").innerHTML = list.map(d => `
    <div class="mendesak-item">
      <div class="m-title">${esc(d.pekerjaan)}</div>
      <div class="m-sub">Deadline ${esc(fmtDateShort(d.deadline))} (${d._diff <= 0 ? 'lewat tenggat' : d._diff + ' hari lagi'})</div>
    </div>`).join("") || '<div style="color:var(--muted);font-size:12.5px;">Tidak ada pekerjaan mendesak.</div>';
}

/* ── AKTIVITAS TERBARU (placeholder dari data terbaru) ──── */
function renderAktivitas() {
  const sorted = [...filtered].sort((a, b) => (parseDate(b.tanggal) || 0) - (parseDate(a.tanggal) || 0)).slice(0, 5);
  document.getElementById("aktivitasList").innerHTML = sorted.map(d => `
    <div class="aktivitas-item">
      <span class="a-avatar">${esc(initials(d.pic))}</span>
      <div class="a-text"><b>${esc(d.pic)}</b> mengupdate progress pekerjaan <b>${esc(d.pekerjaan)}</b> menjadi ${d.progres}%</div>
    </div>`).join("") || '<div style="color:var(--muted);font-size:12.5px;">Belum ada aktivitas.</div>';
}

/* ── DEADLINE MENDATANG ──────────────────────────────────── */
function renderDeadline() {
  const now = new Date();
  const list = filtered
    .filter(d => d.status !== "Selesai" && parseDate(d.deadline))
    .map(d => ({ ...d, _date: parseDate(d.deadline), _diff: Math.ceil((parseDate(d.deadline) - now) / 86400000) }))
    .sort((a, b) => a._date - b._date)
    .slice(0, 5);

  document.getElementById("deadlineList").innerHTML = list.map(d => `
    <div class="deadline-item">
      <div class="deadline-date">
        <span class="dd-day">${d._date.getDate()}</span>
        <span class="dd-mon">${MONTHS_ID[d._date.getMonth()]}</span>
      </div>
      <div class="deadline-info">
        <div class="d-title">${esc(d.pekerjaan)}</div>
        <div class="d-pic">${esc(d.pic)}</div>
      </div>
      <span class="deadline-tag">${d._diff <= 0 ? 'lewat' : d._diff + ' hari lagi'}</span>
    </div>`).join("") || '<div style="color:var(--muted);font-size:12.5px;">Tidak ada deadline mendatang.</div>';
}

/* ── MODAL DETAIL ─────────────────────────────────────────── */
function openModal(idx) {
  if (idx < 0 || idx >= RAW_DATA.length) return;
  const d = RAW_DATA[idx];
  document.getElementById("modalTitle").textContent = d.pekerjaan;
  document.getElementById("modalBody").innerHTML = `
    <table class="modal-table">
      <tr><th>PIC</th><td>${esc(d.pic)}</td></tr>
      <tr><th>Prioritas</th><td><span class="prio ${prioCls[d.prioritas] || 'sedang'}">${esc(d.prioritas)}</span></td></tr>
      <tr><th>Status</th><td><span class="badge ${statusBadgeCls[d.status] || 'review'}">${esc(d.status)}</span></td></tr>
      <tr><th>Progress</th><td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="flex:1;height:8px;background:#e8edf5;border-radius:5px;overflow:hidden;">
            <div style="width:${d.progres}%;height:100%;background:${statusColor[d.status] || '#64748b'};border-radius:5px;"></div>
          </div>
          <span style="font-weight:700;font-size:13px;min-width:36px;">${d.progres}%</span>
        </div>
      </td></tr>
      <tr><th>Triwulan</th><td>${esc(d.triwulan || "-")}</td></tr>
      <tr><th>Bulan</th><td>${esc(d.bulan || "-")}</td></tr>
      <tr><th>Minggu ke</th><td>${esc(d.minggu || "-")}</td></tr>
      <tr><th>Tanggal</th><td>${esc(fmtDateShort(d.tanggal))}</td></tr>
      <tr><th>Deadline</th><td>${esc(fmtDateShort(d.deadline))}</td></tr>
      <tr><th>Kendala</th><td>${esc(d.kendala || "-")}</td></tr>
      <tr><th>Tindak Lanjut</th><td>${esc(d.tindak || "-")}</td></tr>
    </table>`;
  document.getElementById("modalOverlay").classList.add("show");
}
function closeModal() { document.getElementById("modalOverlay").classList.remove("show"); }

/* ── HELPER: ESCAPE HTML ─────────────────────────────────── */
function esc(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ── EVENT LISTENERS ──────────────────────────────────────── */
document.getElementById("refreshBtn").addEventListener("click", refresh);
document.getElementById("retryBtn").addEventListener("click", refresh);
document.getElementById("yearFilter").addEventListener("change", renderBar);
document.getElementById("searchInput").addEventListener("input", () => { currentPage = 1; renderTable(); });
["filterTriwulan","filterBulan","filterMinggu","filterPic"].forEach(id => {
  document.getElementById(id).addEventListener("change", applyFilters);
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

// Sidebar nav: highlight aktif (placeholder single-page)
document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("click", e => {
    e.preventDefault();
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    item.classList.add("active");
  });
});

/* ── INIT ─────────────────────────────────────────────────── */
refresh();
setInterval(refresh, AUTO_REFRESH_MS);
