/* eslint-disable @next/next/no-img-element */
import { useState, useEffect, useRef } from "react"; // Added useRef
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

// Update the Video type if necessary
type Video = {
  id: string;
  title: string;
  date: number;
  transcriptAvailable: boolean;
  excerpt?: string; // Added excerpt for search results
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
  const platformStr = typeof platform === "string" ? platform : "";
  const channelIdStr = typeof channelId === "string" ? channelId : "";
  const apiUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL || "";
  const bucketUrl = process.env.NEXT_PUBLIC_BUCKET_URL || "";

  const platformIds: { [key: string]: number } = {
    youtube: 0,
    // add other platforms here
  };

  const platformNum = platformIds[platformStr] || 0;

  const handleVideoClick = (videoId: string): void => {
    router.push(`/channels/${platform}/${channelId}/${videoId}`);
  };

  const formatDate = (daysSinceEpoch: number): string => {
    const millisecondsSinceEpoch = daysSinceEpoch * 24 * 60 * 60 * 1000;
    const date = new Date(millisecondsSinceEpoch);
    return date.toLocaleDateString();
  };

  useEffect(() => {
    if (channelId) {
      const url = `${bucketUrl}/${platformNum}/${channelId}/index.json`;
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
          setIsIndexed(false);
          setLastUpdatedDate(null);
          setVideos([]);
        });
    }
  }, [platformNum, channelId, bucketUrl]);

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
            basePath: `${bucketUrl}/${platformNum}/${channelIdStr}/pagefind`,
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
  }, [search, platformNum, channelIdStr, bucketUrl, pagefindInitialized]);

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
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prevCount) => prevCount + 5);
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
  }, []);

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
          channel_id: channelIdStr,
        }),
      });

      if (res.ok) {
        setModalMessage("Indexing job created successfully."); // Replaced alert with modal
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
                  {videosToDisplay.map((video) => (
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
              ) : (
                <div className="text-center py-8">
                  <p className="mb-4">Channel not indexed</p>
                  <Button onClick={handleReindex}>Index</Button>
                </div>
              )}
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
