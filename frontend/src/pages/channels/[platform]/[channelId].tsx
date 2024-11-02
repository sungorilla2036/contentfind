/* eslint-disable @next/next/no-img-element */
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import PlatformChannelForm from "@/components/PlatformChannelForm";
import MenuBar from "@/components/MenuBar";
import { useSession } from "@supabase/auth-helpers-react";

type Video = {
  id: string;
  title: string;
  date: number;
  transcriptAvailable: boolean;
};

export default function ChannelPage() {
  const router = useRouter();
  const session = useSession();
  const { platform, channelId } = router.query;
  const [search, setSearch] = useState("");
  const [isIndexed, setIsIndexed] = useState(false);
  const [videos, setVideos] = useState<Video[]>([]);
  const [lastUpdatedDate, setLastUpdatedDate] = useState<Date | null>(null);
  const platformStr = typeof platform === "string" ? platform : "";
  const channelIdStr = typeof channelId === "string" ? channelId : "";
  const apiUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL || "";

  const handleVideoClick = (videoId: string): void => {
    router.push(`channels/${platform}/${channelId}/${videoId}`);
  };

  const formatDate = (daysSinceEpoch: number): string => {
    const millisecondsSinceEpoch = daysSinceEpoch * 24 * 60 * 60 * 1000;
    const date = new Date(millisecondsSinceEpoch);
    return date.toLocaleDateString();
  };

  useEffect(() => {
    if (platform && channelId) {
      const bucketUrl = process.env.NEXT_PUBLIC_BUCKET_URL || "";
      const url = `${bucketUrl}/${platform}/${channelId}/index.json`;
      fetch(url)
        .then((response) => response.json())
        .then((data) => {
          setIsIndexed(true);
          const channelLastUpdated = data[0];
          const videosData = data[1];
          const date = new Date(channelLastUpdated * 24 * 60 * 60 * 1000);
          setLastUpdatedDate(date);
          const videosList = videosData.map(
            (videoData: [string, string, number, number?]) => {
              const [id, title, dateNumber, transcriptFlag] = videoData;
              return {
                id,
                title,
                date: dateNumber,
                transcriptAvailable: transcriptFlag !== 0,
              } as Video;
            }
          );
          setVideos(videosList);
        })
        .catch(() => {
          setIsIndexed(false);
          setVideos([]);
        });
    }
  }, [platform, channelId]);

  const handleReindex = async () => {
    if (!session) {
      alert("Please log in to perform this action.");
      return;
    }
    const accessToken = session.access_token;
    try {
      const res = await fetch(`${apiUrl}/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          platform_id: platformStr,
          channel_id: channelIdStr,
        }),
      });

      if (res.ok) {
        alert("Indexing job created successfully.");
        setIsIndexed(true);
      } else {
        const errorText = await res.text();
        alert(`Error creating indexing job: ${errorText}`);
      }
    } catch (error) {
      console.error("Error creating indexing job:", error);
      alert("An error occurred while creating the job.");
    }
  };

  const handleTranscribe = async (contentId: string) => {
    if (!session) {
      alert("Please log in to perform this action.");
      return;
    }
    const accessToken = session.access_token;
    try {
      const response = await fetch(`${apiUrl}/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          platform_id: platformStr,
          channel_id: channelIdStr,
          content_id: contentId,
        }),
      });
      if (response.ok) {
        alert("Transcription job created successfully.");
      } else {
        const errorText = await response.text();
        alert(`Error creating transcription job: ${errorText}`);
      }
    } catch (error) {
      console.error("Error creating transcription job:", error);
      alert("An error occurred while creating the job.");
    }
  };

  return (
    <div>
      <MenuBar />
      <div className="container mx-auto p-8">
        <Card className="max-w-2xl mx-auto">
          <CardContent className="p-6">
            <PlatformChannelForm
              initialPlatform={
                typeof platform === "string" ? platform : "youtube"
              }
              initialChannelId={typeof channelId === "string" ? channelId : ""}
            />
            <div className="space-y-4 mt-2">
              <Input
                type="text"
                placeholder="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              {lastUpdatedDate && (
                <div className="flex items-center mt-2">
                  <p className="text-sm text-gray-500">
                    Last Updated: {lastUpdatedDate.toLocaleDateString()}
                  </p>
                  {lastUpdatedDate &&
                    Date.now() - lastUpdatedDate.getTime() >
                      7 * 24 * 60 * 60 * 1000 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto"
                        onClick={handleReindex}
                      >
                        Re-index
                      </Button>
                    )}
                </div>
              )}

              {isIndexed ? (
                <div className="space-y-4">
                  {videos.map((video) => (
                    <div
                      key={video.id}
                      className="border rounded-md p-4 cursor-pointer hover:bg-gray-50"
                      onClick={() => handleVideoClick(video.id)}
                    >
                      <img
                        src={
                          platformStr === "youtube"
                            ? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`
                            : ""
                        }
                        alt={video.title}
                        className="w-full h-32 object-cover rounded-md mb-2"
                      />
                      <h3 className="font-medium">{video.title}</h3>
                      <p className="text-gray-500 text-sm">
                        {formatDate(video.date)}
                      </p>
                      {!video.transcriptAvailable && (
                        <div className="mt-2 flex justify-between items-center">
                          <span className="text-sm text-gray-500">
                            Transcript Unavailable
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTranscribe(video.id);
                            }}
                          >
                            Transcribe
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="mb-4">Channel not indexed</p>
                  <Button onClick={handleReindex}>Index</Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
