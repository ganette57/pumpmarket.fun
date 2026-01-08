export default function LivePage() {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-xl font-semibold mb-2">Live</h1>
        <p className="text-gray-400">
          Streaming mode (V2). coming soon.
        </p>
  
        <div className="mt-6 rounded-2xl border border-gray-800 bg-black/40 p-6">
          <div className="text-gray-200 font-medium">What will be here?</div>
          <ul className="text-gray-500 text-sm mt-2 space-y-1 list-disc list-inside">
            <li>Live market creation</li>
            <li>Live resolution proofs</li>
            <li>Streamer overlays + crowd trades</li>
          </ul>
        </div>
      </div>
    );
  }