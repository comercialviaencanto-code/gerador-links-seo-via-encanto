"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LOGO_DATA_URL } from "../../lib/logo";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? "Não foi possível entrar.");
        return;
      }

      const next = searchParams.get("next") || "/upload";
      router.replace(next);
      router.refresh();
    } catch {
      setError("Falha de comunicação com o servidor.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main
      style={{
        display: "grid",
        minHeight: "100vh",
        placeItems: "center",
        padding: "32px",
        background: "#f4f7fb",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "min(380px, 100%)",
          display: "grid",
          gap: 18,
          border: "1px solid rgba(193, 211, 224, 0.9)",
          borderRadius: 24,
          background: "#fff",
          boxShadow: "0 18px 50px rgba(35, 69, 95, 0.08)",
          padding: 32,
          textAlign: "center",
        }}
      >
        <img
          src={LOGO_DATA_URL}
          alt="Via Encanto"
          style={{ width: 180, margin: "0 auto 6px", display: "block" }}
        />
        <p style={{ margin: 0, color: "#5d7185", fontSize: "0.9rem" }}>
          Acesso ao gerador de imagens
        </p>
        <label style={{ display: "grid", gap: 8, textAlign: "left" }}>
          <span style={{ color: "#3c5367", fontSize: "0.79rem", fontWeight: 750 }}>
            Senha da equipe
          </span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            required
            style={{
              border: "1px solid #d4e1e9",
              borderRadius: 12,
              padding: "12px 13px",
              fontSize: "0.95rem",
            }}
          />
        </label>
        {error ? (
          <div
            style={{
              borderRadius: 12,
              padding: "12px 14px",
              fontSize: "0.84rem",
              border: "1px solid #f3c2b7",
              background: "#fff2ef",
              color: "#a54735",
            }}
          >
            {error}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            border: 0,
            borderRadius: 11,
            background: "#0d809d",
            color: "#fff",
            padding: "13px 18px",
            fontWeight: 800,
            fontSize: "0.9rem",
            cursor: isSubmitting ? "not-allowed" : "pointer",
            opacity: isSubmitting ? 0.6 : 1,
          }}
        >
          {isSubmitting ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
