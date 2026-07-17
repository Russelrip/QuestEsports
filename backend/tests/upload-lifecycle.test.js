const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const uploadModulePath = path.join(__dirname, "../src/middleware/upload.js");

test("createImageAssets rolls back successful files when another persistence fails", async () => {
  const servicePath = path.join(__dirname, "../src/modules/media/media.service.js");
  const removed = [];
  let uploadNumber = 0;
  const { module: mediaService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [uploadModulePath]: {
      persistPosterImageUpload: async () => {
        uploadNumber += 1;
        if (uploadNumber === 2) throw new Error("invalid second image");
        return {
          filename: "first.webp",
          contentType: "image/webp",
          byteSize: 100,
        };
      },
      removeUploadFiles: async (uploads) => removed.push(...uploads),
      posterImageDirectory: "uploads/poster-images",
    },
  });

  try {
    await assert.rejects(
      mediaService.createImageAssets({
        body: { title: "Event images" },
        files: [{ originalname: "first.webp" }, { originalname: "second.webp" }],
      }),
      /invalid second image/
    );
    assert.deepEqual(removed, [
      { directory: "uploads/poster-images", filename: "first.webp" },
    ]);
  } finally {
    restore();
  }
});

test("saveAdminGameCategory removes artwork when logo persistence fails", async () => {
  const servicePath = path.join(__dirname, "../src/modules/games/game-category.service.js");
  const removed = [];
  let uploadNumber = 0;
  const { module: gameService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        gameCategory: { findFirst: async () => null },
      },
    },
    [uploadModulePath]: {
      persistGameAssetUpload: async () => {
        uploadNumber += 1;
        if (uploadNumber === 2) throw new Error("invalid logo");
        return { filename: "artwork.webp" };
      },
      removeUploadFile: async ({ filename }) => removed.push(filename),
      gameAssetDirectory: "uploads/game-assets",
    },
  });

  try {
    await assert.rejects(
      gameService.saveAdminGameCategory({
        body: { displayName: "Valorant", slug: "valorant" },
        files: {
          artwork: [{ originalname: "artwork.webp" }],
          logo: [{ originalname: "logo.webp" }],
        },
      }),
      /invalid logo/
    );
    assert.deepEqual(removed, ["artwork.webp"]);
  } finally {
    restore();
  }
});

test("saveAdminGameCategory updates publication fields and removes replaced assets", async () => {
  const servicePath = path.join(__dirname, "../src/modules/games/game-category.service.js");
  const removed = [];
  const existing = {
    id: "game-1",
    displayName: "Old Valorant",
    slug: "valorant",
    artworkName: "old-artwork.webp",
    logoName: "old-logo.webp",
    displayOrder: 50,
    isPublished: false,
  };
  let updateData;
  const { module: gameService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        gameCategory: {
          findUnique: async () => existing,
          findFirst: async () => null,
          update: async ({ data }) => {
            updateData = data;
            return { ...existing, ...data, _count: { tournaments: 2 } };
          },
        },
      },
    },
    [uploadModulePath]: {
      persistGameAssetUpload: async () => null,
      removeUploadFile: async ({ filename }) => removed.push(filename),
      gameAssetDirectory: "uploads/game-assets",
    },
  });

  try {
    const category = await gameService.saveAdminGameCategory({
      categoryId: "game-1",
      body: {
        displayName: "Valorant",
        slug: "valorant",
        displayOrder: "10",
        isPublished: "true",
        removeArtwork: "true",
        removeLogo: "true",
      },
    });
    assert.equal(updateData.displayOrder, 10);
    assert.equal(updateData.isPublished, true);
    assert.equal(updateData.artworkName, null);
    assert.equal(updateData.logoName, null);
    assert.deepEqual(removed, ["old-artwork.webp", "old-logo.webp"]);
    assert.equal(category.tournamentCount, 2);
  } finally {
    restore();
  }
});

test("game category listing and deletion map optional artwork and logo values", async () => {
  const servicePath = path.join(__dirname, "../src/modules/games/game-category.service.js");
  const removed = [];
  const category = {
    id: "game-1",
    slug: "valorant",
    displayName: "Valorant",
    artworkName: "artwork.webp",
    logoName: "logo.webp",
    displayOrder: 10,
    isPublished: true,
  };
  const { module: gameService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        gameCategory: {
          findMany: async () => [category, { ...category, id: "game-2", artworkName: null, logoName: null }],
          findUnique: async () => category,
          delete: async () => category,
        },
      },
    },
    [uploadModulePath]: {
      persistGameAssetUpload: async () => null,
      removeUploadFile: async ({ filename }) => removed.push(filename),
      gameAssetDirectory: "uploads/game-assets",
    },
  });

  try {
    const categories = await gameService.listPublicGameCategories();
    assert.equal(categories[0].artworkUrl, "/api/uploads/game-assets/artwork.webp");
    assert.equal(categories[0].logoUrl, "/api/uploads/game-assets/logo.webp");
    assert.equal(categories[1].artworkUrl, null);
    await gameService.deleteAdminGameCategory("game-1");
    assert.deepEqual(removed, ["artwork.webp", "logo.webp"]);
  } finally {
    restore();
  }
});

test("updateAccountAvatar removes the new file when the existing-user lookup fails", async () => {
  const servicePath = path.join(__dirname, "../src/modules/account/account.service.js");
  const removed = [];
  const { module: accountService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        user: {
          findUnique: async () => {
            throw new Error("database unavailable");
          },
        },
      },
    },
    [uploadModulePath]: {
      persistAvatarUpload: async () => ({ filename: "new-avatar.webp" }),
      removeUploadFile: async ({ filename }) => removed.push(filename),
      avatarDirectory: "uploads/avatars",
    },
    [path.join(__dirname, "../src/modules/teams/team.service.js")]: {
      listProfileTeams: async () => [],
    },
    [path.join(__dirname, "../src/modules/auth/auth.service.js")]: {
      mapUserForResponse: (value) => value,
      PUBLIC_USER_SELECT: { id: true },
    },
  });

  try {
    await assert.rejects(
      accountService.updateAccountAvatar({
        user: { id: "user-1" },
        file: { originalname: "avatar.webp" },
      }),
      /database unavailable/
    );
    assert.deepEqual(removed, ["new-avatar.webp"]);
  } finally {
    restore();
  }
});
