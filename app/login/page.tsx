"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { oworEmail, supabase } from "@/lib/supabase-browser";
import { normalizeGeneratedPasswordPaste } from "../bulk-account-core.mjs";

export default function LoginPage() {
  const router = useRouter();
  const [staffId, setStaffId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: oworEmail(staffId),
      password: normalizeGeneratedPasswordPaste(password),
    });
    setLoading(false);
    if (loginError) {
      setError("Staff ID atau password salah");
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(next || "/");
    router.refresh();
  }

  return (
    <main className="wms-login-shell">
      <section className="wms-login-brand">
        <div className="wms-mark">1W</div>
        <p>CBT · OUTBOUND CONTROL</p>
        <h1>ONE WAVE<br /><span>ONE ROUTE</span></h1>
        <div className="wms-login-status"><i /> Operational system · secure access</div>
      </section>
      <section className="wms-login-panel">
        <div className="wms-login-heading">
          <span>AUTHORIZED PERSONNEL ONLY</span>
          <h2>Masuk ke WMS workspace</h2>
          <p>Gunakan Staff ID dan password yang didaftarkan developer.</p>
        </div>
        <form onSubmit={submit}>
          <label><span>Staff ID</span><input autoComplete="username" value={staffId} onChange={(event) => setStaffId(event.target.value.toUpperCase())} placeholder="Contoh: 52016" /></label>
          <label><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Masukkan password" /></label>
          {error && <div className="wms-login-error" role="alert">{error}</div>}
          <button disabled={loading || !staffId || !password}>{loading ? "Memverifikasi…" : "Masuk ke workspace"}</button>
        </form>
        <footer><b>OWOR WMS</b><span>Session aman melalui Supabase Auth</span></footer>
      </section>
    </main>
  );
}
