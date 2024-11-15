import { useEffect } from "react"; // Add this import
import { Card, CardContent } from "@/components/ui/card";
import PlatformChannelForm from "@/components/PlatformChannelForm";
import { useRouter } from "next/router";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const path = window.location.pathname.split("/").filter(Boolean);
    if (path[0] === "channels") {
      if (path.length === 3) {
        router.push(`/channels/${path[1]}/${path[2]}`);
      } else if (path.length === 4) {
        router.push(`/channels/${path[1]}/${path[2]}/${path[3]}`);
      }
    }
  }, [router]);

  // Default home view remains unchanged
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <h1 className="text-6xl font-black text-center mb-6 text-slate-700 hover:text-slate-600 transition-colors">
        ContentFind
      </h1>
      <h2 className="text-xl font-medium text-center text-slate-500 max-w-2xl mx-auto">
        Transcribe, search, and highlight content from your favorite creators
      </h2>
      <Card className="max-w-xl w-full mt-2">
        <CardContent className="p-6">
          <PlatformChannelForm />
        </CardContent>
      </Card>
    </div>
  );
}
