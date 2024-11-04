import { Card, CardContent } from "@/components/ui/card";
import PlatformChannelForm from "@/components/PlatformChannelForm";
import { useRouter } from "next/router";
import ChannelPage from "./channels/[platform]/[channelId]";
import VideoPage from "./channels/[platform]/[channelId]/[videoId]";

export default function Home() {
  const router = useRouter();
  const path = router.asPath.split("/").filter(Boolean);

  if (path[0] === "channels") {
    if (path.length === 3) {
      // Channel view: /channels/[platform]/[channelId]
      return <ChannelPage key={`${path[1]}-${path[2]}`} />;
    } else if (path.length === 4) {
      // Video view: /channels/[platform]/[channelId]/[videoId]
      return <VideoPage key={`${path[1]}-${path[2]}-${path[3]}`} />;
    }
  }

  // Default home view
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
