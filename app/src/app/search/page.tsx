import { redirect } from "next/navigation";

export default function SearchRedirectPage({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  const q = typeof searchParams?.q === "string" ? searchParams.q.trim() : "";
  const next = q ? `/explorer?q=${encodeURIComponent(q)}` : "/explorer";
  redirect(next);
}
