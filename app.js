/* ============================================================
   Dashboard Monitoring Pekerjaan — app.js
   ============================================================ */

/* ── KONFIGURASI ──────────────────────────────────────────── */
const SHEET_ID       = "1BLZmMk9v5d7uXZlTn35vMvfQM7AZ5rpUwFXI35tVG58";
const GID            = "0";
const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 menit

// Mapping nama kolom Google Sheet → field internal
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
            if (!cell)           return "";
            if (cell.f != null)  return cell.f;
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

/* Helper persentase */
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
  document.getElementById("kpiSelesaiPct").textContent  = pct(selesai, total)  + "% dari total";
  document.getElementById("kpiBerjalanPct").textContent = pct(berjalan, total) + "% dari total";
  document.getElementById("kpiBelumPct").textContent    = pct(belum, total)    + "% dari total";
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
  document.getElementById("stSelesaiPct").textContent  = pct(selesai, total)  + "%";
  document.getElementById("stBerjalanPct").textContent = pct(berjalan, total) + "%";
  document.getElementById("stBelumPct").textContent    = pct(belum, total)    + "%";

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

/* ── PROGRESS BAR LIST ───────────────────────────────────── */
function renderProg() {
  const limit  = parseInt(document.getElementById("progFilter").value) || 50;
  const sorted = [...filtered].sort((a, b) => b.progres - a.progres).slice(0, limit);

  document.getElementById("progList").innerHTML = sorted.map(d => `
    <div>
      <div class="prog-item">
        <span class="prog-name" title="${esc(d.pekerjaan)}">${esc(d.pekerjaan)}</span>
        <span class="prog-pct">${d.progres}%</span>
      </div>
      <div class="prog-track">
        <div class="prog-fill" style="width:${d.progres}%"></div>
      </div>
    </div>`
  ).join("");
}

/* ── TABEL PEKERJAAN ─────────────────────────────────────── */
function renderTable() {
  const q   = document.getElementById("searchInput").value.toLowerCase();
  const src = q ? filtered.filter(d => d.pekerjaan.toLowerCase().includes(q)) : filtered;

  const totalPages = Math.max(1, Math.ceil(src.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = 1;

  const start = (currentPage - 1) * PAGE_SIZE;
  const page  = src.slice(start, start + PAGE_SIZE);

  document.getElementById("mainTableBody").innerHTML = page.map((d, i) => `
    <tr>
      <td style="color:var(--muted);text-align:center;">${start + i + 1}</td>
      <td>${esc(d.pekerjaan)}</td>
      <td>
        <span class="badge ${statusBadge[d.status] || 'belum'}">
          ${esc(d.status === "Berjalan" ? "Proses" : d.status === "Belum Mulai" ? "Terlambat" : d.status)}
        </span>
      </td>
      <td>
        <div class="prog-cell">
          <span style="font-weight:700;font-size:12px;min-width:34px;">${d.progres}%</span>
        </div>
      </td>
      <td>
        <div class="prog-cell">
          <div class="track">
            <div class="fill" style="width:${d.progres}%;background:${statusColor[d.status] || '#2563eb'}"></div>
          </div>
        </div>
      </td>
      <td style="font-size:12px;color:var(--muted);">${esc(d.target || d.tanggal || "-")}</td>
      <td><button class="btn-detail">Detail ▼</button></td>
    </tr>`
  ).join("");

  const end = Math.min(start + PAGE_SIZE, src.length);
  document.getElementById("pageInfo").textContent =
    `Menampilkan ${src.length ? start + 1 : 0} - ${end} dari ${src.length} pekerjaan`;

  document.getElementById("prevPage").disabled = currentPage <= 1;
  document.getElementById("nextPage").disabled = currentPage >= totalPages;

  // Nomor halaman
  buildPagination(totalPages);
}

function buildPagination(totalPages) {
  const pgNums = document.getElementById("pgNumbers");
  pgNums.innerHTML = "";

  const makeBtn = n => {
    const b = document.createElement("button");
    b.className  = "pg-btn" + (n === currentPage ? " active" : "");
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

/* ── DAFTAR KENDALA ──────────────────────────────────────── */
function renderKendala() {
  const list = filtered.filter(d => d.kendala && d.kendala.trim() !== "");
  document.getElementById("kendalaList").innerHTML = list.slice(0, 8).map(d => `
    <div class="acc-item">
      <span class="item-name">${esc(d.pekerjaan)}</span>
      <span class="item-count">1</span>
    </div>`
  ).join("") || '<div class="acc-item"><span class="item-name" style="color:var(--muted)">Tidak ada kendala tercatat.</span></div>';
}

/* ── TINDAK LANJUT ───────────────────────────────────────── */
function renderTindak() {
  const list = filtered.filter(d => d.tindak && d.tindak.trim() !== "");
  document.getElementById("tindakList").innerHTML = list.slice(0, 8).map(d => `
    <div class="acc-item">
      <span class="item-name">${esc(d.pekerjaan)}</span>
      <span class="item-count">1</span>
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
  const t = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage < t) { currentPage++; renderTable(); }
});

/* ── INIT ────────────────────────────────────────────────── */
refresh();
setInterval(refresh, AUTO_REFRESH_MS);
