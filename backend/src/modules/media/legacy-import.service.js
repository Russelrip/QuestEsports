const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { prisma } = require("../../lib/prisma");

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");

const legacyPosterDefinitions = [
  {
    filePath: "frontend/public/images/openwinners.jpg",
    title: "Open Tournament Winners",
    headline: "Open Tournament Winners",
    category: "poster",
    overlayAlign: "bottom-left",
  },
  {
    filePath: "frontend/public/images/open2place.jpg",
    title: "Open Tournament 2nd Place",
    headline: "Open Tournament 2nd Place",
    category: "poster",
    overlayAlign: "bottom-left",
  },
  {
    filePath: "frontend/public/images/open3place.jpg",
    title: "Open Tournament 3rd Place",
    headline: "Open Tournament 3rd Place",
    category: "poster",
    overlayAlign: "bottom-left",
  },
  {
    filePath: "frontend/public/images/appreciationpost.jpg",
    title: "Appreciation Post",
    headline: "Appreciation Post",
    category: "graphic",
    overlayAlign: "bottom-right",
  },
  {
    filePath: "frontend/public/images/openposter.jpg",
    title: "Open Tournament Poster",
    headline: "Open Tournament Poster",
    category: "poster",
    overlayAlign: "top-left",
  },
  {
    filePath: "frontend/public/images/openfinals.jpg",
    title: "Open Tournament Finals",
    headline: "Open Tournament Finals",
    category: "poster",
    overlayAlign: "bottom-left",
  },
  {
    filePath: "frontend/public/images/opensemis2.jpg",
    title: "Open Tournament Semi Finals 2",
    headline: "Open Tournament Semi Finals 2",
    category: "poster",
    overlayAlign: "bottom-left",
  },
  {
    filePath: "frontend/public/images/opensemis1.jpg",
    title: "Open Tournament Semi Finals 1",
    headline: "Open Tournament Semi Finals 1",
    category: "poster",
    overlayAlign: "bottom-left",
  },
  {
    filePath: "frontend/public/images/openbrackets.jpg",
    title: "Open Tournament Brackets",
    headline: "Open Tournament Brackets",
    category: "banner",
    overlayAlign: "top-left",
  },
  {
    filePath: "frontend/public/images/womenswinners.jpg",
    title: "Women's Tournament Winners",
    headline: "Women's Tournament Winners",
    category: "poster",
    overlayAlign: "bottom-left",
  },
  {
    filePath: "frontend/public/images/womens2place.jpg",
    title: "Women's Tournament 2nd Place",
    headline: "Women's Tournament 2nd Place",
    category: "poster",
    overlayAlign: "bottom-left",
  },
  {
    filePath: "frontend/public/images/womensbrackets.jpg",
    title: "Women's Tournament Brackets",
    headline: "Women's Tournament Brackets",
    category: "banner",
    overlayAlign: "top-left",
  },
  {
    filePath: "frontend/public/images/womensposter.jpg",
    title: "Women's Tournament Poster",
    headline: "Women's Tournament Poster",
    category: "poster",
    overlayAlign: "top-left",
  },
  {
    filePath: "frontend/public/images/womensprizepool.jpg",
    title: "Women's Prize Pool",
    headline: "Women's Prize Pool",
    category: "graphic",
    overlayAlign: "top-right",
  },
  {
    filePath: "frontend/public/images/semi2womens.jpg",
    title: "Women's Semi Finals 2",
    headline: "Women's Semi Finals 2",
    category: "poster",
    overlayAlign: "bottom-left",
  },
  {
    filePath: "frontend/public/images/semi1womens.jpg",
    title: "Women's Semi Finals 1",
    headline: "Women's Semi Finals 1",
    category: "poster",
    overlayAlign: "bottom-left",
  },
  {
    filePath: "frontend/public/images/summarywomens.jpg",
    title: "Women's Tournament Summary",
    headline: "Women's Tournament Summary",
    category: "graphic",
    overlayAlign: "top-left",
  },
];

const getContentType = (filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  return extension === ".png" ? "image/png" : "image/jpeg";
};

const readLegacyAsset = async (relativeFilePath) => {
  const absolutePath = path.join(repoRoot, relativeFilePath);

  try {
    return await fs.readFile(absolutePath);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }

    return execFileSync("git", ["show", `HEAD:${relativeFilePath.replace(/\\/g, "/")}`], {
      cwd: repoRoot,
    });
  }
};

const importLegacyPoster = async (definition) => {
  const existingPoster = await prisma.poster.findFirst({
    where: {
      title: definition.title,
      headline: definition.headline,
    },
  });

  if (existingPoster) {
    return { status: "skipped", title: definition.title };
  }

  const buffer = await readLegacyAsset(definition.filePath);
  const originalName = path.basename(definition.filePath);
  const contentType = getContentType(definition.filePath);

  await prisma.$transaction(async (tx) => {
    const imageAsset = await tx.imageAsset.create({
      data: {
        id: crypto.randomUUID(),
        title: definition.title,
        description: null,
        category: definition.category,
        originalName,
        contentType,
        data: buffer,
      },
    });

    await tx.poster.create({
      data: {
        id: crypto.randomUUID(),
        imageAssetId: imageAsset.id,
        title: definition.title,
        description: null,
        category: definition.category,
        headline: definition.headline,
        subheadline: null,
        accentColor: "#7c3aed",
        textColor: "#ffffff",
        overlayAlign: definition.overlayAlign,
      },
    });
  });

  return { status: "imported", title: definition.title };
};

const importLegacyPosters = async () => {
  const results = [];

  for (const definition of legacyPosterDefinitions) {
    const result = await importLegacyPoster(definition);
    results.push(result);
  }

  return {
    importedCount: results.filter((item) => item.status === "imported").length,
    skippedCount: results.filter((item) => item.status === "skipped").length,
    results,
  };
};

module.exports = {
  importLegacyPosters,
};
