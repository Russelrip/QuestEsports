import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { videoSections } from "@/lib/media";

describe("match videos server rendering", () => {
  it("does not pass browser event handlers from the server component", () => {
    const component = readFileSync(
      resolve(process.cwd(), "components/match-videos/MatchVideosContent.tsx"),
      "utf8",
    );

    expect(component).not.toMatch(/<Image[\s\S]*onError=/);
  });

  it("contains the Quest Level Up Series August videos in order", () => {
    const section = videoSections.find(
      ({ title }) => title === "QUEST LEVEL UP SERIES - AUGUST",
    );

    expect(section).toBeDefined();
    expect(section?.videos.map(({ href, youtubeId }) => ({ href, youtubeId }))).toEqual([
      {
        href: "https://www.youtube.com/live/LOhBDmMFMSE?si=beNVW3BFJ40guOw_",
        youtubeId: "LOhBDmMFMSE",
      },
      {
        href: "https://www.youtube.com/live/wLmgQvJeg4I?si=72ZcM1VwZ48li5l1",
        youtubeId: "wLmgQvJeg4I",
      },
      {
        href: "https://www.youtube.com/live/BWild20oHCI?si=bI-662vkHwFSFIny",
        youtubeId: "BWild20oHCI",
      },
      {
        href: "https://www.youtube.com/live/O0m-5g4_9Dk?si=uu_vs0FFpqou0_Yq",
        youtubeId: "O0m-5g4_9Dk",
      },
      {
        href: "https://www.youtube.com/live/RSD1Fe_C06g?si=14DLoVOLO7ZLW7XT",
        youtubeId: "RSD1Fe_C06g",
      },
      {
        href: "https://www.youtube.com/live/eMpNoDizi6g?si=2leaL461t6NqZEHZ",
        youtubeId: "eMpNoDizi6g",
      },
      {
        href: "https://www.youtube.com/live/LVcJLX_AwOs?si=1A9hh5V9q4z4FuGl",
        youtubeId: "LVcJLX_AwOs",
      },
      {
        href: "https://www.youtube.com/live/04DpiSfhqic?si=gXYZ39uYm7DYZB6f",
        youtubeId: "04DpiSfhqic",
      },
      {
        href: "https://www.youtube.com/live/oTzh_ZMH7mA?si=D6wLgr61ROOFAwga",
        youtubeId: "oTzh_ZMH7mA",
      },
    ]);
    expect(section?.videos[7]?.subtitle).toBe("Quest Level Up Series AUG | SEMI FINALS MATCH 02");
  });
});
