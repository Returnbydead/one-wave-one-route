# OWOR account setup

OWOR memakai Supabase Auth. Staff login dengan Staff ID, sedangkan email sintetis internal (`<staff-id>@owor.local`) tidak ditampilkan ke user.

## Membuat akun

1. Login sebagai role `DEVELOPER`.
2. Buka menu **Developer**.
3. Isi Staff ID, nama, role, dan password awal minimal 8 karakter.
4. Klik **Create account**.
5. Berikan password awal melalui kanal internal dan minta user menggantinya sesuai kebijakan tim.

Password tidak disimpan di repository, browser bundle, atau tabel profile. Supabase Auth menyimpan credential; tabel `owor_user_profiles` hanya menyimpan Staff ID, nama, role, dan status aktif.

## Role

- `DEVELOPER`: Assignment, Manpower, Picking Monitor, Helper Task, dan Developer.
- `STAGING_HELPER`: Helper Task untuk SO ke staging picking.
- `LINE_HELPER`: Helper Task untuk staging picking ke checker line.

Enable/disable akun dilakukan dari menu Developer dan tetap diaudit melalui profile update timestamp.
