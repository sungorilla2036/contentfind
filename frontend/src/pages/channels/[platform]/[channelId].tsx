/* eslint-disable @next/next/no-img-element */
import { useState, useEffect, useRef, useCallback } from "react"; // Added useRef
import Modal from "@/components/Modal"; // Import the Modal component

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pagefind: any;
  }
}
import { useRouter } from "next/router";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import PlatformChannelForm from "@/components/PlatformChannelForm";
import MenuBar from "@/components/MenuBar";
import { useSession } from "@supabase/auth-helpers-react";
import Script from "next/script";

export type HelixVideoViewableStatus = "public" | "private";
export type HelixVideoType = "upload" | "archive" | "highlight";
/**
 * Data about a muted segment in a video.
 */
export interface HelixVideoMutedSegmentData {
  /**
   * The start of the muted segment, in seconds from the start.
   */
  offset: number;
  /**
   * The duration of the muted segment, in seconds.
   */
  duration: number;
}
/** @private */
export interface HelixVideoData {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  title: string;
  description: string;
  created_at: string;
  published_at: string;
  url: string;
  thumbnail_url: string;
  viewable: HelixVideoViewableStatus;
  view_count: number;
  language: string;
  type: HelixVideoType;
  duration: string;
  stream_id: string | null;
  muted_segments: HelixVideoMutedSegmentData[] | null;
}
export type HelixVideoFilterPeriod = "all" | "day" | "week" | "month";
export type HelixVideoSort = "time" | "trending" | "views";

// Update the Video type if necessary
type Video = {
  id: string;
  title: string;
  date: number;
  transcriptAvailable: boolean;
  excerpt?: string; // Added excerpt for search results
  thumbnail_url?: string; // Add thumbnail_url property
};

type SearchResult = {
  score: number;
  data: () => Promise<SearchResultData>;
};

type SearchResultData = {
  url: string;
  excerpt: string;
};

type SearchResultsFull = {
  results: SearchResult[];
};

