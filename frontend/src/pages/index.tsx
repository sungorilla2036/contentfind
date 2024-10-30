import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useRouter } from "next/router";

export default function Home() {
  const [channelId, setChannelId] = useState("");
  const [platform, setPlatform] = useState("youtube");
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (channelId && platform) {
      router.push(`/${platform}/${channelId}`);
    }
  };

  return (
    <div className="container mx-auto p-8">
      <Card className="max-w-xl mx-auto">
        <CardContent className="p-6">
          <h1 className="text-2xl font-bold mb-6">ContentFind</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center space-x-2">
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="youtube">YouTube</SelectItem>
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
            <Button type="submit" className="w-full">
              Search Channel
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
