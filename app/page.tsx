import Link from "next/link";
import { LOGO_DATA_URL } from "../lib/logo";

export default function HomePage() {
  return (
    <main
      style={{
        display: "grid",
        minHeight: "100vh",
        placeItems: "center",
        padding: "32px",
        background: "#f4f7fb",
        color: "#152233",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <section style={{ maxWidth: 640, textAlign: "center" }}>
        <img
          src={LOGO_DATA_URL}
          alt="Via Encanto"
          style={{ width: 220, margin: "0 auto 28px", display: "block" }}
        />
        <p style={{ color: "#0a7594", fontWeight: 800, letterSpacing: "0.12em" }}>
          IMAGENS SEO-FRIENDLY
        </p>
        <h1 style={{ fontSize: "clamp(2rem, 7vw, 4rem)", letterSpacing: "-0.06em" }}>
          Gere URLs descritivas para as fotos dos seus produtos.
        </h1>
        <p style={{ color: "#5d7185", lineHeight: 1.7 }}>
          Este exemplo usa Next.js, Sharp e armazenamento compatível com S3 para
          gerar imagens otimizadas e prontas para publicação.
        </p>
        <Link
          href="/upload"
          style={{
            display: "inline-block",
            marginTop: 16,
            borderRadius: 12,
            background: "#0d809d",
            color: "white",
            padding: "13px 18px",
            fontWeight: 800,
            textDecoration: "none",
          }}
        >
          Abrir formulário de upload
        </Link>
      </section>
    </main>
  );
}
