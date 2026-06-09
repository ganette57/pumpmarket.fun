import { redirect } from "next/navigation";

// The World Cup treasury is the same global Championship Treasury page.
// We keep this route so existing hub links don't break, but send users to
// the single canonical page rather than maintaining a duplicate.
export default function WorldCupTreasuryPage() {
  redirect("/treasury");
}
