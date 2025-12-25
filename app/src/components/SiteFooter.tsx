import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="mt-16 py-10 border-t border-gray-900">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between text-sm text-gray-400">
        <div className="flex items-center gap-8">
          <Link href="/terms" className="hover:text-white">Terms & Privacy</Link>
          <Link href="/developers" className="hover:text-white">Developers</Link>
          <Link href="/blog" className="hover:text-white">Blog</Link>
        </div>

        <div className="flex items-center gap-4">
          <a className="hover:text-white" href="https://x.com/TON_COMPTE" target="_blank" rel="noreferrer">X</a>
          <a className="hover:text-white" href="https://discord.gg/TON_INVITE" target="_blank" rel="noreferrer">Discord</a>
        </div>
      </div>
    </footer>
  );
}