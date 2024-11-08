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

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (channelId && platform) {
      router.push(`/channels/${platform}/${channelId}`);
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
          placeholder="channel id/url"
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          className="flex-1"
        />
      </div>
    </form>
  );
}
