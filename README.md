# ONE WAVE ONE ROUTE

V1 dashboard untuk membentuk assignment picker per route dan picking zone, lalu mengunduh CSV yang kompatibel dengan format Playmaker.

## V1 scope

- Trial route: `SWL - PSG`, `SMN - MRY`, dan `BSX`
- Menghitung kebutuhan picker per zone dengan `CEILING(request_qty / productivity_per_mp)`
- Memilih picker aktif sesuai zone dan kapasitas
- Membagi satu SO utuh ke satu picker dengan load balancing berbasis produktivitas
- Download per route atau seluruh route dengan header `error_message;so_id;staff_id`

UI saat ini memakai **Demo snapshot** agar flow bisa diuji tanpa menganggap koneksi Superset sudah live. Nilai productivity per zone juga masih draft sampai source final dikirim.

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
