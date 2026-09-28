# Demo Login Passkey + Absensi Wajah (SvelteKit)

Demo dua fitur untuk dipasang di aplikasi SvelteKit:

1. **Login dengan passkey**: masuk tanpa password memakai Face ID / sidik jari / PIN layar perangkat (WebAuthn).
2. **Absensi wajah**: absen masuk/pulang dengan scan wajah, cek wajah asli (tantangan acak), dan lokasi GPS.

Dibangun dengan SvelteKit (Svelte 5), [SimpleWebAuthn](https://simplewebauthn.dev) dan
[face-api](https://github.com/vladmandic/face-api).

> **Mode demo:** GitHub Pages tidak punya server, jadi bagian "server" (`src/lib/backend/`) dijalankan di
> browser dan datanya disimpan di `localStorage`. Alur dan pemanggilan library-nya **sama persis** dengan versi
> server. Untuk produksi, pindahkan folder itu ke server (lihat [Pindah ke server sungguhan](#pindah-ke-server-sungguhan)).

## Menjalankan

```bash
cd svelte-demo
npm install
npm run dev      # http://localhost:5173
npm test         # unit test liveness + logika absensi
npm run check    # type-check
```

Passkey dan kamera hanya jalan di `https://` atau `http://localhost`.

## Alur

**Daftar / login (passkey)**

```
Daftar: browser ── minta opsi ──▶ server: buat challenge
        perangkat: Face ID/sidik jari ▶ buat pasangan kunci ▶ kirim KUNCI PUBLIK saja
        server: verifikasi ▶ simpan kunci publik ▶ buat sesi

Login:  server: challenge baru ▶ perangkat: Face ID ▶ tanda tangani challenge dgn kunci privat
        server: cek tanda tangan pakai kunci publik ▶ buat sesi
```

Data wajah untuk login tidak pernah dikirim ke server; yang mengecek wajah adalah perangkat itu sendiri.

**Absensi**

1. Daftar wajah sekali (4 sampel: lurus, toleh kiri, toleh kanan, lurus).
2. Saat absen, scanner meminta: lihat lurus, lalu **3 tantangan dalam urutan acak** (buka-tutup mulut, toleh
   kiri, toleh kanan), lalu lihat lurus lagi.
3. Browser mengirim sampel wajah awal & akhir, hasil liveness, dan GPS. **Server** yang memutuskan:
   wajah cocok dengan akun ini (1:1), sampel awal = akhir (anti tukar foto), di dalam radius kantor, dan
   aturan masuk/pulang (tidak dobel, pulang setelah masuk). Waktu diambil dari server, bukan jam HP.

## Struktur

```
src/lib/backend/        "Server": pindahkan ini ke server sungguhan
  passkey.ts            Opsi & verifikasi registrasi/login WebAuthn (@simplewebauthn/server)
  attendance.ts         Daftar wajah, verifikasi 1:1, geofence, aturan absen
  session.ts            Sesi (demo: localStorage; produksi: cookie HttpOnly)
  db.ts                 "Database" localStorage (produksi: Postgres/MySQL/Supabase…)
src/lib/api.ts          Yang dipanggil UI (produksi: fetch ke API route)
src/lib/face/
  liveness.ts           Tantangan acak + deteksi toleh/buka mulut (fungsi murni, ada unit test)
  engine.ts             Pemuatan model & deteksi wajah (face-api)
src/lib/components/
  FaceScan.svelte       Scanner layar penuh dengan panduan oval
src/routes/             / (masuk/daftar), /absen, /rekap
```

## Pindah ke server sungguhan

1. Ganti adapter ke server (mis. `@sveltejs/adapter-node`) dan hapus `ssr = false` / `prerender` bila perlu.
2. Pindahkan `src/lib/backend/` ke `src/lib/server/` (SvelteKit menjamin folder ini tidak ikut ke browser).
3. Ganti `db.ts` dengan database sungguhan dan `session.ts` dengan cookie sesi `HttpOnly; Secure`.
   Simpan challenge WebAuthn di sesi server, bukan di variabel global.
4. Buat API route, misalnya:

   ```ts
   // src/routes/api/passkey/login/options/+server.ts
   import { json } from '@sveltejs/kit';
   import { loginOptions } from '$lib/server/passkey';
   export const POST = async ({ locals }) => json(await loginOptions(locals.session));
   ```

5. Ubah `src/lib/api.ts` jadi `fetch()` ke route tersebut. Kode UI tidak perlu diubah.
6. Pakai `rpID` dan `origin` tetap dari konfigurasi (mis. `absen.perusahaan.co.id`), jangan dari request.

## Keterbatasan & keamanan

- **Liveness ini bukan tersertifikasi.** Tantangan acak menahan foto cetak dan foto/video di layar HP, tapi
  bukan topeng, deepfake real-time, atau kamera virtual. Di demo, hasil liveness juga dilaporkan oleh browser.
  Untuk kebutuhan berisiko tinggi, verifikasi liveness di server dengan layanan bersertifikat ISO 30107-3.
- **Kenapa buka mulut, bukan kedip?** Model 68 titik face-api hampir tidak menggerakkan titik kelopak mata saat
  mata terpejam, sedangkan bibir terlacak jelas (tertutup ≈ 0,02–0,1; terbuka ≥ 0,2).
- **Ambang toleh/buka mulut** diambil dari pengukuran foto contoh, belum diuji di banyak orang/HP. Sesuaikan
  `YAW_TURNED`, `MOUTH_OPEN_MIN`, dll. di `liveness.ts` setelah uji coba.
- **Model pengenalan wajah** (face-api) sudah cukup tua dan akurasinya lebih rendah untuk wajah Asia. Untuk
  produksi pertimbangkan model keluarga ArcFace di server (cek lisensi komersialnya).
- **Privasi:** data wajah termasuk data pribadi spesifik (UU PDP No. 27/2022). Minta persetujuan tertulis,
  simpan descriptor (bukan foto), dan batasi aksesnya.
