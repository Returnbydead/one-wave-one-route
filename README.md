# ONE WAVE ONE ROUTE

V1 dashboard untuk membentuk assignment picker per route dan picking zone, lalu mengunduh CSV yang kompatibel dengan format Playmaker.

## V1 scope

- Route: `SWL - PSG`, `SMN - MRY`, `BSX`, `CPT - PPL`, `RDS - SLP`, dan `JLB` (10 hub)
- Mode assignment dapat dipilih `By route` atau lintas route `By zone`
- Menghitung kebutuhan picker per zone dengan `CEILING(request_qty / productivity_per_mp)`
- Memilih picker aktif sesuai zone dan kapasitas
- Membagi satu SO utuh ke satu picker dengan load balancing berbasis produktivitas
- Membaca zone dari token kedua `origin_rack_name` (`CBT-MZA1-...` -> `MZA1`) dan mengarantina SO multi-zone sebagai `ZONE_CONFLICT`
- Download per route atau seluruh route dengan header `error_message;so_id;staff_id`

UI membaca snapshot live lewat server route `/api/live`. Demo snapshot hanya dipakai sebagai fallback yang ditandai jelas jika backend belum siap atau sync gagal. Nilai productivity per zone masih draft sampai source final dikirim.

## Run locally

Requires Node.js `>=22.13.0`.

```powershell
npm install
npm run dev
```

Verification:

```powershell
npm run lint
npm test
```

## Production data flow

Raw Superset item rows tidak boleh dikirim langsung ke browser atau Google Sheets. Dataset upstream harus memfilter operational date, lima destination trial, status eligible, lalu mengagregasi menjadi snapshot candidate SO yang ramping.

```text
Superset dataset 400 (up to 1M item rows)
  -> filtered + aggregated query
  -> Google Sheet snapshot / small JSON endpoint
  -> ONE WAVE ONE ROUTE assignment engine
  -> CSV Playmaker
```

Candidate SO contract:

```json
{
  "operationalDate": "2026-08-12",
  "generatedAt": "2026-08-12T16:48:00+07:00",
  "orders": [
    {
      "soNumber": "INV/SO/20260812/301/6131021",
      "destination": "SWL",
      "route": "SWL - PSG",
      "zone": "MZE",
      "requestQty": 680,
      "skuCount": 42
    }
  ]
}
```

Picker roster contract:

```json
{
  "staffId": "52016",
  "name": "Muhammad Faris Gumay",
  "zone": "MZE",
  "productivity": 2400,
  "shift": "05:00-14:00",
  "scheduled": true
}
```

Keep the Superset session/cookie server-side. The browser should only receive the slim, already-filtered snapshot.

## Google Apps Script backend

Backend di `backend/Code.gs` dipasang sebagai file terpisah pada Apps Script yang terikat ke workbook route. Backend tersebut:

- menjalankan query agregat Superset setiap 5 menit;
- menulis `OWOR SO SNAPSHOT`, `OWOR SO CONFLICTS`, `OWOR PICKER SNAPSHOT`, dan `OWOR SYNC STATUS`;
- membaca picker terjadwal dari `Schedule Manpower 2025`;
- menyajikan compact JSON melalui Web App bertoken.

Production runtime membutuhkan dua server-only environment variables:

```text
OWOR_GAS_ENDPOINT=https://script.google.com/macros/s/.../exec
OWOR_GAS_TOKEN=<script-property-token>
```

Jika `OWOR SYNC STATUS` menunjukkan `SUPERSET_HTTP_401`, perbarui cookie Superset pada workbook cookie server-side. Tidak ada cookie Superset yang dikirim ke browser atau disimpan di repository.
