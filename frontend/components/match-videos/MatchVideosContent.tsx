import Image from "next/image";
import { videoSections, type VideoItem } from "@/lib/media";

function VideoSection({
  title,
  videos,
  paddingTop,
}: {
  title: string;
  videos: VideoItem[];
  paddingTop: string;
}) {
  return (
    <section className="videos-gallery-section" style={{ paddingTop }}>
      <div className="container">
        <h2>{title}</h2>

        <div className="videos-grid">
          {videos.map((video) => (
            <article className="video-card" key={video.href}>
              <a
                className="video-thumb-link"
                href={video.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Image
                  className="video-thumb"
                  src={`https://img.youtube.com/vi/${video.youtubeId}/hqdefault.jpg`}
                  alt={video.alt}
                  width={480}
                  height={360}
                />
              </a>
              <div className="video-card-content">
                <h3>{video.title}</h3>
                <p>{video.subtitle}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function MatchVideosContent() {
  return (
    <>
      {videoSections.map((section) => (
        <VideoSection
          key={section.title}
          title={section.title}
          videos={[...section.videos]}
          paddingTop={section.paddingTop}
        />
      ))}
    </>
  );
}
