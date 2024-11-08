import { useRouter } from "next/router";
import { useEffect, useState, useRef } from "react";
import Script from "next/script";
import MenuBar from "@/components/MenuBar";
import PlatformChannelForm from "@/components/PlatformChannelForm";
import { useSession } from "@supabase/auth-helpers-react"; // Added import
import Modal from "@/components/Modal"; // Added import
import { Input } from "@/components/ui/input"; // Added import
import { Button } from "@/components/ui/button"; // Ensure Button is imported

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

  const session = useSession(); // Added session hook
  const [modalMessage, setModalMessage] = useState(""); // Added state for modal
  const [isModalVisible, setIsModalVisible] = useState(false); // Added state for modal visibility
  const [startTime, setStartTime] = useState(""); // Added state for start time
  const [duration, setDuration] = useState(""); // Added state for duration
  const [title, setTitle] = useState(""); // Added state for title
  const [clips, setClips] = useState<
    { start_time: number; duration: number; title: string }[]
  >([]); // Added state for clips

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

      // Fetch clips
      fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/videos/${videoId}/clips?platform=${platform}&channel_id=${channelId}`
      ) // Modified line
        .then((response) => response.json())
        .then((data) => {
          setClips(data);
        })
        .catch(() => {
          setClips([]);
        });
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

  const handleCreateClip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) {
      setModalMessage("Please log in to create a clip.");
      setIsModalVisible(true);
      return;
    }

    const payload = {
      platform: platform as string,
      channel_id: channelId as string,
      content_id: videoId as string,
      start_time: parseInt(startTime, 10),
      duration: parseInt(duration, 10),
      title,
    };

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/clips`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`, // Adjust based on your auth setup
          },
          body: JSON.stringify(payload),
        }
      );

      if (response.ok) {
        setModalMessage("Clip created successfully!");
        setIsModalVisible(true);
        // Reset form fields
        setStartTime("");
        setDuration("");
        setTitle("");
      } else {
        const errorData = await response.text();
        setModalMessage(`Error creating clip: ${errorData}`);
        setIsModalVisible(true);
      }
    } catch (error) {
      console.error("Error creating clip:", error);
      setModalMessage("An unexpected error occurred.");
      setIsModalVisible(true);
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

            {/* Clip Maker Form */}
            <form onSubmit={handleCreateClip} className="mb-6">
              <h2 className="text-xl font-semibold mb-3">Create a Clip</h2>
              <div className="space-y-4">
                <Input
                  type="number"
                  placeholder="Start Time (seconds)"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
                <Input
                  type="number"
                  placeholder="Duration (seconds)"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  required
                />
                <Input
                  type="text"
                  placeholder="Title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
                <Button type="submit">Create Clip</Button>
              </div>
            </form>

            {/* Modal for Messages */}
            <Modal
              message={modalMessage}
              isOpen={isModalVisible}
              onClose={() => setIsModalVisible(false)}
            />

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

              <div>
                <h2 className="text-xl font-semibold mb-3">Clips</h2>
                <div className="h-[300px] overflow-y-auto pr-4 space-y-4">
                  {clips.length > 0 ? (
                    clips.map((clip, index) => (
                      <div
                        key={index}
                        className="p-4 rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-md 
                                  cursor-pointer transition-all duration-200 bg-white"
                        onClick={() => handleSeek(clip.start_time)}
                      >
                        <h3 className="text-lg font-semibold text-gray-800 mb-2 line-clamp-1">
                          {clip.title}
                        </h3>
                        <div className="flex items-center space-x-4 text-sm text-gray-600">
                          <div className="flex items-center">
                            <svg
                              className="w-4 h-4 mr-1"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                            <span>
                              {new Date(clip.start_time * 1000)
                                .toISOString()
                                .substr(11, 8)}
                            </span>
                          </div>
                          <div className="flex items-center">
                            <svg
                              className="w-4 h-4 mr-1"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
                              />
                            </svg>
                            <span>{clip.duration}s</span>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-gray-500 text-center py-8">
                      No clips available.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
