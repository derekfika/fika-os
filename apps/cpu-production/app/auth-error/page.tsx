import AuthErrorActions from "./AuthErrorActions";

const hubUrl = "https://staging-os.fikacatering.com";

export default async function CpuAuthErrorPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const denied = (await searchParams).kind === "denied";
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "32px", background: "#f7f5fb", color: "#24115c", fontFamily: "Arial, sans-serif" }}>
      <section style={{ width: "min(100%, 560px)", padding: "40px", borderRadius: "20px", background: "#fff", boxShadow: "0 18px 50px rgb(36 17 92 / 12%)" }}>
        <p style={{ margin: 0, fontSize: "12px", fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase" }}>FIKA OS · CPU Production</p>
        <h1 style={{ margin: "16px 0 12px", fontSize: "32px" }}>{denied ? "You don't have access to CPU Production." : "We couldn't verify your access right now."}</h1>
        <p style={{ color: "#5f5870", lineHeight: 1.6 }}>
          {denied
            ? "Your FIKA OS account is signed in, but it has not been granted access to this application."
            : "FIKA OS authentication is temporarily unavailable. Your session may still be valid — this does not necessarily mean you need to sign in again."}
        </p>
        {!denied && <small style={{ display: "block", margin: "18px 0", color: "#756d83" }}>Authentication service unavailable · HTTP 503</small>}
        <AuthErrorActions denied={denied} hubUrl={hubUrl} />
      </section>
    </main>
  );
}
