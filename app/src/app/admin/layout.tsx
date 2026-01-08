export default function AdminLayout({ children }: { children: React.ReactNode }) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between mb-6">
            <div className="text-xl font-bold">Admin</div>
            <a
              href="/"
              className="text-sm text-gray-400 hover:text-white transition"
            >
              Back to site
            </a>
          </div>
          {children}
        </div>
      </div>
    );
  }