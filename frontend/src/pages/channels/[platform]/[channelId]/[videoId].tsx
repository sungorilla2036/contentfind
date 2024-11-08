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
  const [endTime, setEndTime] = useState(""); // Added state for end time
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

    const duration = parseInt(endTime, 10) - parseInt(startTime, 10); // Calculated duration

    const payload = {
      platform: platform as string,
      channel_id: channelId as string,
      content_id: videoId as string,
      start_time: parseInt(startTime, 10),
      duration, // Use calculated duration
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
        setClips((prevClips) => [
          ...prevClips,
          {
            start_time: payload.start_time,
            duration: payload.duration,
            title: payload.title,
          },
        ]); // Add new clip to state
        // Reset form fields
        setStartTime("");
        setEndTime(""); // Reset end time
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
            <form
              onSubmit={handleCreateClip}
              className="bg-white p-3 border border-gray-200 rounded"
            >
              <h2 className="text-sm font-medium text-gray-700 mb-2">
                Create a Clip
              </h2>
              <div className="flex flex-col md:flex-row md:items-center md:space-x-4 space-y-2 md:space-y-0">
                <div className="grid grid-cols-2 gap-2 md:flex md:space-x-2">
                  <Input
                    type="number"
                    placeholder="Start (s)"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    required
                    className="w-24"
                  />
                  <Input
                    type="number"
                    placeholder="End (s)"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    required
                    className="w-24"
                  />
                </div>
                <Input
                  type="text"
                  placeholder="Clip Title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  className="flex-1"
                />
                <Button type="submit" className="md:w-auto">
                  Clip
                </Button>
              </div>
            </form>

            {/* Modal for Messages */}
            <Modal
              message={modalMessage}
              isOpen={isModalVisible}
              onClose={() => setIsModalVisible(false)}
            />

            <div className="space-y-6 mt-6">
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
                                .slice(11, 19) +
                                " - " +
                                new Date(
                                  (clip.start_time + clip.duration) * 1000
                                )
                                  .toISOString()
                                  .slice(11, 19)}
                            </span>
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
