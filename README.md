# Dashboard Monitoring Pekerjaan — OSDM

## Menghubungkan ke Google Sheets

1. Buat Google Sheet dengan **baris pertama (header)** persis seperti ini (boleh urutan kolom diubah, tapi nama header harus sama):

| ID | Tanggal | Triwulan | Bulan | Minggu ke | Nama Kegiatan/Pekerjaan | PIC | Prioritas | Progres (%) | Status | Deadline | Kendala | Tindak Lanjut |
|----|---------|----------|-------|-----------|--------------------------|-----|-----------|--------------|--------|----------|---------|----------------|
| 1  | 26/06/2026 | Triwulan II (Apr-Jun) | Juni 2026 | Minggu ke-4 (22-28 Jun) | Penyusunan Laporan Kinerja Bulanan | Andi Pratama | Tinggi | 70 | In Progress | 30/06/2026 | - | - |

Catatan kolom:
- **Status** isi salah satu dari: `Selesai`, `In Progress`, `Review`, `Terlambat`.
- **Prioritas** isi salah satu dari: `Tinggi`, `Sedang`, `Rendah`.
- **Progres (%)** cukup angka (boleh dengan atau tanpa simbol %).
- **Tanggal** dan **Deadline** isi tanggal (format apa pun yang dikenali Google Sheets, misalnya dd/mm/yyyy).

2. Klik tombol **Share** di Google Sheet → ubah akses menjadi **"Anyone with the link" (Viewer)**. Tanpa ini, data tidak bisa diambil oleh dashboard.

3. Salin **ID Sheet** dari URL Google Sheets kamu, contoh:
   `https://docs.google.com/spreadsheets/d/INI-ID-SHEET-NYA/edit#gid=0`

4. Buka file `app.js`, ganti dua baris di bagian paling atas:
   ```js
   const SHEET_ID = "ID_SHEET_KAMU_DI_SINI";
   const GID      = "0"; // angka setelah gid= di URL tab sheet yang dipakai
   ```

5. Upload ketiga file (`index.html`, `style.css`, `app.js`) ke hosting kamu (GitHub Pages, Netlify, dsb) atau buka `index.html` langsung di browser untuk uji coba lokal.

Dashboard akan otomatis menarik data dari Google Sheets setiap **5 menit**, dan bisa di-refresh manual lewat tombol "Refresh Data" di pojok kanan atas.

## Yang berubah dari versi sebelumnya
- Layout diubah total ke gaya sidebar (Dashboard, Pekerjaan, Kalender, Laporan, Tim Kerja, Dokumen, Notifikasi, Pengaturan) sesuai referensi desain.
- 4 KPI card: Total Pekerjaan, Progress, Selesai, Terlambat.
- Grafik donat Status Pekerjaan + Grafik batang Pekerjaan per Bulan + panel Ringkasan per PIC.
- Tabel "Daftar Pekerjaan" menampilkan kolom PIC, Prioritas, Status, Progress (bar), dan Deadline.
- Panel "Pekerjaan Mendesak" (deadline ≤ 5 hari & belum selesai), "Aktivitas Terbaru", dan "Deadline Mendatang" — semuanya dihitung otomatis dari data sheet (bukan data statis).
- Filter: Triwulan, Bulan, Minggu, PIC, dan pencarian teks.

## Catatan
- Branding "RSUP Fatmawati" sebelumnya diganti menjadi "OSDM" sesuai gambar referensi; logo memakai bentuk perisai sederhana — silakan ganti `<svg>` di `index.html` dengan logo resmi OSDM jika ada filenya.
- Panel "Aktivitas Terbaru" disusun otomatis dari baris data terbaru (berdasarkan kolom Tanggal) — jika kamu ingin log aktivitas yang benar-benar terpisah (siapa mengubah apa, jam berapa), itu butuh sheet/log tambahan yang bisa kita siapkan jika diperlukan.
