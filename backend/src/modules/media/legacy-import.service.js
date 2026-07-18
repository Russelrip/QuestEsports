const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { posterImageDirectory } = require("../../middleware/upload");

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
];

const getContentType = (filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  return extension === ".png" ? "image/png" : "image/jpeg";
};

const getStoredFilename = (filePath) =>
  `${Date.now()}-${crypto.randomUUID()}${path.extname(filePath).toLowerCase() || ".jpg"}`;

const readLegacyAsset = async (relativeFilePath) => {
  const absolutePath = path.join(repoRoot, relativeFilePath);
  return fs.readFile(absolutePath);
};

const createLegacyPoster = async (tx, definition, buffer, onFileWritten) => {
  const originalName = path.basename(definition.filePath);
  const contentType = getContentType(definition.filePath);
  const storedFilename = getStoredFilename(definition.filePath);

  await fs.mkdir(posterImageDirectory, { recursive: true });
  await fs.writeFile(path.join(posterImageDirectory, storedFilename), buffer);
  onFileWritten(storedFilename);

  const imageAsset = await tx.imageAsset.create({
    data: {
      id: crypto.randomUUID(),
      title: definition.title,
      description: null,
      category: definition.category,
      originalName,
      storedFilename,
      contentType,
      byteSize: buffer.length,
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

  return storedFilename;
};

const importLegacyPosters = async () => {
  // Resolve every source before writing files or records. A broken deployment must
  // fail cleanly instead of leaving a half-imported poster collection.
  const sources = await Promise.all(
    legacyPosterDefinitions.map(async (definition) => ({
      definition,
      buffer: await readLegacyAsset(definition.filePath),
    }))
  );
  const existingPosters = await prisma.poster.findMany({
    where: {
      OR: legacyPosterDefinitions.map(({ title, headline }) => ({ title, headline })),
    },
    select: { title: true, headline: true },
  });
  const existingKeys = new Set(
    existingPosters.map(({ title, headline }) => `${title}\u0000${headline}`)
  );
  const pendingSources = sources.filter(
    ({ definition }) =>
      !existingKeys.has(`${definition.title}\u0000${definition.headline}`)
  );
  const writtenFilenames = [];

  try {
    await fs.mkdir(posterImageDirectory, { recursive: true });
    await prisma.$transaction(async (tx) => {
      for (const { definition, buffer } of pendingSources) {
        await createLegacyPoster(tx, definition, buffer, (filename) => {
          writtenFilenames.push(filename);
        });
      }
    });
  } catch (error) {
    await Promise.allSettled(
      writtenFilenames.map((filename) =>
        fs.unlink(path.join(posterImageDirectory, filename))
      )
    );
    throw error;
  }

  const results = sources.map(({ definition }) => ({
    status: existingKeys.has(`${definition.title}\u0000${definition.headline}`)
      ? "skipped"
      : "imported",
    title: definition.title,
  }));

  return {
    importedCount: results.filter((item) => item.status === "imported").length,
    skippedCount: results.filter((item) => item.status === "skipped").length,
    results,
  };
};

module.exports = {
  importLegacyPosters,
};
