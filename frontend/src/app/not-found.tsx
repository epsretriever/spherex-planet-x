import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container">
      <h1>We couldn&apos;t find that page</h1>
      <p className="muted">It may have moved, a bit like the asteroids.</p>
      <Link href="/explore/" className="button button-primary">
        Explore the sky
      </Link>
    </div>
  );
}
