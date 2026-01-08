import Link from "next/link";

export default function AdminPage() {
  return (
    <div className="card-pump">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Overview</h1>
          <p className="text-sm text-gray-400 mt-1">All KPIs + disputes access.</p>
        </div>
        <Link
          href="/admin/overview"
          className="px-4 py-2 rounded-lg bg-pump-green text-black font-semibold hover:opacity-90 transition"
        >
          Open dashboard
        </Link>
      </div>
    </div>
  );
}