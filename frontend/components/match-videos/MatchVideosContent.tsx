import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { videoSections, type VideoItem } from "@/lib/media";

function VideoSection({ title, videos }: { title: string; videos: VideoItem[] }) {
  return (
    <Section className="pt-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Video Library</p>
        <h2 className="mt-3 text-3xl text-white">{title}</h2>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {videos.map((video) => (
          <Card key={video.href} className="overflow-hidden">
            <a href={video.href} target="_blank" rel="noopener noreferrer" className="block">
              <div className="relative aspect-video">
                <Image
                  src={`https://img.youtube.com/vi/${video.youtubeId}/hqdefault.jpg`}
                  alt={video.alt}
                  fill
                  className="object-cover"
                />
              </div>
            </a>
            <div className="space-y-2 p-5">
              <h3 className="text-xl text-white">{video.title}</h3>
              <p className="text-sm text-slate-400">{video.subtitle}</p>
            </div>
          </Card>
        ))}
      </div>
    </Section>
  );
}

export default function MatchVideosContent() {
  return (
    <>
      {videoSections.map((section) => (
        <VideoSection key={section.title} title={section.title} videos={[...section.videos]} />
      ))}
    </>
  );
}
