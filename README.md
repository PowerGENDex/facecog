# Maca Beungeut — Face Recognition di Browser

Aplikasi pengenalan wajah (face recognition) yang berjalan **sepenuhnya di browser**.
Daftarkan wajah seseorang, lalu aplikasi akan mengenalinya secara real-time lewat
kamera atau dari foto. Tidak ada server, tidak ada data yang diunggah — model AI dan
database wajah ada di perangkat Anda.

Dibangun dengan [face-api](https://github.com/vladmandic/face-api) (TensorFlow.js) dan [Vite](https://vite.dev).

## Fitur

- **Kamera real-time** — deteksi & kenali banyak wajah sekaligus, lengkap dengan nama dan persentase kemiripan.
- **Pendaftaran wajah terpandu** — bingkai oval dan petunjuk langkah demi langkah (lihat lurus, toleh kiri/kanan) langsung di atas video, lengkap dengan cincin progres dan getaran di HP. Nama yang sudah ada akan ditambah sampelnya supaya makin akurat.
- **Ramah HP** — mode layar penuh, tombol ganti kamera depan/belakang, dan tombol besar yang mudah dijangkau jempol.
- **Analisis foto** — unggah/seret foto, semua wajah ditandai dan bisa langsung didaftarkan dari foto.
- **Riwayat terdeteksi** — catatan siapa terlihat dan kapan (cocok untuk absensi sederhana), bisa diunduh sebagai CSV.
- **Database wajah** — ubah nama, hapus, serta ekspor/impor ke file JSON untuk backup atau pindah perangkat.
- **Pengaturan** — pilih detektor *Cepat* (Tiny Face Detector) atau *Akurat* (SSD MobileNet) dan atur ambang kecocokan.

## Menjalankan

Butuh Node.js 20+.

```bash
npm install
npm run dev
```

Buka alamat yang ditampilkan (biasanya http://localhost:5173), klik **Nyalakan kamera**, dan izinkan akses kamera.

Build untuk produksi (hasilnya di folder `dist/`, bisa di-host di hosting statis mana pun, mis. GitHub Pages / Netlify):

```bash
npm run build
npm run preview   # coba hasil build secara lokal
```

### Online lewat GitHub Pages

Repo ini punya workflow `.github/workflows/deploy.yml` yang otomatis build & deploy setiap ada push
ke branch default. Aktifkan sekali saja:

1. Buka **Settings → Pages** di repo GitHub.
2. Di **Build and deployment → Source**, pilih **GitHub Actions**.
3. Buka tab **Actions**, pilih run terakhir *Build & Deploy ke GitHub Pages*, klik **Re-run all jobs**
   (atau push commit baru).

Setelah selesai, aplikasi bisa dibuka di `https://<username>.github.io/facecog/` — sudah HTTPS, jadi
kamera juga jalan di HP.

> GitHub Pages untuk repo **private** butuh akun GitHub Pro/Team. Di akun gratis, repo harus dijadikan
> public dulu (Settings → General → Danger Zone → Change visibility). Situs Pages selalu bisa diakses publik.

> **Catatan:** browser hanya mengizinkan kamera di `https://` atau `http://localhost`.
> Untuk mencoba dari HP di jaringan yang sama, host hasil build di layanan ber-HTTPS
> atau gunakan tunnel HTTPS. Tab **Foto** tetap bisa dipakai tanpa HTTPS.

## Cara pakai

1. **Daftarkan wajah** — di tab *Kamera*, tekan tombol **+ Daftarkan wajah** di atas video, tulis nama,
   lalu tekan **Mulai**. Ikuti petunjuk di layar: posisikan wajah di dalam bingkai oval, lihat lurus,
   toleh sedikit ke kiri & kanan. Di HP, mode ini otomatis layar penuh. Ulangi dengan nama yang sama untuk
   menambah sampel (mis. dengan/tanpa kacamata, pencahayaan berbeda).
2. **Kenali** — wajah terdaftar diberi kotak hijau dengan nama; wajah lain kotak oranye "Tidak dikenal".
3. **Dari foto** — di tab *Foto*, pilih gambar. Setiap wajah bisa didaftarkan atau ditambah sampelnya langsung dari daftar di samping.
4. **Backup** — di tab *Database*, klik **Ekspor** untuk menyimpan data wajah ke file JSON; **Impor** untuk memulihkannya.

### Tips akurasi

- Gunakan pencahayaan yang cukup dan wajah menghadap kamera.
- Daftarkan 2–3 kali dengan kondisi berbeda untuk hasil yang lebih stabil.
- Jika sering salah kenal, turunkan **ambang kecocokan** (mis. 0.45). Jika sering "tidak dikenal", naikkan (mis. 0.55).
- Detektor **Akurat** lebih baik untuk wajah kecil/miring/ber-makeup di foto; **Cepat** lebih ringan untuk kamera.

## Cara kerja

1. Detektor menemukan posisi wajah di gambar.
2. 68 titik landmark wajah dipakai untuk menyelaraskan wajah.
3. Jaringan pengenalan menghasilkan *descriptor* 128 angka untuk tiap wajah.
4. Descriptor dibandingkan (jarak Euclidean) dengan descriptor orang terdaftar; jika jarak rata-rata
   terdekat di bawah ambang, wajah dianggap cocok. Kemiripan ditampilkan sebagai `(1 − jarak) × 100%`.

Yang disimpan hanyalah descriptor (angka) dan thumbnail kecil di `localStorage` browser — bukan video atau foto utuh.

## Struktur proyek

```
index.html              Tampilan utama
src/main.js             Logika UI: kamera, pendaftaran, foto, riwayat, database
src/face.js             Pemuatan model, deteksi, pencocokan wajah (face-api)
src/store.js            Penyimpanan localStorage, ekspor/impor
src/style.css           Gaya (mendukung mode gelap)
scripts/copy-models.mjs Menyalin bobot model dari node_modules ke public/models
```

## Privasi

Data wajah adalah data pribadi. Mintalah persetujuan orang yang wajahnya Anda daftarkan,
dan hapus datanya (tab *Database*) jika tidak diperlukan lagi.
