/* ============================================================
   Dashboard Monitoring Pekerjaan — app.js
   RSUP Fatmawati
   ============================================================ */

/* ── KONFIGURASI ──────────────────────────────────────────── */
const SHEET_ID        = "1BLZmMk9v5d7uXZlTn35vMvfQM7AZ5rpUwFXI35tVG58";
const GID             = "0";
const AUTO_REFRESH_MS = 5 * 60 * 1000;

const COLUMN_MAP = {
  "ID"                        : "id",
  "Triwulan"                  : "triwulan",
  "Bulan"                     : "bulan",
  "Minggu ke"                 : "minggu",
  "Nama Kegiatan/Pekerjaan"   : "pekerjaan",
  "Progres (%)"               : "progres",
  "Status"                    : "status",
  "Kendala"                   : "kendala",
  "Tindak Lanjut"             : "tindak",
  "Tanggal Update"            : "tanggal",
  "Target"                    : "target"
};

const statusColor = {
  "Belum Mulai" : "#ef4444",
  "Berjalan"    : "#f59e0b",
  "Selesai"     : "#16a34a",
  "Terlambat"   : "#ef4444"
};

const statusBadge = {
  "Belum Mulai" : "belum",
  "Berjalan"    : "berjalan",
  "Selesai"     : "selesai",
  "Terlambat"   : "belum"
};

/* ── STATE ────────────────────────────────────────────────── */
let RAW_DATA    = [];
let filtered    = [];
let currentPage = 1;
const PAGE_SIZE = 5;
let donutChart  = null;

/* ── ACCORDION ────────────────────────────────────────────── */
function toggleAcc(id) {
  const head = document.getElementById(id + "Head");
  const body = document.getElementById(id + "Body");
  const open = head.classList.toggle("open");
  body.style.display = open ? "block" : "none";
}

