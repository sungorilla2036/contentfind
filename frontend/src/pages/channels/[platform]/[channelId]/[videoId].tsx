import { useRouter } from "next/router";
import { useEffect, useState, useRef } from "react";
import Script from "next/script";
import MenuBar from "@/components/MenuBar";
import PlatformChannelForm from "@/components/PlatformChannelForm";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Twitch: any;
  }
}

export default function VideoPage() {
  const router = useRouter();
  const { platform, channelId, videoId } = router.query;

  const [transcript, setTranscript] = useState<[number, number, string][]>([]);
  const [embedUrl, setEmbedUrl] = useState<string>("");
  const bucketUrl = process.env.NEXT_PUBLIC_BUCKET_URL || "";
  const twitchEmbedRef = useRef<HTMLDivElement>(null);
  const embedInitialized = useRef(false);
  interface TwitchPlayer {
    seek: (time: number) => void;
  }

  const playerInstanceRef = useRef<TwitchPlayer | null>(null); // Add this line

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
        setEmbedUrl(`https://www.youtube.com/embed/${videoId}?enablejsapi=1`); // Modified line
      } else if (platform === "twitch") {
        setEmbedUrl(""); // Clear embedUrl since we'll use the Twitch Embed API

        const initializeTwitchEmbed = () => {
          if (
            twitchEmbedRef.current &&
            window.Twitch &&
            !embedInitialized.current
          ) {
            const embed = new window.Twitch.Embed(twitchEmbedRef.current, {
              width: "100%",
              height: "400",
              video: videoId,
              layout: "video",
              autoplay: false,
            });

            embed.addEventListener(window.Twitch.Embed.VIDEO_READY, () => {
              const player = embed.getPlayer(); // Add this line
              playerInstanceRef.current = player; // Add this line
            });

            embedInitialized.current = true;
          }
        };

        if (window.Twitch) {
          initializeTwitchEmbed();
        } else {
          // Wait for the script to load
          const checkTwitch = setInterval(() => {
            if (window.Twitch) {
              clearInterval(checkTwitch);
              initializeTwitchEmbed();
            }
          }, 50);
        }
      }
    }
  }, [platform, channelId, videoId, platformNum, bucketUrl]);

  const handleSeek = (time: number) => {
    if (platform === "youtube") {
      document
        .querySelector("iframe")
        ?.contentWindow?.postMessage(
          '{"event":"command","func":"seekTo","args":[' + time + "]}",
          "*"
        );
    } else if (platform === "twitch" && playerInstanceRef.current) {
      playerInstanceRef.current.seek(time);
    }
  };

  return (
    <div>
      <Script src="https://embed.twitch.tv/embed/v1.js" />
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
            ) : platform === "twitch" ? (
              <div ref={twitchEmbedRef} className="mb-6"></div>
            ) : (
              <div className="w-full h-64 bg-gray-200 rounded-md mb-6" />
            )}

            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-3">Transcript</h2>
                <div className="h-[600px] overflow-y-auto pr-4">
                  {transcript.map((line, index) => (
                    <div
                      key={index}
                      className="p-1 rounded hover:bg-gray-100 cursor-pointer transition-colors duration-200 group relative"
                      onClick={() => handleSeek(line[0])}
                      title={
                        new Date(line[0] * 1000).toISOString().slice(11, 19) +
                        "-" +
                        new Date((line[0] + line[1]) * 1000)
                          .toISOString()
                          .slice(11, 19)
                      }
                    >
                      <span className="text-gray-700">{line[2]}</span>
                      <span className="absolute right-2 top-2 text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        {new Date(line[0] * 1000).toISOString().slice(11, 19)}
                      </span>
                    </div>
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
