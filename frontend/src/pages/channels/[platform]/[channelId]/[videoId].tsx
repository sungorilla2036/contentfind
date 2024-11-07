import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import MenuBar from "@/components/MenuBar";
import PlatformChannelForm from "@/components/PlatformChannelForm";

export default function VideoPage() {
  const router = useRouter();
  const { platform, channelId, videoId } = router.query;

  const [transcript, setTranscript] = useState<[number, number, string][]>([]);
  const [embedUrl, setEmbedUrl] = useState<string>("");
  const bucketUrl = process.env.NEXT_PUBLIC_BUCKET_URL || "";

  const platformIds: { [key: string]: number } = {
    youtube: 0,
    twitch: 1,
    // add other platforms here
  };
  const platformNum = platformIds[platform as string] || 0;

  useEffect(() => {
    if (platform && channelId && videoId) {
      fetch(
        `${bucketUrl}/${platformNum}/${channelId}/transcripts/${videoId}.json`
      )
        .then((response) => response.json())
        .then((data) => {
          setTranscript(data);
        })
        .catch(() => {
          setTranscript([[0, 0, "Transcript not available."]]);
        });

      // Set embed URL based on platform
      if (platform === "youtube") {
        setEmbedUrl(`https://www.youtube.com/embed/${videoId}`);
      } else if (platform === "twitch") {
        setEmbedUrl(
          `https://player.twitch.tv/?video=${videoId}&parent=yourdomain.com&autoplay=false`
        );
      }
    }
  }, [platform, channelId, videoId, platformNum, bucketUrl]);

  return (
    <div>
      <MenuBar />

      <div className="container mx-auto p-8">
        <div className="max-w-3xl mx-auto">
          <PlatformChannelForm
            initialPlatform={
              typeof platform === "string" ? platform : "youtube"
            }
            initialChannelId={typeof channelId === "string" ? channelId : ""}
          />
          <div className="p-6">
            {embedUrl ? (
              <div className="mb-6">
                <iframe
                  width="100%"
                  height="400"
                  src={embedUrl}
                  title="Video player"
                  frameBorder="0"
                  allowFullScreen
                ></iframe>
              </div>
            ) : (
              <div className="w-full h-64 bg-gray-200 rounded-md mb-6" />
            )}

            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-3">Transcript</h2>
                <div className="space-y-2">
                  {transcript.map((line, index) => (
                    <p key={index} className="text-gray-700">
                      {line[2]}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
