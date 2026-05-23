import Image from "next/image";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";

const sections = [
  {
    title: "1. Introduction",
    content: [
      "Quest Esports reserves the right to amend rules, schedules, or formats whenever necessary in order to preserve fair competition, tournament integrity, and player safety.",
    ],
  },
  {
    title: "2. General Rules (All Tournaments)",
    subsections: [
      {
        title: "2.1 Player & Team Eligibility",
        items: [
          "All players must register and compete using their own valid Riot ID.",
          "Using another player's account, fake information, or false identity is strictly prohibited.",
          "Quest Esports may request identity verification using NIC, passport, student ID, or equivalent documents.",
          "Failure or refusal to provide verification may result in immediate disqualification.",
          "Team rosters become locked once the team has played its first official match.",
          "No roster changes are allowed after the first official match unless Quest Esports approves an exceptional case.",
          "Team names, player names, logos, and profile images must not contain offensive, obscene, or discriminatory content.",
        ],
      },
      {
        title: "2.2 Tournament Format",
        items: [
          "Tournament format will be announced before each event.",
          "Teams consist of 5 core players with up to 2 substitutes.",
          "Substitutions are allowed only between maps, never during a round.",
          "Stand-ins who are not officially registered are not allowed in online events.",
        ],
      },
      {
        title: "2.3 Match Scheduling",
        items: [
          "Online tournaments: teams must check in 30 minutes before the match start time.",
          "LAN tournaments: teams must check in 1 hour before the match start time.",
          "A team not ready within 10 minutes of the official start time may forfeit the match.",
          "Matches may be played 4v5 only if the opponent agrees.",
        ],
      },
    ],
  },
];

type RulebookSection = (typeof sections)[number];

function hasParagraphContent(section: RulebookSection): section is RulebookSection & { content: string[] } {
  return "content" in section;
}

const mapVetoSections = {
  BO1: [
    "Team A bans 1 map",
    "Team B bans 1 map",
    "Team A bans 1 map",
    "Team B bans 1 map",
    "Team A bans 1 map",
    "Team B bans 1 map",
    "Map 7 remains and Team A chooses side",
  ],
  BO3: [
    "Team A bans 1 map",
    "Team B bans 1 map",
    "Team A picks Map 1 and Team B chooses side",
    "Team B picks Map 2 and Team A chooses side",
    "Team A bans 1 map",
    "Team B bans 1 map",
    "Map 3 remains and Team A chooses side",
  ],
  BO5: [
    "Team A bans 1 map",
    "Team B bans 1 map",
    "Team A picks Map 1 and Team B chooses side",
    "Team B picks Map 2 and Team A chooses side",
    "Team A picks Map 3 and Team B chooses side",
    "Team B picks Map 4 and Team A chooses side",
    "Map 5 remains and Team B chooses side",
  ],
};

