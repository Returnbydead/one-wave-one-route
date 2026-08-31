# ONE WAVE ONE ROUTE

Dashboard operasional untuk membentuk assignment picker per route dan picking zone, memonitor picking, menjalankan helper-task, dan mengunduh CSV Playmaker.

## Arsitektur produksi

Frontend adalah static export. Tidak ada API Route, SSR, atau credential backend di hosting frontend.

```text
Superset dataset 400 + 108
  -> Supabase Cron terpisah setiap 5 menit
  -> sync-owor: destination IWIR aktif untuk assignment
  -> sync-so-master: seluruh destination CBT hari berjalan selain CANCELLED
  -> Postgres last-valid compact snapshots + server-side pagination
  -> Supabase Auth + RLS + RPC
  -> Cloudflare Pages static frontend
```

- Cookie/session Superset dan sync secret hanya tersimpan di Supabase Secrets/Vault.
- Browser hanya menerima publishable key dan data yang diizinkan RLS.
- Snapshot head hanya berpindah setelah satu source selesai penuh; kegagalan mempertahankan snapshot valid terakhir.
- Orders difilter berdasarkan operational date sebelum data diambil dan ditulis secara batch.
- SO Master tidak memperlebar feed IWIR: keduanya punya tabel, snapshot head, lock, dan jadwal sendiri.
- SO Master menyimpan grain `SO × destination × zone × status`; daftar dipaginasi 50 SO dan detail fragment dimuat saat dibuka.
- Roster picker menggunakan snapshot jadwal harian tervalidasi; assignment ditahan jika roster belum tersedia.
- Helper-task disimpan di Postgres dan perubahan state dijalankan lewat RPC transaksional.

## V1 scope

- Route September 2026: `PKC - PAM`, `CSA - KLD`, `BSX`, `ASA - JBG`, `SMN - MRY`, dan `CPT - PPL`.
- Mode assignment `By route` atau lintas route `By zone`.
- Satu SO utuh hanya diberikan ke satu picker.
- SO multi-zone dikarantina sebagai `ZONE_CONFLICT`.
- CSV output: `error_message;so_id;staff_id`.
- Role: `DEVELOPER`, `STAGING_HELPER`, dan `LINE_HELPER`.

## Run locally

Requires Node.js `>=22.13.0`.

```powershell
npm install
$env:NEXT_PUBLIC_SUPABASE_URL='https://<project-ref>.supabase.co'
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='<publishable-key>'
npm run dev
```

Verification:

```powershell
npm run lint
npm test
npm run build
```

Static output berada di `out/` dan dapat diunggah ke Cloudflare Pages.

## Rollback

Folder `backend/` menyimpan backend Apps Script lama sebagai referensi rollback. Jangan mengaktifkan trigger lama bersamaan dengan cutover tanpa verifikasi duplicate writer/scheduler.
