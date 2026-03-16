type VideoItem = {
  title: string;
  subtitle: string;
  href: string;
  youtubeId: string;
  alt: string;
};

const showdownVideos: VideoItem[] = [
  {
    title: "Champions X3 Interview",
    subtitle: "Valorant Showdown Champions X3 | Post-Grand Finals Interview",
    href: "https://youtu.be/gJLHc5ZhQ4Y?si=fJD6zQ9UbMthID1-",
    youtubeId: "gJLHc5ZhQ4Y",
    alt: "Valorant Showdown Champions X3 | Post-Grand Finals Interview",
  },
  {
    title: "Xiphos vs One Punch Man",
    subtitle: "Grand Finals",
    href: "https://www.youtube.com/live/17rljYMIgCk?si=mYKrpqOvvNhvJKqg",
    youtubeId: "17rljYMIgCk",
    alt: "Xiphos Esports Valorant vs one punch man | Grand Finals",
  },
  {
    title: "Xiphos vs Bandu & Friends",
    subtitle: "Semis 2 - Part 1 (Replay)",
    href: "https://www.youtube.com/live/hBa81QCt3JA?si=v1-kcJqqLR2FYtoI",
    youtubeId: "hBa81QCt3JA",
    alt: "Xiphos Esports Valorant vs Bandu & Friends | PART 1",
  },
  {
    title: "One Punch Man vs Ascendants",
    subtitle: "Semis 1",
    href: "https://www.youtube.com/live/1SEVrPtgiC4?si=sKG9PDwDuH1P7LTM",
    youtubeId: "1SEVrPtgiC4",
    alt: "One Punch Man vs Ascendants | Semis 1",
  },
  {
    title: "Xiphos vs 4 UNCS 1 Kid",
    subtitle: "Round 04 Match 29",
    href: "https://www.youtube.com/live/0R5U22g5mhA?si=nK2qe5grqfdrAWbN",
    youtubeId: "0R5U22g5mhA",
    alt: "Xiphos Esports Valorant vs 4 UNCS 1 kid | Round 04 Match 29",
  },
  {
    title: "Ascendants vs FFFL",
    subtitle: "Round 04 Match 28",
    href: "https://www.youtube.com/live/MSG-be9Ugtc?si=g6LOnvfgFkdRLljn",
    youtubeId: "MSG-be9Ugtc",
    alt: "Ascendants vs Full Focus Fast Lose | Round 04 Match 28",
  },
  {
    title: "Bandu & Friends vs OCG",
    subtitle: "Round 04 Match 26",
    href: "https://www.youtube.com/live/WWqiipCVDEc?si=OYIseip7_j6MhOyO",
    youtubeId: "WWqiipCVDEc",
    alt: "Bandu & Friends vs On Crack Gang | Round 04 Match 26",
  },
  {
    title: "Sigiri Baddies vs OPM",
    subtitle: "Round 04 Match 27",
    href: "https://www.youtube.com/live/WFc0CEeLNiQ?si=c-TbiOvC_6tbu6nc",
    youtubeId: "WFc0CEeLNiQ",
    alt: "Sigiri Baddies vs One Punch Man | Round 04 Match 27",
  },
  {
    title: "Washed Uncs vs Ascendants",
    subtitle: "Round 03 Match 23",
    href: "https://www.youtube.com/live/M7tPSAZkGPQ?si=vyfsDYEzNi2AnSQI",
    youtubeId: "M7tPSAZkGPQ",
    alt: "Washed Uncs vs Ascendants | Round 03 Match 23",
  },
  {
    title: "X3 vs Exotic",
    subtitle: "Round 03 Match 25",
    href: "https://www.youtube.com/live/o-5G5iZEuvA?si=7D0Cv4-kemWznLQW",
    youtubeId: "o-5G5iZEuvA",
    alt: "x3 vs Exotic | Round 03 Match 25",
  },
  {
    title: "FFFL vs W Gamers",
    subtitle: "Round 03 Match 24",
    href: "https://www.youtube.com/live/njfkKglgotQ?si=Jy4FQeP9EGvFNlI3",
    youtubeId: "njfkKglgotQ",
    alt: "Full Focus Fast Lose vs W Gamers | Round 03 Match 24",
  },
  {
    title: "Uber Eats vs OPM",
    subtitle: "Round 03 Match 22",
    href: "https://www.youtube.com/live/aODC0HjXr2Q?si=P5gmZvCqGjsUgjsh",
    youtubeId: "aODC0HjXr2Q",
    alt: "Send me Uber Eats vs One Punch Man | Round 03 Match 22",
  },
  {
    title: "MRG vs Sigiri Baddies",
    subtitle: "Round 03 Match 21",
    href: "https://www.youtube.com/live/AKVb2Vf8oQ4?si=tj2lUCSsyPg6HsSH",
    youtubeId: "AKVb2Vf8oQ4",
    alt: "MRG vs Sigiri Baddies | Round 03 Match 21",
  },
  {
    title: "OCG vs Crash Out",
    subtitle: "Round 03 Match 20 Part 2",
    href: "https://www.youtube.com/live/zj6C9GLDVRU?si=EkI6RxBB9gk6a6c0",
    youtubeId: "zj6C9GLDVRU",
    alt: "On Crack Gang vs Crash Out | Round 03 Match 20 Part 2",
  },
  {
    title: "Bandu & Friends vs Xiphos Academy",
    subtitle: "Round 03 Match 19",
    href: "https://www.youtube.com/live/uMOexydmkLc?si=IJZWWqTrdXMOr4I8",
    youtubeId: "uMOexydmkLc",
    alt: "Bandu & Friends vs Xiphos Academy | Round 03 Match 19",
  },
  {
    title: "4 UNCS 1 Kid vs CULT 6",
    subtitle: "Round 03 Match 18",
    href: "https://www.youtube.com/live/Ab_-imsvrvc?si=WWVpeMlDxhaAbtpe",
    youtubeId: "Ab_-imsvrvc",
    alt: "4 UNCS 1 Kid vs CULT 6 | Round 03 Match 18",
  },
  {
    title: "FFFL vs Team Oxide",
    subtitle: "Round 02 Match 15",
    href: "https://www.youtube.com/live/AdxWZw0QINI?si=hvvqSqZBcU670H06",
    youtubeId: "AdxWZw0QINI",
    alt: "Full Focus Fast Lose vs Team Oxide | Round 02 Match 15",
  },
  {
    title: "W Gamers vs Team ZED",
    subtitle: "Round 02 Match 16",
    href: "https://www.youtube.com/live/4_vKrU8G2do?si=TWmJVOatwbCVzKT8",
    youtubeId: "4_vKrU8G2do",
    alt: "W Gamers vs Team ZED | Round 02 Match 16",
  },
  {
    title: "Sigiri Baddies vs Whiff Masters",
    subtitle: "Round 02 Match 09",
    href: "https://www.youtube.com/live/di5MPt9oKuE?si=oVGT5A_ufuKgC01-",
    youtubeId: "di5MPt9oKuE",
    alt: "Sigiri Baddies vs Whiff Masters | Round 02 Match 09",
  },
  {
    title: "Ascendents vs Team UNF4IR",
    subtitle: "Round 02 Match 13",
    href: "https://www.youtube.com/live/8azFenI4Ac4?si=ytpkW4FIXZIhmCxY",
    youtubeId: "8azFenI4Ac4",
    alt: "Ascendents vs Team UNF4IR | Round 02 Match 13",
  },
  {
    title: "FNO x Team 99 vs Washed Uncs",
    subtitle: "Round 02 Match 13",
    href: "https://www.youtube.com/live/gj3xzdY7uA4?si=LMDw2NgH6mDqgmO5",
    youtubeId: "gj3xzdY7uA4",
    alt: "FNO x Team 99 vs Washed Uncs | Round 02 Match 13",
  },
  {
    title: "Crash Out vs Modara Buffalos",
    subtitle: "Round 02 Match 08",
    href: "https://www.youtube.com/live/l7CvseKXTo8?si=8D6fJuHAVMJjNImq",
    youtubeId: "l7CvseKXTo8",
    alt: "Crash Out vs Modara Buffalos | Round 02 Match 08",
  },
  {
    title: "Uber Eats vs Gahanna Newe Awe",
    subtitle: "Round 01 Match 11",
    href: "https://www.youtube.com/live/yWuHs2pyp2I?si=U-_Th3O9b0i7cEX5",
    youtubeId: "yWuHs2pyp2I",
    alt: "Send me Uber Eats vs Gahanna newe Awe | Round 01 Match 11",
  },
  {
    title: "ORIGINS vs One Punch Man",
    subtitle: "Round 02 Match 12",
    href: "https://www.youtube.com/live/TjK9xrlpZcY?si=w_A9QnL5oBA_LL4Y",
    youtubeId: "TjK9xrlpZcY",
    alt: "ORIGINS vs One Punch Man Season 3 Episode 9 | Round 02 Match 12",
  },
  {
    title: "The Alliance vs On Crack Gang",
    subtitle: "Round 01 Match 07",
    href: "https://www.youtube.com/live/erT9lMf2HDA?si=w3H7ysRRBGIXqgLf",
    youtubeId: "erT9lMf2HDA",
    alt: "The Alliance vs On Crack Gang | Round 01 Match 07",
  },
  {
    title: "Bandu & Friends vs Ravens",
    subtitle: "Round 02 Match 05",
    href: "https://www.youtube.com/live/z8saivH7DSo?si=_zuPAlWEU3VFFHgT",
    youtubeId: "z8saivH7DSo",
    alt: "Bandu & Friends vs Ravens | Round 02 Match 05",
  },
  {
    title: "TEAM THANIYA vs CULT 6",
    subtitle: "Round 02 Match 04",
    href: "https://www.youtube.com/live/FCehjx7Zv4k?si=So3-_qvCya01he-J",
    youtubeId: "FCehjx7Zv4k",
    alt: "TEAM THANIYA vs CULT 6 | Round 02 Match 04",
  },
  {
    title: "4 UNCS 1 Kid vs Black Chickens",
    subtitle: "Round 02 Match 03",
    href: "https://www.youtube.com/live/OmffOKfl20Y?si=qWLKIM21SGCeo-wu",
    youtubeId: "OmffOKfl20Y",
    alt: "4 UNCS 1 Kid vs Black Chickens | Round 02 Match 03",
  },
  {
    title: "EXOTIC vs REDOX",
    subtitle: "Round 02 Match 02",
    href: "https://www.youtube.com/live/ijBdgby0dII?si=UxeCKo1TlD1HNd0W",
    youtubeId: "ijBdgby0dII",
    alt: "EXOTIC vs REDOX | Round 02 Match 02",
  },
  {
    title: "GOLDEN HEROS vs ARMORED BRIGADE",
    subtitle: "Round 01 Match 01",
    href: "https://www.youtube.com/live/qxHXJu6UuoA?si=gsN1JhLTrc5Hj-ly",
    youtubeId: "qxHXJu6UuoA",
    alt: "GOLDEN HEROS vs ARMORED BRIGADE | Round 1 Match 01",
  },
];

