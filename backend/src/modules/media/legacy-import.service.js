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

const getStoredFilename = (filePath) =>
  `${Date.now()}-${crypto.randomUUID()}${path.extname(filePath).toLowerCase() || ".jpg"}`;

const getImportKey = (filePath) => `legacy-poster:${filePath.toLowerCase()}`;

const readLegacyAsset = async (relativeFilePath) => {
  const absolutePath = path.join(repoRoot, relativeFilePath);
  return fs.readFile(absolutePath);
};

const repairLegacyPosterFile = async ({ poster, buffer, onFileWritten }) => {
  const storedFilename = poster.imageAsset?.storedFilename;
  if (!storedFilename) {
    return false;
  }

  if (path.basename(storedFilename) !== storedFilename) {
    throw new Error(`Invalid stored legacy poster filename: ${storedFilename}`);
  }

  const targetPath = path.join(posterImageDirectory, storedFilename);
  await fs.mkdir(posterImageDirectory, { recursive: true });

  try {
    const stats = await fs.stat(targetPath);
    if (!stats.isFile()) {
      throw new Error(`Legacy poster target is not a file: ${storedFilename}`);
    }
    return false;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    await fs.writeFile(targetPath, buffer, { flag: "wx" });
    onFileWritten(storedFilename);
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") {
      return false;
    }
    throw error;
  }
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
      importKey: getImportKey(definition.filePath),
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
  const writtenFilenames = [];
  let results = [];

  try {
    await fs.mkdir(posterImageDirectory, { recursive: true });
    await prisma.$transaction(async (tx) => {
      // Serialize the deliberately rare administrative import across API processes.
      // The stable import key remains the final database-level concurrency guard.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(718441902)`;
      const existingPosters = await tx.poster.findMany({
        where: {
          OR: [
            {
              importKey: {
                in: legacyPosterDefinitions.map(({ filePath }) =>
                  getImportKey(filePath)
                ),
              },
            },
            ...legacyPosterDefinitions.map(({ title, headline }) => ({
              title,
              headline,
            })),
          ],
        },
        select: {
          id: true,
          importKey: true,
          title: true,
          headline: true,
          imageAsset: { select: { storedFilename: true } },
        },
      });
      const existingByImportKey = new Map(
        existingPosters
          .filter((poster) => poster.importKey)
          .map((poster) => [poster.importKey, poster])
      );
      const existingByContent = new Map(
        existingPosters.map((poster) => [
          `${poster.title}\u0000${poster.headline}`,
          poster,
        ])
      );

      results = [];
      for (const { definition, buffer } of sources) {
        const importKey = getImportKey(definition.filePath);
        const existing =
          existingByImportKey.get(importKey) ||
          existingByContent.get(`${definition.title}\u0000${definition.headline}`);
        if (existing) {
          if (!existing.importKey) {
            await tx.poster.update({
              where: { id: existing.id },
              data: { importKey },
            });
          }
          const repaired = await repairLegacyPosterFile({
            poster: existing,
            buffer,
            onFileWritten: (filename) => writtenFilenames.push(filename),
          });
          results.push({
            status: repaired ? "repaired" : "skipped",
            title: definition.title,
          });
          continue;
        }

        await createLegacyPoster(tx, definition, buffer, (filename) => {
          writtenFilenames.push(filename);
        });
        results.push({ status: "imported", title: definition.title });
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

  return {
    importedCount: results.filter((item) => item.status === "imported").length,
    repairedCount: results.filter((item) => item.status === "repaired").length,
    skippedCount: results.filter((item) => item.status === "skipped").length,
    results,
  };
};

module.exports = {
  importLegacyPosters,
};
