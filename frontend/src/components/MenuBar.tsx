import { useSession, useSupabaseClient } from "@supabase/auth-helpers-react";
import { Button } from "@/components/ui/button";
import { TwitchIcon } from "./Icons";
import { useRouter } from "next/router";
import Link from "next/link";

export default function MenuBar() {
  const session = useSession();
  const supabase = useSupabaseClient();
  const router = useRouter();

  const handleLogin = async () => {
    const currentPath = router.asPath;
    await supabase.auth.signInWithOAuth({
      provider: "twitch",
      options: { redirectTo: `${window.location.origin}${currentPath}` },
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="flex items-center justify-between py-4 px-8 bg-white shadow">
      <div className="text-2xl font-bold">
        <Link href="/">ContentFind</Link>
      </div>
      {session ? (
        <div>
          <span className="mr-2">{session.user.user_metadata["name"]}</span>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Logout
          </Button>
        </div>
      ) : (
        <Button
          variant="default"
          size="sm"
          onClick={handleLogin}
          className="bg-[#9146FF] hover:bg-[#7923ff] text-white flex items-center gap-2"
        >
          <TwitchIcon />
          <span>Login with Twitch</span>
        </Button>
      )}
    </div>
  );
}
