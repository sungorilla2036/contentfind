import { useRouter } from "next/router";
import { useEffect, useState, useRef } from "react";
import Script from "next/script";
import MenuBar from "@/components/MenuBar";
import PlatformChannelForm from "@/components/PlatformChannelForm";
import { useSession } from "@supabase/auth-helpers-react"; // Added import
import Modal from "@/components/Modal"; // Added import
import { Input } from "@/components/ui/input"; // Added import
import { Button } from "@/components/ui/button"; // Ensure Button is imported
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Twitch: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onYouTubeIframeAPIReady: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    YT: any;
  }
}

export default function VideoPage() {
  const router = useRouter();
  const { platform, channelId, videoId } = router.query;

  const [transcript, setTranscript] = useState<[number, number, string][]>([]);
  const bucketUrl = process.env.NEXT_PUBLIC_BUCKET_URL || "";
  const twitchEmbedRef = useRef<HTMLDivElement>(null);
  const embedInitialized = useRef(false);
  interface TwitchPlayer {
    seek: (time: number) => void;
    getCurrentTime: () => number;
  }

  const playerInstanceRef = useRef<TwitchPlayer | null>(null); // Add this line
  const youtubePlayerRef = useRef<HTMLDivElement>(null); // Add this line
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const youtubePlayerInstanceRef = useRef<any>(null); // Add this line

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
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null); // Added state for copied index
  const [selectedInput, setSelectedInput] = useState<"start" | "end">("start"); // Added state

  useEffect(() => {
    if (platform && channelId && videoId) {
      // Set embed URL based on platform
      if (platform === "youtube") {
        const onYouTubeIframeAPIReady = () => {
          if (youtubePlayerRef.current && !youtubePlayerInstanceRef.current) {
            youtubePlayerInstanceRef.current = new window.YT.Player(
              youtubePlayerRef.current,
              {
                height: "400",
                width: "100%",
                videoId: videoId as string,
                playerVars: {
                  playsinline: 1,
                },
              }
            );
          }
        };

        window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady; // Assign the function
      } else if (platform === "twitch") {
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

      const loadTranscript = async () => {
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
      };
      loadTranscript();

      // Fetch clips
      const loadClips = async () => {
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
      };
      loadClips();
    }
  }, [platform, channelId, videoId, platformNum, bucketUrl]);

  useEffect(() => {
    const updateTime = () => {
      let currentTime = 0;
      if (platform === "youtube" && youtubePlayerInstanceRef.current) {
        if (youtubePlayerInstanceRef.current.getCurrentTime) {
          currentTime = youtubePlayerInstanceRef.current.getCurrentTime();
        }
      } else if (platform === "twitch" && playerInstanceRef.current) {
        currentTime = playerInstanceRef.current.getCurrentTime();
      }
      if (selectedInput === "start") {
        setStartTime(Math.floor(currentTime).toString());
      } else if (selectedInput === "end") {
        setEndTime(Math.floor(currentTime).toString());
      }
    };

    const interval = setInterval(updateTime, 1000); // Update every second
    return () => clearInterval(interval);
  }, [platform, selectedInput]);

  const handleSeek = (startTime: number, duration: number) => {
    // Modified parameters
    if (platform === "youtube" && youtubePlayerInstanceRef.current) {
      youtubePlayerInstanceRef.current.seekTo(startTime, true);
    } else if (platform === "twitch" && playerInstanceRef.current) {
      playerInstanceRef.current.seek(startTime);
    }
    if (selectedInput === "start") {
      setStartTime(Math.floor(startTime).toString());
    } else if (selectedInput === "end") {
      setEndTime(Math.ceil(startTime + duration).toString()); // Set end time using start + duration
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

  const formatTime = (seconds: number): string => {
    const date = new Date(seconds * 1000);
    const hh = date.getUTCHours();
    const mm = date.getUTCMinutes();
    const ss = date.getUTCSeconds();
    return hh > 0
      ? `${hh}:${mm.toString().padStart(2, "0")}:${ss
          .toString()
          .padStart(2, "0")}`
      : `${mm}:${ss.toString().padStart(2, "0")}`;
  };

  const handleCopyCommand = (
    clip: {
      start_time: number;
      duration: number;
      title: string;
    },
    index: number
  ) => {
    // Modified to accept index
    const videoUrl =
      platform === "youtube"
        ? `https://www.youtube.com/watch?v=${videoId}`
        : `https://www.twitch.tv/videos/${videoId}`;
    const start = formatTime(clip.start_time);
    const end = formatTime(clip.start_time + clip.duration);
    const output = `'${clip.title
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase()}.mp4'`; // Example output filename
    const command = `yt-dlp '${videoUrl}' --download-sections "*${start}-${end}" --force-keyframes-at-cuts -o ${output} -S "vcodec:h264,res,acodec:m4a" --recode mp4`;
    navigator.clipboard.writeText(command);

    setCopiedIndex(index); // Set copied index
    setTimeout(() => setCopiedIndex(null), 1000); // Reset after 1 seconds
  };

  return (
    <div>
      <Script src="https://embed.twitch.tv/embed/v1.js" />
      <Script
        src="https://www.youtube.com/iframe_api"
        strategy="afterInteractive"
        onReady={() => {
          if (platform === "youtube") {
            const currentInterval = setInterval(() => {
              if (window.YT.Player) {
                window.onYouTubeIframeAPIReady();
              }
              clearInterval(currentInterval);
            }, 100);
          }
        }}
      />
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
            {platform === "youtube" ? (
              <div className="mb-6">
                <div ref={youtubePlayerRef}></div>{" "}
                {/* Replace iframe with div */}
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
                    onFocus={() => setSelectedInput("start")} // Added onFocus
                    required
                    className="w-24"
                  />
                  <Input
                    type="number"
                    placeholder="End (s)"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    onFocus={() => setSelectedInput("end")} // Added onFocus
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
                      onClick={() => handleSeek(line[0], line[1])} // Pass start time and duration
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
                        onClick={() =>
                          handleSeek(clip.start_time, clip.duration)
                        }
                      >
                        <h3 className="text-lg font-semibold text-gray-800 mb-2 line-clamp-1">
                          {clip.title}
                        </h3>
                        <div className="flex justify-between items-center space-x-4 text-sm text-gray-600">
                          <div className="flex  items-center">
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
                          <TooltipProvider>
                            <Tooltip
                              open={copiedIndex === index} // Check if index matches
                            >
                              <TooltipTrigger asChild>
                                <Button
                                  onClick={() => handleCopyCommand(clip, index)} // Pass index
                                  className="ml-2 flex items-center gap-1"
                                >
                                  <svg
                                    className="w-4 h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth="2"
                                      d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                                    />
                                  </svg>
                                  yt-dlp download command
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Copied!</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
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
