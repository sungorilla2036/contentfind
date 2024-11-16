import { useState } from "react";
import { useRouter } from "next/router";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

type PlatformChannelFormProps = {
  initialPlatform?: string;
  initialChannelId?: string;
};

export default function PlatformChannelForm({
  initialPlatform = "youtube",
  initialChannelId = "",
}: PlatformChannelFormProps) {
  const [platform, setPlatform] = useState(initialPlatform);
  const [channelId, setChannelId] = useState(initialChannelId);
  const router = useRouter();

  const parseChannelUrl = (input: string, defaultPlatform: string) => {
    try {
      const url = new URL(input);
      const hostname = url.hostname.replace("www.", "");
      let videoId = "";
      let channel = "";
      if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
        if (url.pathname === "/watch") {
          videoId = url.searchParams.get("v") || "";
        } else if (hostname === "youtu.be") {
          videoId = url.pathname.slice(1);
        } else {
          const pathParts = url.pathname
            .split("/")
            .filter((part) => part !== "");
          if (
            pathParts[0] === "channel" ||
            pathParts[0] === "c" ||
            pathParts[0] === "user"
          ) {
            channel = pathParts[1] || "";
          } else {
            channel = pathParts[0]?.replace("@", "") || "";
          }
        }
        return { platform: "youtube", channelId: channel, videoId };
      } else if (hostname.includes("twitch.tv")) {
        const pathParts = url.pathname.split("/").filter((part) => part !== "");
        if (pathParts[0] === "videos") {
          videoId = pathParts[1] || "";
        } else {
          channel = pathParts[0] || "";
        }
        return { platform: "twitch", channelId: channel, videoId };
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // Ignore error
    }
    return { platform: defaultPlatform, channelId: input, videoId: "" };
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const res = parseChannelUrl(channelId, platform);
    const newPlatform = res.platform;
    const newChannelId = res.channelId;
    const newVideoId = res.videoId;

    if (newVideoId && newPlatform) {
      router.push(`/videos/${newPlatform}/${newVideoId}`);
    } else if (newChannelId && newPlatform) {
      router.push(`/channels/${newPlatform}/${newChannelId}`);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault(); // Prevent default paste behavior
    const pasteData = e.clipboardData.getData("text");

    const res = parseChannelUrl(pasteData, platform);
    const newPlatform = res.platform;
    const newChannelId = res.channelId;
    const newVideoId = res.videoId;

    if (newPlatform) {
      setPlatform(newPlatform);
    }
    if (channelId) {
      setChannelId(newChannelId);
    }
    if (newVideoId && newPlatform) {
      router.push(`/videos/${newPlatform}/${newVideoId}`);
    } else if (newChannelId && newPlatform) {
      router.push(`/channels/${newPlatform}/${newChannelId}`);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center space-x-2">
        <Select value={platform} onValueChange={setPlatform}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="youtube">YouTube</SelectItem>
            <SelectItem value="twitch">Twitch</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="text"
          placeholder="channel id, channel url, or video url"
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          onPaste={handlePaste}
          className="flex-1"
        />
      </div>
    </form>
  );
}
