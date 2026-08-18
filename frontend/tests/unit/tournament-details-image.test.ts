import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("tournament participant images", () => {
  it("resolves participant uploads and direct-loads them with a guarded fallback", () => {
    const component = readFileSync(
      resolve(process.cwd(), "components/tournaments/TournamentDetailsContent.tsx"),
      "utf8",
    );

    const teamsPanel = component.match(/function TeamsPanel[\s\S]*?function SchedulePanel/)?.[0];
    expect(teamsPanel).toBeDefined();

    const participantImage = teamsPanel?.match(/const imageUrl = resolveImageUrl\(team\.avatarUrl \|\| team\.logoUrl\);[\s\S]*?<Image[\s\S]*?\/>/)?.[0];
    expect(participantImage).toBeDefined();
    expect(participantImage).toContain("src={imageUrl}");
    expect(participantImage).toContain("unoptimized");
    expect(participantImage).toContain("setFailedTeamIds");
    expect(teamsPanel).toContain("!failedTeamIds[team.id]");
    expect(teamsPanel).toContain("{team.shortCode}");
  });

  it("does not use buildApiUrl as an image source", () => {
    const componentsRoot = resolve(process.cwd(), "components");
    const files = [
      "tournaments/TournamentDetailsContent.tsx",
      "tournaments/TournamentBannerImage.tsx",
      "tournaments/TournamentsContent.tsx",
      "gallery/EventAlbumCard.tsx",
      "gallery/EventAlbumBrowser.tsx",
      "posters/PosterGallery.tsx",
      "posters/PosterPreview.tsx",
      "posters/AdminPosterStudio.tsx",
      "admin/AdminMediaManager.tsx",
      "admin/AdminEventAlbumsManager.tsx",
      "admin/AdminTeamsManager.tsx",
      "admin/TournamentSponsorsManager.tsx",
      "admin/AdminGamesManager.tsx",
      "auth/TeamManagementPanel.tsx",
      "auth/ProfileView.tsx",
      "UserMenu.tsx",
      "Navbar.tsx",
      "match-rooms/MatchRoomView.tsx",
      "veto/VetoRoomView.tsx",
      "shop/ShopContent.tsx",
      "shop/ProductDetailContent.tsx",
      "match-videos/MatchVideosContent.tsx",
    ];

    expect(files.some((file) => /src=\{\s*buildApiUrl/.test(readFileSync(resolve(componentsRoot, file), "utf8")))).toBe(false);
  });

  it("shows completed tournament posters in full within dark image frames", () => {
    const component = readFileSync(
      resolve(process.cwd(), "components/tournaments/TournamentDetailsContent.tsx"),
      "utf8",
    );
    const showcase = component.match(/function CompletedTournamentShowcase[\s\S]*?function ResultLogo/)?.[0];

    expect(showcase).toBeDefined();
    expect(showcase).toContain('className="relative min-h-72 border-t border-white/10 bg-[#08070b]');
    expect(showcase).toContain('className="object-contain"');
    expect(showcase).toContain('className="relative aspect-square overflow-hidden bg-[#08070b]"');
    expect(showcase?.match(/className="object-contain"/g)).toHaveLength(2);
  });
});
