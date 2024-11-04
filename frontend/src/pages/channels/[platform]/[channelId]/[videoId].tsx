import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import MenuBar from "@/components/MenuBar";
import PlatformChannelForm from "@/components/PlatformChannelForm"; // Added import
import srtParser2 from "srt-parser-2"; // Added import

export default function VideoPage() {
  const router = useRouter();
  const { platform, channelId, videoId } = router.query;

  const [transcript, setTranscript] = useState<
    { start: number; text: string }[]
  >([]);
  const [youtubeEmbedUrl, setYoutubeEmbedUrl] = useState<string>("");
  const bucketUrl = process.env.NEXT_PUBLIC_BUCKET_URL || "";

  const platformIds: { [key: string]: number } = {
    youtube: 0,
    // add other platforms here
  };
  const platformNum = platformIds[platform as string] || 0;

  useEffect(() => {
    if (platform && channelId && videoId) {
      fetch(
        `${bucketUrl}/${platformNum}/${channelId}/transcripts/${videoId}.srt`
      )
        .then((response) => response.text())
        .then((data) => {
          const parser = new srtParser2();
          const parsed = parser.fromSrt(data);
          const lines = parsed.map((item) => ({
            start: item.startSeconds,
            text: item.text,
          }));
          setTranscript(lines);
        })
        .catch(() => {
          setTranscript([{ start: 0, text: "Transcript not available." }]);
        });

      // If platform is YouTube, set embed URL
      if (platform === "youtube") {
        setYoutubeEmbedUrl(`https://www.youtube.com/embed/${videoId}`);
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
            {youtubeEmbedUrl ? (
              <div className="mb-6">
                <iframe
                  width="100%"
                  height="400"
                  src={youtubeEmbedUrl}
                  title="YouTube video player"
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
                      {line.text}
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
