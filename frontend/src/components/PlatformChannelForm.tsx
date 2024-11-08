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

  const parseChannelUrl = (input: string) => {
    try {
      const url = new URL(input);
      const hostname = url.hostname.replace("www.", "");
      let platform = "";
      let channelId = "";

      if (hostname.includes("youtube.com")) {
        platform = "youtube";
        const pathParts = url.pathname.split("/").filter((part) => part !== "");
        channelId = pathParts[0]?.replace("@", "") || "";
      } else if (hostname.includes("twitch.tv")) {
        platform = "twitch";
        const pathParts = url.pathname.split("/").filter((part) => part !== "");
        channelId = pathParts[0] || "";
      }
      return { platform, channelId };
    } catch {
      return { platform: "", channelId: input };
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const res = parseChannelUrl(channelId);
    let newPlatform = res.platform;
    const newChannelId = res.channelId;
    if (newPlatform) {
      setPlatform(newPlatform);
    } else {
      newPlatform = platform;
    }
    if (channelId) {
      setChannelId(newChannelId);
    }
    if (newChannelId && newPlatform) {
      router.push(`/channels/${newPlatform}/${newChannelId}`);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault(); // Prevent default paste behavior
    const pasteData = e.clipboardData.getData("text");

    const res = parseChannelUrl(pasteData);
    const newPlatform = res.platform;
    const newChannelId = res.channelId;

    if (newPlatform) {
      setPlatform(newPlatform);
    }
    if (channelId) {
      setChannelId(newChannelId);
    }
    if (newChannelId && newPlatform) {
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
          placeholder="channel id or url"
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          onPaste={handlePaste}
          className="flex-1"
        />
      </div>
    </form>
  );
}
