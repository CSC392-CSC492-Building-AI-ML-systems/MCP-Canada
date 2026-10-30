import Link from "next/link";

export default function Home() {
  return (
    <main className="home-page">
      <p className="eyebrow">MCP CANADA · NEIGHBOURHOOD EXPLORER</p>
      <h1>Explore Toronto neighbourhoods</h1>
      <p className="intro">Explore housing and affordability.</p>
      <Link className="feature-link" href="/housing">
        Explore housing &amp; affordability <span aria-hidden="true">→</span>
      </Link>
    </main>
  );
}