const womensVideos: VideoItem[] = [
  {
    title: "Crashout vs STXRM",
    subtitle: "Grand Finals",
    href: "https://www.youtube.com/live/aMXi8BXH1c8?si=1N-LgBN2-0S1K2i2",
    youtubeId: "aMXi8BXH1c8",
    alt: "Grand Finals Crashout vs STXRM",
  },
  {
    title: "STXRM vs HUNTR/X",
    subtitle: "Semi-Finals",
    href: "https://www.youtube.com/live/PuLLc_cvOjM?si=wiCdCXGAEpFg-2nj",
    youtubeId: "PuLLc_cvOjM",
    alt: "Semi-Finals STXRM vs HUNTR/X",
  },
  {
    title: "Crashout vs KDG",
    subtitle: "Semi-Finals",
    href: "https://www.youtube.com/live/hL03OqV3xLU?si=mcPfG0WWW1TkdtkZ",
    youtubeId: "hL03OqV3xLU",
    alt: "Semi-Finals Crashout vs KDG",
  },
  {
    title: "CRIMSON vs HUNTRX",
    subtitle: "Match 03",
    href: "https://youtu.be/SFO66i05zds?si=zucxe1DTXN6_TucR",
    youtubeId: "SFO66i05zds",
    alt: "CRIMSON VS HUNTRX (Match 03)",
  },
  {
    title: "R4VENS vs KDG",
    subtitle: "Match 02",
    href: "https://youtu.be/X3fTYmakf3Q?si=tO_PeMECFFSmHrZL",
    youtubeId: "X3fTYmakf3Q",
    alt: "R4VENS VS KDG (Match 02)",
  },
  {
    title: "LLS vs STXRM",
    subtitle: "Match 01",
    href: "https://youtu.be/1HQ8RV0Pci0?si=uxmP28lJ0xrG7-Zv",
    youtubeId: "1HQ8RV0Pci0",
    alt: "LLS VS STXRM (Match 01)",
  },
];

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

        {/* Each card links to YouTube and uses the standard thumbnail format generated from the video ID. */}
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
      {/* Reuse the same section renderer for each tournament archive. */}
      <VideoSection
        title="THE VALORANT SHOWDOWN 2026"
        videos={showdownVideos}
        paddingTop="35px"
      />

      <VideoSection
        title="WOMEN'S VALORANT CHAMPIONSHIP 2025"
        videos={womensVideos}
        paddingTop="10px"
      />
    </>
  );
}
import Image from "next/image";