/* ── FETCH DATA DARI GOOGLE SHEETS ───────────────────────── */
function loadSheetData() {
  return new Promise((resolve, reject) => {
    const cb    = "gsCallback_" + Date.now();
    const timer = setTimeout(() => { cleanup(); reject(new Error("Timeout: koneksi habis waktu.")); }, 15000);

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

    const sc  = document.createElement("script");
    sc.src    = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${GID}&headers=1&tqx=responseHandler:${cb}`;
    sc.onerror = () => { cleanup(); reject(new Error("Gagal menghubungi Google Sheets. Cek koneksi dan SHEET_ID.")); };
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

    let status = get("status") || (progres >= 100 ? "Selesai" : progres > 0 ? "Berjalan" : "Belum Mulai");
    if (!statusColor[status]) status = progres >= 100 ? "Selesai" : progres > 0 ? "Berjalan" : "Belum Mulai";

    return {
      id        : get("id"),
      triwulan  : get("triwulan"),
      bulan     : get("bulan"),
      minggu    : get("minggu"),
      pekerjaan,
      progres   : Math.max(0, Math.min(100, progres)),
      status,
      kendala   : get("kendala"),
      tindak    : get("tindak"),
      tanggal   : get("tanggal"),
      target    : get("target")
    };
  }).filter(Boolean);
}

/* ── POPULATE FILTER DROPDOWNS ───────────────────────────── */
function populateFilters() {
  const unique = (field) => [...new Set(RAW_DATA.map(d => d[field]).filter(v => v && v.trim()))].sort();

  const fill = (id, values) => {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = '<option value="">Semua</option>';
    values.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      if (v === cur) opt.selected = true;
      sel.appendChild(opt);
    });
  };

  fill("filterTriwulan", unique("triwulan"));
  fill("filterBulan",    unique("bulan"));
  fill("filterMinggu",   unique("minggu"));
  // Status sudah didefinisikan statis di HTML
}

/* ── APPLY FILTERS ────────────────────────────────────────── */
function applyFilters() {
  const tw  = document.getElementById("filterTriwulan").value;
  const bln = document.getElementById("filterBulan").value;
  const mg  = document.getElementById("filterMinggu").value;
  const st  = document.getElementById("filterStatus").value;

  filtered = RAW_DATA.filter(d => {
    if (tw  && d.triwulan !== tw)  return false;
    if (bln && d.bulan    !== bln) return false;
    if (mg  && d.minggu   !== mg)  return false;
    if (st  && d.status   !== st)  return false;
    return true;
  });

  currentPage = 1;
  renderAll();
}

/* ── RESET FILTER ─────────────────────────────────────────── */
function resetFilter() {
  ["filterTriwulan","filterBulan","filterMinggu","filterStatus"].forEach(id => {
    document.getElementById(id).value = "";
  });
  document.getElementById("searchInput").value = "";
  filtered = [...RAW_DATA];
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
  document.getElementById("syncStatus").textContent = "Gagal sinkron";
}

function setSynced() {
  document.getElementById("errorBanner").classList.remove("show");
  const now = new Date();
  const tgl = now.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
  const jam = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  document.getElementById("syncStatus").textContent = `Update Terakhir : ${tgl} ${jam} WIB`;
}

/* ── REFRESH / MAIN ENTRY POINT ──────────────────────────── */
async function refresh() {
  setLoading(true);
  try {
    const { headers, rows } = await loadSheetData();
    const data = rowsToData(headers, rows);
    if (!data.length) throw new Error("Tidak ada data terbaca. Periksa nama kolom header sheet.");
    RAW_DATA    = data;
    filtered    = [...data];
    currentPage = 1;
    populateFilters();
    renderAll();
    setSynced();
  } catch (e) {
    console.error(e);
    setError(e.message || "Terjadi kesalahan saat mengambil data.");
  } finally {
    setLoading(false);
  }
}

/* ── RENDER SEMUA SECTION ────────────────────────────────── */
function renderAll() {
  renderKPIs();
  renderDonut();
  renderProg();
  renderTable();
  renderKendala();
  renderTindak();
}

function pct(n, total) {
  return total ? ((n / total) * 100).toFixed(0) : 0;
}

/* ── KPI CARDS ───────────────────────────────────────────── */
function renderKPIs() {
  const total    = filtered.length;
  const selesai  = filtered.filter(d => d.status === "Selesai").length;
  const berjalan = filtered.filter(d => d.status === "Berjalan").length;
  const belum    = filtered.filter(d => d.status === "Belum Mulai" || d.status === "Terlambat").length;

  document.getElementById("kpiTotal").textContent       = total;
  document.getElementById("kpiSelesai").textContent     = selesai;
  document.getElementById("kpiBerjalan").textContent    = berjalan;
  document.getElementById("kpiBelum").textContent       = belum;
  document.getElementById("kpiSelesaiPct").textContent  = pct(selesai,  total) + "% dari total";
  document.getElementById("kpiBerjalanPct").textContent = pct(berjalan, total) + "% dari total";
  document.getElementById("kpiBelumPct").textContent    = pct(belum,    total) + "% dari total";
}

/* ── DONUT CHART & STATUS TABLE ──────────────────────────── */
function renderDonut() {
  const selesai  = filtered.filter(d => d.status === "Selesai").length;
  const berjalan = filtered.filter(d => d.status === "Berjalan").length;
  const belum    = filtered.filter(d => d.status === "Belum Mulai" || d.status === "Terlambat").length;
  const total    = filtered.length || 1;

  document.getElementById("stSelesai").textContent     = selesai;
  document.getElementById("stBerjalan").textContent    = berjalan;
  document.getElementById("stBelum").textContent       = belum;
  document.getElementById("stTotal").textContent       = filtered.length;
  document.getElementById("stSelesaiPct").textContent  = pct(selesai,  total) + "%";
  document.getElementById("stBerjalanPct").textContent = pct(berjalan, total) + "%";
  document.getElementById("stBelumPct").textContent    = pct(belum,    total) + "%";

  if (donutChart) donutChart.destroy();
  donutChart = new Chart(document.getElementById("donutChart"), {
    type: "doughnut",
    data: {
      labels: ["Selesai", "Proses", "Terlambat"],
      datasets: [{
        data: [selesai, berjalan, belum],
        backgroundColor: ["#16a34a", "#f59e0b", "#ef4444"],
        borderWidth: 3,
        borderColor: "#fff"
      }]
    },
    options: {
      cutout: "65%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: c => `${c.label}: ${c.parsed} (${pct(c.parsed, total)}%)`
          }
        }
      }
    }
  });
}

/* ── PROGRESS BAR LIST (tanpa garis biru — warna sesuai status) ── */
function renderProg() {
  const limit  = parseInt(document.getElementById("progFilter").value) || 50;
  const sorted = [...filtered].sort((a, b) => b.progres - a.progres).slice(0, limit);

  document.getElementById("progList").innerHTML = sorted.map(d => {
    const color = statusColor[d.status] || "#64748b";
    return `
    <div>
      <div class="prog-item">
        <span class="prog-name" title="${esc(d.pekerjaan)}">${esc(d.pekerjaan)}</span>
        <span class="prog-pct">${d.progres}%</span>
      </div>
      <div class="prog-track">
        <div class="prog-fill" style="width:${d.progres}%;background:${color}"></div>
      </div>
    </div>`;
  }).join("");
}

/* ── TABEL PEKERJAAN (search mencakup semua filtered) ────── */
function renderTable() {
  const q   = document.getElementById("searchInput").value.toLowerCase().trim();
  // FIX #6: search dilakukan pada seluruh filtered, bukan hanya halaman aktif
  const src = q
    ? filtered.filter(d => d.pekerjaan.toLowerCase().includes(q))
    : filtered;

  const totalPages = Math.max(1, Math.ceil(src.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = 1;

  const start = (currentPage - 1) * PAGE_SIZE;
  const page  = src.slice(start, start + PAGE_SIZE);

  document.getElementById("mainTableBody").innerHTML = page.map((d, i) => {
    const labelStatus = d.status === "Berjalan" ? "Proses"
                      : d.status === "Belum Mulai" ? "Terlambat"
                      : d.status;
    return `
    <tr>
      <td style="color:var(--muted);text-align:center;">${start + i + 1}</td>
      <td>${esc(d.pekerjaan)}</td>
      <td><span class="badge ${statusBadge[d.status] || 'belum'}">${esc(labelStatus)}</span></td>
      <td>
        <div class="prog-cell">
          <span style="font-weight:700;font-size:12px;min-width:34px;">${d.progres}%</span>
        </div>
      </td>
      <td>
        <div class="prog-cell">
          <div class="track">
            <div class="fill" style="width:${d.progres}%;background:${statusColor[d.status] || '#64748b'}"></div>
          </div>
        </div>
      </td>
      <td style="font-size:12px;color:var(--muted);">${esc(d.target || d.tanggal || "-")}</td>
      <td>
        <!-- FIX #5: tombol Detail berfungsi membuka modal -->
        <button class="btn-detail" onclick="openModal(${RAW_DATA.indexOf(d)})">Detail ▼</button>
      </td>
    </tr>`;
  }).join("");

  const end = Math.min(start + PAGE_SIZE, src.length);
  document.getElementById("pageInfo").textContent =
    `Menampilkan ${src.length ? start + 1 : 0} – ${end} dari ${src.length} pekerjaan`;

  document.getElementById("prevPage").disabled = currentPage <= 1;
  document.getElementById("nextPage").disabled = currentPage >= totalPages;

  buildPagination(totalPages, src);
}

function buildPagination(totalPages, src) {
  const pgNums = document.getElementById("pgNumbers");
  pgNums.innerHTML = "";

  const makeBtn = n => {
    const b = document.createElement("button");
    b.className   = "pg-btn" + (n === currentPage ? " active" : "");
    b.textContent = n;
    if (n === currentPage) {
      b.disabled = true;
    } else {
      b.onclick = () => { currentPage = n; renderTable(); };
    }
    return b;
  };

  const makeDots = () => {
    const s = document.createElement("span");
    s.textContent = "…";
    s.style.cssText = "padding:0 4px;color:var(--muted);align-self:center";
    return s;
  };

  if (totalPages <= 6) {
    for (let i = 1; i <= totalPages; i++) pgNums.appendChild(makeBtn(i));
  } else {
    pgNums.appendChild(makeBtn(1));
    if (currentPage > 3) pgNums.appendChild(makeDots());
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
      pgNums.appendChild(makeBtn(i));
    }
    if (currentPage < totalPages - 2) pgNums.appendChild(makeDots());
    pgNums.appendChild(makeBtn(totalPages));
  }
}

/* ── MODAL DETAIL ─────────────────────────────────────────── */
function openModal(idx) {
  if (idx < 0 || idx >= RAW_DATA.length) return;
  const d = RAW_DATA[idx];
  const labelStatus = d.status === "Berjalan" ? "Proses"
                    : d.status === "Belum Mulai" ? "Terlambat"
                    : d.status;

  document.getElementById("modalTitle").textContent = d.pekerjaan;
  document.getElementById("modalBody").innerHTML = `
    <table class="modal-table">
      <tr><th>Status</th><td><span class="badge ${statusBadge[d.status] || 'belum'}">${esc(labelStatus)}</span></td></tr>
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
      <tr><th>Target</th><td>${esc(d.target || d.tanggal || "-")}</td></tr>
      <tr><th>Kendala</th><td>${esc(d.kendala || "-")}</td></tr>
      <tr><th>Tindak Lanjut</th><td>${esc(d.tindak || "-")}</td></tr>
    </table>`;

  document.getElementById("modalOverlay").classList.add("show");
}

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("show");
}

/* ── DAFTAR KENDALA (tampilkan teks kendala, bukan nama kegiatan) ── */
function renderKendala() {
  // FIX #3: tampilkan kolom Kendala (bukan nama kegiatan)
  const list = filtered.filter(d => d.kendala && d.kendala.trim() !== "");
  document.getElementById("kendalaList").innerHTML = list.slice(0, 30).map(d => `
    <div class="acc-item">
      <span class="item-name">${esc(d.kendala)}</span>
      <span class="item-tag">${esc(d.pekerjaan)}</span>
    </div>`
  ).join("") || '<div class="acc-item"><span class="item-name" style="color:var(--muted)">Tidak ada kendala tercatat.</span></div>';
}

/* ── TINDAK LANJUT (tampilkan teks tindak lanjut) ────────── */
function renderTindak() {
  // FIX #4: tampilkan kolom Tindak Lanjut (bukan nama kegiatan)
  const list = filtered.filter(d => d.tindak && d.tindak.trim() !== "");
  document.getElementById("tindakList").innerHTML = list.slice(0, 30).map(d => `
    <div class="acc-item">
      <span class="item-name">${esc(d.tindak)}</span>
      <span class="item-tag">${esc(d.pekerjaan)}</span>
    </div>`
  ).join("") || '<div class="acc-item"><span class="item-name" style="color:var(--muted)">Tidak ada tindak lanjut tercatat.</span></div>';
}

/* ── HELPER: ESCAPE HTML ─────────────────────────────────── */
function esc(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* ── EVENT LISTENERS ─────────────────────────────────────── */
document.getElementById("refreshBtn").addEventListener("click", refresh);
document.getElementById("retryBtn").addEventListener("click", refresh);
document.getElementById("progFilter").addEventListener("change", renderProg);
document.getElementById("searchInput").addEventListener("input", () => { currentPage = 1; renderTable(); });
document.getElementById("prevPage").addEventListener("click", () => { if (currentPage > 1) { currentPage--; renderTable(); } });
document.getElementById("nextPage").addEventListener("click", () => {
  const q = document.getElementById("searchInput").value.toLowerCase().trim();
  const src = q ? filtered.filter(d => d.pekerjaan.toLowerCase().includes(q)) : filtered;
  const t = Math.max(1, Math.ceil(src.length / PAGE_SIZE));
  if (currentPage < t) { currentPage++; renderTable(); }
});

// Filter dropdowns
["filterTriwulan","filterBulan","filterMinggu","filterStatus"].forEach(id => {
  document.getElementById(id).addEventListener("change", applyFilters);
});
document.getElementById("resetFilter").addEventListener("click", resetFilter);

// Tutup modal dengan tombol ESC
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

/* ── INIT ────────────────────────────────────────────────── */
refresh();
setInterval(refresh, AUTO_REFRESH_MS);
