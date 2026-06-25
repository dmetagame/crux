import { redirect } from "next/navigation";

// The demo is the autonomous paying agent. Send the root there.
// (Circle's reference seller dashboard remains at /dashboard for authed users.)
export default function Home() {
  redirect("/agent");
}
