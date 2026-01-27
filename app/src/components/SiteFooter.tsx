import Link from "next/link";

const TERMS_URL = "https://funmarket.gitbook.io/funmarket/terms-of-use";
const PRIVACY_URL = "https://funmarket.gitbook.io/funmarket/privacy-policy";

export default function SiteFooter() {
  return (
    <footer className="border-t border-gray-900 mb-12 md:mb-10">
      {/* mb-12 = space for mobile ticker (above mobile nav) */}
      {/* md:mb-10 = space for desktop ticker */}
      <div className="max-w-7xl mx-auto px-4 py-5">
        <div className="flex items-center justify-between text-sm text-gray-300">
          {/* Left */}
          <div className="flex items-center gap-6">
            <a
              href={TERMS_URL}
              target="_blank"
              rel="noreferrer"
              className="hover:text-white"
            >
              Terms
            </a>
            <a
              href={PRIVACY_URL}
              target="_blank"
              rel="noreferrer"
              className="hover:text-white"
            >
              Privacy
            </a>
          </div>
  
          {/* Center */}
          <p className="hidden md:block text-xs text-gray-500 text-center flex-1 px-6">
            Trading involves substantial risk of loss. You may lose the full amount
            spent, including fees. Information is provided "as is".
          </p>
  
          {/* Right */}
          <div className="flex items-center gap-4">
            <a
              className="hover:text-white"
              href="https://x.com/TON_COMPTE"
              target="_blank"
              rel="noreferrer"
            >
              X
            </a>
            <a
              className="hover:text-white"
              href="https://discord.gg/TON_INVITE"
              target="_blank"
              rel="noreferrer"
            >
              Discord
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}