export default function RulebookContent() {
  return (
    <Section className="pt-6">
      <div className="grid gap-6">
        <Card className="p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Official Rulebook</p>
          <h2 className="mt-3 text-3xl text-white">Quest Esports VALORANT Tournament Rulebook</h2>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-slate-300">
            This page contains the official rules for Quest Esports VALORANT tournaments in Sri Lanka. General rules apply to all tournaments, while women&apos;s tournament rules apply only to female-only events and override the general rules where specified.
          </p>
        </Card>

        {sections.map((section) => (
          <Card key={section.title} className="p-6 sm:p-8">
            <h3 className="text-2xl text-white">{section.title}</h3>
            {hasParagraphContent(section) ? (
              section.content.map((paragraph) => (
                <p key={paragraph} className="mt-4 text-sm leading-7 text-slate-300">{paragraph}</p>
              ))
            ) : (
              <div className="mt-5 grid gap-5">
                {section.subsections.map((subsection) => (
                  <div key={subsection.title} className="rounded-[24px] border border-white/8 bg-white/5 p-5">
                    <h4 className="text-xl text-white">{subsection.title}</h4>
                    <ul className="mt-4 grid gap-2 text-sm leading-7 text-slate-300">
                      {subsection.items.map((item) => (
                        <li key={item} className="flex gap-3">
                          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-cyan-300" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}

        <Card className="p-6 sm:p-8">
          <h3 className="text-2xl text-white">2.11 Map Veto System</h3>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {Object.entries(mapVetoSections).map(([label, items]) => (
              <div key={label} className="rounded-[24px] border border-white/8 bg-white/5 p-5">
                <h4 className="text-xl text-white">{label}</h4>
                <ul className="mt-4 grid gap-2 text-sm leading-7 text-slate-300">
                  {items.map((item) => (
                    <li key={item} className="flex gap-3">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-cyan-300" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6 sm:p-8">
          <h3 className="text-2xl text-white">2.13 Spectra Client Requirement</h3>
          <ul className="mt-5 grid gap-2 text-sm leading-7 text-slate-300">
            {[
              "All players must have the Spectra Client installed and running.",
              "This is mandatory for in-game data tracking and stream overlays.",
              "Players must run the Spectra Player Client as Administrator.",
              "Spectra must be started before launching VALORANT.",
              "Players must select EU as the server inside Spectra.",
              "Failure to comply may result in delays, penalties, or match forfeiture.",
            ].map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-cyan-300" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <a href="https://valospectra.com/download" target="_blank" rel="noopener noreferrer" className={buttonClassName({ variant: "secondary" })}>
              Download Spectra Client
            </a>
          </div>
        </Card>

        <Card className="p-6 sm:p-8">
          <h3 className="text-2xl text-white">Face Camera Angle Examples</h3>
          <p className="mt-3 text-sm text-slate-400">Approved face camera angle examples for player verification and monitoring.</p>
          <div className="mt-5 overflow-hidden rounded-[24px] border border-white/8">
            <Image src="/images/face-camera-angle-examples.jpg" alt="Face Camera Angle Examples" width={1600} height={900} />
          </div>
        </Card>

        <Card className="p-6 sm:p-8">
          <h3 className="text-2xl text-white">3. Women&apos;s Tournament - Special Rules</h3>
          <div className="mt-5 grid gap-5">
            {[
              {
                title: "3.1 Eligibility",
                items: [
                  "Players must identify only as female (cisgender).",
                  "All players must be Sri Lankan citizens or residents.",
                  "Minimum age is 10 years, and parental consent is required for players under 16.",
                  "Riot ID must match the registration details.",
                  "Quest Esports may request official ID for verification.",
                ],
              },
              {
                title: "3.2 Team Formation",
                items: [
                  "Teams must have 5 core players.",
                  "Up to 2 substitutes are allowed.",
                  "Solo registrations may be placed into teams by the organizers.",
                ],
              },
              {
                title: "3.5 CAM-on Refereeing",
                items: [
                  "Video verification through Zoom, Discord, or Google Meet may be mandatory when requested.",
                  "Teams must inform organizers of the chosen platform 30 minutes before the match.",
                  "Refusal or failure to comply may result in disqualification.",
                ],
              },
            ].map((subsection) => (
              <div key={subsection.title} className="rounded-[24px] border border-white/8 bg-white/5 p-5">
                <h4 className="text-xl text-white">{subsection.title}</h4>
                <ul className="mt-4 grid gap-2 text-sm leading-7 text-slate-300">
                  {subsection.items.map((item) => (
                    <li key={item} className="flex gap-3">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-cyan-300" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm italic text-slate-500">
            All images used in the rulebook are sourced from official VCT rulebooks and/or VCT tournament broadcasts and are included only for reference and illustrative purposes.
          </p>
        </Card>

        <Card className="p-6 sm:p-8">
          <h3 className="text-2xl text-white">Back View / Side View Camera Examples</h3>
          <p className="mt-3 text-sm text-slate-400">Examples of correct and incorrect camera setups for player monitoring.</p>
          <div className="mt-5 overflow-hidden rounded-[24px] border border-white/8">
            <Image src="/images/pc-camera-dos-donts.jpg" alt="PC Camera Dos and Donts" width={1600} height={900} />
          </div>
        </Card>
      </div>
    </Section>
  );
}
