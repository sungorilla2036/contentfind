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
      <h1 className="text-6xl font-bold text-center mb-8">ContentFind</h1>
      <Card className="max-w-xl w-full">
        <CardContent className="p-6">
          <PlatformChannelForm />
        </CardContent>
      </Card>
    </div>
  );
}