export default function ChannelPage() {
  const router = useRouter();
  const session = useSession();
  const { platform, channelId } = router.query;
  const [search, setSearch] = useState("");
  const [isIndexed, setIsIndexed] = useState(false);
  const [videos, setVideos] = useState<Video[]>([]);
  const [lastUpdatedDate, setLastUpdatedDate] = useState<Date | null>(null);
  const [fullSearchResults, setFullSearchResults] = useState<SearchResult[]>(
    []
  ); // Added to store all search results
  const [searchResults, setSearchResults] = useState<Video[]>([]); // Visible search results
  const [visibleCount, setVisibleCount] = useState(5); // Initialize visibility count
  const [pagefindInitialized, setPagefindInitialized] = useState(false);
  const [twitchPaginationCursor, setTwitchPaginationCursor] = useState<
    string | null
  >(null);
  const [twitchBroadcasterId, setTwitchBroadcasterId] = useState<string | null>(
    null
  );
  const apiUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL || "";
  const bucketUrl = process.env.NEXT_PUBLIC_BUCKET_URL || "";

  const platformIds: { [key: string]: number } = {
    youtube: 0,
    twitch: 1, // Add Twitch platform ID
    // add other platforms here
  };
  const platformNum = platformIds[platform as string] || 0;

  const handleVideoClick = (videoId: string): void => {
    router.push(`/channels/${platform}/${channelId}/${videoId}`);
  };

  const formatDate = (daysSinceEpoch: number): string => {
    const millisecondsSinceEpoch = daysSinceEpoch * 24 * 60 * 60 * 1000;
    const date = new Date(millisecondsSinceEpoch);
    return date.toLocaleDateString();
  };

  const [isLoading, setIsLoading] = useState(false);
  const [needsLoadTwitch, setNeedsLoadTwitch] = useState(false);

  const fetchTwitchVideos = useCallback(
    async (isFirstLoad: boolean = false, cursor?: string) => {
      if (isLoading) return;

      // Stop if we've reached the end
      if (!cursor && videos.length > 0) {
        return;
      }
      setIsLoading(true);
      try {
        const accessToken =
          session?.provider_token || localStorage.getItem("provider_token");
        if (!accessToken || session?.user.app_metadata.provider !== "twitch") {
          return;
        }
        // Get broadcaster ID
        let broadcasterId = twitchBroadcasterId;
        if (!broadcasterId) {
          await fetch(`https://api.twitch.tv/helix/users?login=${channelId}`, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Client-Id": process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID || "",
            },
          })
            .then((res) => res.json())
            .then((data) => {
              if (data.data && data.data.length > 0) {
                broadcasterId = data.data[0].id;
                setTwitchBroadcasterId(broadcasterId);
              } else if (
                data.status === 401 &&
                data.message === "Invalid OAuth token"
              ) {
                localStorage.removeItem("provider_token");
                setModalMessage("Please log in again.");
                setIsModalVisible(true);
              } else {
                setModalMessage("Broadcaster not found.");
                setIsModalVisible(true);
              }
            })
            .catch((error) => {
              console.error(error);
            });
        }
        let videosList: Video[] = [];
        if (broadcasterId) {
          // Get videos of type 'archive'
          const videosResponse = await fetch(
            `https://api.twitch.tv/helix/videos?user_id=${broadcasterId}&type=archive${
              cursor ? `&after=${cursor}` : ""
            }`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Client-Id": process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID || "",
              },
            }
          );
          const videosData = await videosResponse.json();
          const newCursor = videosData.pagination?.cursor || null;
          setTwitchPaginationCursor(newCursor);
          videosList = videosData.data.map((video: HelixVideoData) => ({
            id: video.id,
            title: video.title,
            date: new Date(video.created_at).getTime() / (24 * 60 * 60 * 1000),
            transcriptAvailable: false,
            thumbnail_url: video.thumbnail_url
              .replace("%{width}", "320")
              .replace("%{height}", "180"),
          }));
        }

        if (isFirstLoad) {
          setVideos([...videosList]);
        } else {
          setVideos((prevVideos) => [...prevVideos, ...videosList]);
        }
      } catch (error) {
        console.error("Error fetching Twitch videos:", error);
        setModalMessage("Error fetching Twitch videos.");
        setIsModalVisible(true);
      } finally {
        setIsLoading(false);
      }
    },
    [
      isLoading,
      videos.length,
      session?.provider_token,
      session?.user.app_metadata.provider,
      twitchBroadcasterId,
      channelId,
    ]
  );

  useEffect(() => {
    if (needsLoadTwitch) {
      fetchTwitchVideos(true);
      setNeedsLoadTwitch(false);
    }
  }, [fetchTwitchVideos, needsLoadTwitch]);

  useEffect(() => {
    if (channelId) {
      setIsIndexed(false);
      setLastUpdatedDate(null);
      setVideos([]);
      setSearch("");
      setSearchResults([]);
      setFullSearchResults([]);
      setVisibleCount(5);
      if (platform === "twitch") {
        setNeedsLoadTwitch(true);
      } else {
        const url = `${bucketUrl}/0/${channelId
          .toString()
          .toLowerCase()}/index.json`;
        fetch(url)
          .then((response) => response.json())
          .then((data) => {
            setIsIndexed(true);
            const channelLastUpdated = data[0];
            const videosData = data[1];
            const date = new Date(channelLastUpdated * 24 * 60 * 60 * 1000);
            setLastUpdatedDate(date);
            const videosList = videosData.map(
              (videoData: [string, string, number, string, number?]) => {
                const [id, title, dateNumber, language, transcriptFlag] =
                  videoData;
                return {
                  id,
                  title,
                  date: dateNumber,
                  language: language,
                  transcriptAvailable: transcriptFlag !== 0,
                } as Video;
              }
            );
            setVideos(videosList);
          })
          .catch(() => {
            setVideos([]);
          });
      }
    }
  }, [channelId, platform, bucketUrl]);

  // Cache provider_token to localStorage
  useEffect(() => {
    if (session?.provider_token) {
      localStorage.setItem("provider_token", session.provider_token);
    }
  }, [session?.provider_token]);

  // Modify performSearch to load initial batch
  useEffect(() => {
    const performSearch = async () => {
      if (search) {
        if (
          typeof window !== "undefined" &&
          window.pagefind?.options &&
          !pagefindInitialized
        ) {
          await window.pagefind.options({
            baseUrl: window.location.href,
            basePath: `${bucketUrl}/${platformNum}/${channelId
              ?.toString()
              .toLowerCase()}/pagefind`,
          });
          window.pagefind.init();
          setPagefindInitialized(true);
        }

        if (window.pagefind) {
          const searchResultsFull = await window.pagefind.debouncedSearch(
            search
          );
          if (searchResultsFull) {
            // Store search result references without loading all data
            const results = (searchResultsFull as SearchResultsFull).results;
            setFullSearchResults(results);
            setSearchResults([]); // Reset current visible results
            setVisibleCount(5); // Reset count to 5 when searching
          }
        }
      } else {
        setSearchResults([]);
        setFullSearchResults([]);
        setVisibleCount(5);
      }
    };
    performSearch();
  }, [search, platformNum, channelId, bucketUrl, pagefindInitialized]);

  useEffect(() => {
    const loadMoreResults = async () => {
      if (fullSearchResults.length > 0) {
        const nextResults = fullSearchResults.slice(
          visibleCount - 5,
          visibleCount
        );
        const videosData = await Promise.all(
          nextResults.map(async (r: SearchResult) => {
            const data: SearchResultData = await r.data();
            const videoId: string = data.url.split("/").pop() || "";
            const matchedVideo: Video | undefined = videos.find(
              (video: Video) => video.id === videoId
            );
            return {
              id: videoId,
              title: matchedVideo ? matchedVideo.title : `Video ${videoId}`,
              date: matchedVideo ? matchedVideo.date : 0,
              transcriptAvailable: matchedVideo
                ? matchedVideo.transcriptAvailable
                : false,
              excerpt: data.excerpt,
            } as Video;
          })
        );
        setSearchResults((prevResults) => [...prevResults, ...videosData]);
      }
    };

    loadMoreResults();
  }, [fullSearchResults, visibleCount, videos]);

  const loader = useRef<HTMLDivElement | null>(null); // Added ref for loader
  const handleIntersection = useCallback(() => {
    if (search) {
      setVisibleCount((prevCount) =>
        Math.min(prevCount + 5, fullSearchResults.length)
      );
    } else {
      if (
        platform === "twitch" &&
        visibleCount >= videos.length &&
        twitchPaginationCursor
      ) {
        fetchTwitchVideos(false, twitchPaginationCursor);
      }
      setVisibleCount((prevCount) => Math.min(prevCount + 5, videos.length));
    }
  }, [
    fetchTwitchVideos,
    fullSearchResults.length,
    platform,
    search,
    twitchPaginationCursor,
    videos.length,
    visibleCount,
  ]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          handleIntersection();
        }
      },
      { threshold: 1 }
    );

    const elem = loader.current;
    if (elem) {
      observer.observe(elem);
    }

    return () => {
      if (elem) {
        observer.unobserve(elem);
      }
    };
  }, [handleIntersection, loader]);

  const [modalMessage, setModalMessage] = useState(""); // Added state for modal message
  const [isModalVisible, setIsModalVisible] = useState(false); // Added state for modal visibility

  const handleReindex = async () => {
    if (!session) {
      setModalMessage("Please log in to perform this action."); // Replaced alert with modal
      setIsModalVisible(true);
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
          platform_id: platformNum,
          channel_id: channelId?.toString().toLowerCase(),
        }),
      });

      if (res.ok) {
        setModalMessage(
          "Indexing job queued successfully. Check back in a few minutes! The indexing process can take 10 seconds per video depending on the size of the transcript."
        ); // Replaced alert with modal
        setIsModalVisible(true);
        setIsIndexed(true);
      } else {
        const errorText = await res.text();
        setModalMessage(`Error creating indexing job: ${errorText}`); // Replaced alert with modal
        setIsModalVisible(true);
      }
    } catch (error) {
      console.error("Error creating indexing job:", error);
      setModalMessage("An error occurred while creating the job."); // Replaced alert with modal
      setIsModalVisible(true);
    }
  };

  const handleTranscribe = async (contentId: string) => {
    console.log(contentId);
    setModalMessage("Feature coming soon!"); // Replaced alert with modal
    setIsModalVisible(true);
    // if (!session) {
    //   setModalMessage("Please log in to perform this action."); // Replaced alert with modal
    //   setIsModalVisible(true);
    //   return;
    // }
    // const accessToken = session.access_token;
    // try {
    //   const response = await fetch(`${apiUrl}/jobs`, {
    //     method: "POST",
    //     headers: {
    //       "Content-Type": "application/json",
    //       Authorization: `Bearer ${accessToken}`,
    //     },
    //     body: JSON.stringify({
    //       platform_id: platformNum,
    //       channel_id: channelIdStr,
    //       content_id: contentId,
    //     }),
    //   });
    //   if (response.ok) {
    //     setModalMessage("Transcription job created successfully."); // Replaced alert with modal
    //     setIsModalVisible(true);
    //   } else {
    //     const errorText = await response.text();
    //     setModalMessage(`Error creating transcription job: ${errorText}`); // Replaced alert with modal
    //     setIsModalVisible(true);
    //   }
    // } catch (error) {
    //   console.error("Error creating transcription job:", error);
    //   setModalMessage("An error occurred while creating the job."); // Replaced alert with modal
    //   setIsModalVisible(true);
    // }
  };

  const videosToDisplay = search
    ? searchResults
    : videos.slice(0, visibleCount);

  return (
    <div>
      <Script id="pagefind" strategy="lazyOnload">
        {`
            import("/js/pagefind.js")
              .then(async (module) => {
                window.pagefind = module;
              });
          `}
      </Script>
      <MenuBar />
      <div className="container mx-auto p-8">
        <div className="max-w-2xl mx-auto">
          <div className="p-6">
            <PlatformChannelForm
              initialPlatform={
                typeof platform === "string" ? platform : "youtube"
              }
              initialChannelId={typeof channelId === "string" ? channelId : ""}
            />
            <div className="space-y-4 mt-2">
              {isIndexed && platform !== "twitch" && (
                <Input
                  type="text"
                  placeholder="Search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              )}

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

              {videosToDisplay && (
                <div className="space-y-4">
                  {videosToDisplay.map((video) => (
                    <div
                      key={video.id}
                      className="border rounded-md p-4 cursor-pointer hover:bg-gray-50"
                      onClick={() => handleVideoClick(video.id)}
                    >
                      <img
                        src={
                          platform === "youtube"
                            ? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`
                            : platform === "twitch" && video.thumbnail_url
                            ? video.thumbnail_url
                            : ""
                        }
                        alt={video.title}
                        className="w-full h-32 object-cover rounded-md mb-2"
                      />
                      <h3 className="font-medium">{video.title}</h3>
                      {video.excerpt && (
                        <p
                          className="text-gray-500 text-sm"
                          dangerouslySetInnerHTML={{ __html: video.excerpt }}
                        />
                      )}
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
              )}
              <div className="text-center py-8">
                {platform === "twitch" ? (
                  // Twitch channel logic
                  !session?.user.app_metadata.provider ? (
                    // No session/provider
                    <p className="mb-4">
                      Please log in with Twitch to view this Twitch channel.
                    </p>
                  ) : session?.user.app_metadata.provider !== "twitch" ? (
                    // Wrong provider
                    <p className="mb-4">
                      Please log in with Twitch (not{" "}
                      {session.user.app_metadata.provider}) to view this
                      channel.
                    </p>
                  ) : (
                    !session?.provider_token &&
                    !localStorage.getItem("provider_token") && (
                      // No token
                      <p className="mb-4">
                        Please log in again with Twitch to view this channel.
                      </p>
                    )
                  )
                ) : (
                  // Non-Twitch channel
                  !isIndexed && (
                    <>
                      <p className="mb-4">Channel not indexed</p>
                      <Button onClick={handleReindex}>Index</Button>
                    </>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div ref={loader} />
      <Modal
        message={modalMessage}
        isOpen={isModalVisible}
        onClose={() => setIsModalVisible(false)}
      />
    </div>
  );
}
