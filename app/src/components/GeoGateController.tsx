"use client";

import { useEffect, useState } from "react";
import GeoGateModal, { hasAcceptedGeoGate } from "@/components/GeoGateModal";

export default function GeoGateController() {
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState<string | null>(null);

  useEffect(() => {
    if (hasAcceptedGeoGate()) return;

    // ✅ ton système actuel qui marche déjà:
    // remplace juste cette partie par TON fetch existant (ip country)
    (async () => {
      try {
        const res = await fetch("/api/geo", { cache: "no-store" });
        const j = await res.json();
        setCountry(j?.country || null);
      } catch {
        setCountry(null);
      } finally {
        setOpen(true);
      }
    })();
  }, []);

  return (
    <GeoGateModal
      open={open}
      countryCode={country}
      onAccept={() => setOpen(false)}
    />
  );
}