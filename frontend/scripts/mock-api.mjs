import { createServer } from "node:http";

const port = Number.parseInt(process.env.PLAYWRIGHT_MOCK_API_PORT || "5011", 10);
const allowedOrigin = new URL(
  process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3010"
).origin;
const unexpectedRequests = [];
const mobileTestAvatar = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const eventAlbumPhoto = {
  id: "photo-mobile-test",
  caption: "Mobile event photo",
  position: 0,
  createdAt: "2026-08-12T00:00:00.000Z",
  imageAsset: {
    id: "image-mobile-test",
    title: "Mobile event photo",
    description: null,
    category: "photo",
    originalName: "mobile-event-photo.png",
    contentType: "image/png",
    byteSize: mobileTestAvatar.length,
    createdAt: "2026-08-12T00:00:00.000Z",
    imageUrl: "/api/event-albums/mobile-test/photos/photo-mobile-test/image?v=image-mobile-test",
  },
};
const eventAlbum = {
  id: "album-mobile-test",
  slug: "mobile-test",
  title: "Mobile Test Album",
  description: "Responsive event album test.",
  location: "Colombo",
  eventDate: "2026-08-12T00:00:00.000Z",
  isPublished: true,
  allowDownloads: true,
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
  photoCount: 1,
  photos: [eventAlbumPhoto],
  photoPagination: { page: 1, pageSize: 30, total: 1, totalPages: 1 },
  tournament: null,
};
const collections = new Map([
  ["/api/posters", { posters: [] }],
  ["/api/event-albums", {
    albums: [eventAlbum],
    pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 },
    totalPhotos: 1,
  }],
  ["/api/tournaments", { tournaments: [] }],
  ["/api/event-series", { series: [] }],
  ["/api/game-categories", { categories: [] }],
  ["/api/products", { products: [] }],
]);

const server = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.headers.origin === allowedOrigin) {
    response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
  }

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.url === "/api/health/live") {
    response.end(JSON.stringify({ success: true }));
    return;
  }
  if (
    request.method === "GET" &&
    request.url === "/api/v1/notifications?limit=30"
  ) {
    response.end(JSON.stringify({
      success: true,
      data: {
        items: [],
        unreadCount: 0,
        push: { enabled: false, publicKey: null },
        preference: {
          matchPushEnabled: true,
          soundEnabled: true,
          matchEmailEnabled: false,
        },
      },
    }));
    return;
  }
  if (request.method === "GET" && request.url === "/api/posters/poster-duplicate/image") {
    response.setHeader("Content-Type", "image/png");
    response.end(mobileTestAvatar);
    return;
  }
  if (
    request.method === "GET" &&
    new URL(request.url || "/", `http://127.0.0.1:${port}`).pathname ===
      "/api/v1/events"
  ) {
    // A 204 tells EventSource not to reconnect. This keeps browser tests
    // deterministic while the real API owns the long-lived SSE connection.
    response.statusCode = 204;
    response.removeHeader("Content-Type");
    response.end();
    return;
  }
  if (request.url === "/__mock-api/status") {
    response.end(JSON.stringify({ success: true, unexpectedRequests }));
    return;
  }
  if (
    request.method === "GET" &&
    request.url === "/api/uploads/avatars/mobile-test.png"
  ) {
    response.setHeader("Content-Type", "image/png");
    response.end(mobileTestAvatar);
    return;
  }
  if (
    request.method === "GET" &&
    new URL(request.url || "/", `http://127.0.0.1:${port}`).pathname ===
      "/api/event-albums/mobile-test/photos/photo-mobile-test/image"
  ) {
    response.setHeader("Content-Type", "image/png");
    response.end(mobileTestAvatar);
    return;
  }
  if (
    request.method === "GET" &&
    new URL(request.url || "/", `http://127.0.0.1:${port}`).pathname === "/api/event-albums/mobile-test"
  ) {
    response.end(JSON.stringify({ success: true, album: eventAlbum }));
    return;
  }
  if (request.url === "/api/me") {
    response.statusCode = 401;
    response.end(JSON.stringify({ success: false, message: "Not authenticated." }));
    return;
  }
  if (request.method === "GET" && request.url === "/api/admin/dashboard") {
    response.statusCode = 401;
    response.end(JSON.stringify({ success: false, message: "Not authenticated." }));
    return;
  }
  if (request.method === "GET" && request.url === "/api/products/quest-shirt") {
    response.statusCode = 404;
    response.end(JSON.stringify({ success: false, message: "Product not found." }));
    return;
  }
  if (request.method === "GET" && request.url === "/api/tournaments/challonge-test") {
    response.end(JSON.stringify({
      success: true,
      tournament: {
        id: "tournament-challonge-test",
        slug: "challonge-test",
        title: "Quest Challonge Test",
        game: "valorant",
        gameCategory: null,
        organizer: "Quest Esports",
        country: "Sri Lanka",
        location: "Online",
        series: null,
        seriesOrder: 0,
        displayPriority: 0,
        bannerUrl: null,
        heroUrl: null,
        shortDescription: "Native Challonge bracket test.",
        fullDescription: "Native Challonge bracket test.",
        rules: null,
        rulebook: null,
        registrationOpenAt: null,
        startDate: null,
        startDateStatus: "tbd",
        endDate: null,
        endDateStatus: "tbd",
        registrationDeadline: null,
        registrationDeadlineStatus: "tbd",
        format: "Single elimination",
        registrationMode: "open_entry",
        entryType: "team",
        teamSize: 5,
        minRosterSize: 5,
        maxRosterSize: 7,
        maxSubstitutes: 2,
        registrationFields: [],
        paymentMethod: "free",
        registrationFee: { amount: 0, currency: "LKR" },
        registrationFeeTiers: [],
        registrationPaymentAvailable: false,
        reservationMinutes: 15,
        bankTransferReviewMinutes: 60,
        maxTeams: 8,
        registrationCount: 2,
        capacityUsed: 2,
        prizePool: "LKR 10,000",
        status: "completed",
        isPublished: true,
        bracketLink: "https://challonge.com/quest-test",
        challongeEmbedUrl: "https://challonge.com/quest-test/module",
        bracketSource: "challonge",
        sponsors: [],
        contactLink: null,
        isFeatured: false,
        scheduleData: null,
        bracketSummary: null,
        bracketData: null,
        showcase: { posterUrl: null, firstPlaceUrl: null, secondPlaceUrl: null, thirdPlaceUrl: null },
        eventMedia: [],
        eventAlbums: [],
        resultSummary: {
          status: "complete",
          completedAt: "2026-08-03T12:00:00.000Z",
          standings: [
            { rank: 1, name: "Quest Champions", seed: 2, logoUrl: null },
            { rank: 2, name: "Final Boss", seed: 1, logoUrl: null },
            { rank: 3, name: "Third Wave", seed: 3, logoUrl: null },
          ],
        },
        registeredParticipants: [],
        isCompleted: true,
        registrationState: "registration_closed",
        isRegistrationOpen: false,
        isSlotsFull: false,
        isRegistrationClosed: true,
      },
    }));
    return;
  }

  const payload = collections.get(new URL(request.url || "/", `http://127.0.0.1:${port}`).pathname);
  if (request.method === "GET" && payload) {
    response.end(JSON.stringify({ success: true, ...payload }));
    return;
  }

  unexpectedRequests.push({ method: request.method, url: request.url });
  response.statusCode = 404;
  response.end(JSON.stringify({ success: false, message: "Unexpected mock API request." }));
});

server.listen(port, "127.0.0.1");

const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
