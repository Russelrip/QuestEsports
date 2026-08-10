const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const { PrismaClient } = require("../src/generated/prisma");

const backendRoot = path.resolve(__dirname, "..");
const applyChanges = process.argv.includes("--apply");
const pruneStaleRows = process.argv.includes("--prune");

function readEnvironmentFile(filename) {
  const filePath = path.resolve(backendRoot, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing environment file: ${filePath}`);
  }
  return dotenv.parse(fs.readFileSync(filePath));
}

function requireDatabaseUrl(environment, label) {
  const value = environment.DATABASE_URL?.trim();
  if (!value) {
    throw new Error(`${label} does not define DATABASE_URL`);
  }
  return value;
}

function parseDatabaseUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} DATABASE_URL is not a valid PostgreSQL URL`);
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(`${label} DATABASE_URL must use PostgreSQL`);
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();
  if (!localHosts.has(parsed.hostname)) {
    if (sslMode && !["require", "verify-ca", "verify-full"].includes(sslMode)) {
      throw new Error(`${label} DATABASE_URL explicitly uses an unsafe TLS mode`);
    }
    if (!sslMode) {
      parsed.searchParams.set("sslmode", "require");
    }
  }

  return parsed;
}

function databaseIdentity(parsed) {
  return [parsed.protocol, parsed.hostname, parsed.port || "5432", parsed.pathname, parsed.username].join("|");
}

function extractSupabaseProjectRef(parsed) {
  const directHostMatch = parsed.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
  if (directHostMatch) return directHostMatch[1].toLowerCase();
  const poolerUserMatch = decodeURIComponent(parsed.username).match(/^postgres\.([a-z0-9]+)$/i);
  return poolerUserMatch?.[1]?.toLowerCase() || null;
}

async function readDatabaseMarker(client, label) {
  let rows;
  try {
    rows = await client.$queryRaw`
      SELECT environment, project_ref AS "projectRef", current_database() AS "databaseName"
      FROM deployment_environment
      WHERE id = 1
    `;
  } catch {
    throw new Error(
      `${label} database has no readable deployment marker. Apply migrations and configure deployment_environment first.`,
    );
  }
  if (rows.length !== 1) {
    throw new Error(`${label} database deployment marker is missing; copy refused.`);
  }
  return rows[0];
}

async function assertSafeDatabasePair({ production, staging, parsedProductionUrl, parsedStagingUrl }) {
  const [sourceMarker, targetMarker] = await Promise.all([
    readDatabaseMarker(production, "Production"),
    readDatabaseMarker(staging, "Staging"),
  ]);
  if (sourceMarker.environment !== "production") {
    throw new Error(`Source marker must be production, received ${sourceMarker.environment}.`);
  }
  if (targetMarker.environment !== "staging") {
    throw new Error(`Target marker must be staging, received ${targetMarker.environment}.`);
  }

  const sourceProjectRef = extractSupabaseProjectRef(parsedProductionUrl);
  const targetProjectRef = extractSupabaseProjectRef(parsedStagingUrl);
  if (!sourceMarker.projectRef || !targetMarker.projectRef) {
    throw new Error("Both database markers must define project_ref; copy refused.");
  }
  for (const [label, marker, urlRef] of [
    ["Production", sourceMarker, sourceProjectRef],
    ["Staging", targetMarker, targetProjectRef],
  ]) {
    if (marker.projectRef && urlRef && marker.projectRef.toLowerCase() !== urlRef) {
      throw new Error(`${label} URL does not match its configured Supabase project reference.`);
    }
  }
  const effectiveSourceRef = String(sourceMarker.projectRef).toLowerCase();
  const effectiveTargetRef = String(targetMarker.projectRef).toLowerCase();
  if (effectiveSourceRef === effectiveTargetRef) {
    throw new Error("Production and staging markers resolve to the same project; copy refused.");
  }
  if (sourceMarker.databaseName === targetMarker.databaseName && databaseIdentity(parsedProductionUrl) === databaseIdentity(parsedStagingUrl)) {
    throw new Error("Production and staging resolve to the same database; copy refused.");
  }

  return { sourceMarker, targetMarker, targetProjectRef: effectiveTargetRef };
}

function describeDatabase(parsed) {
  return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
}

function gameCategoryData(source) {
  return {
    slug: source.slug,
    displayName: source.displayName,
    artworkName: null,
    logoName: null,
    displayOrder: source.displayOrder,
    isPublished: source.isPublished,
  };
}

function eventSeriesData(source) {
  return {
    slug: source.slug,
    title: source.title,
    description: source.description,
    heroImageName: null,
    displayOrder: source.displayOrder,
    isPublished: source.isPublished,
  };
}

function rulebookData(source) {
  return {
    slug: source.slug,
    title: source.title,
    game: source.game,
    variant: source.variant,
    content: source.content,
  };
}

function tournamentData(source, references) {
  return {
    slug: source.slug,
    title: source.title,
    game: source.game,
    gameCategoryId: references.gameCategoryId,
    organizer: source.organizer,
    country: source.country,
    location: source.location,
    seriesId: references.seriesId,
    seriesOrder: source.seriesOrder,
    displayPriority: source.displayPriority,
    bannerImageName: null,
    heroImageName: null,
    scheduleFileName: null,
    scheduleData: source.scheduleData,
    completedPosterImageName: null,
    firstPlaceImageName: null,
    secondPlaceImageName: null,
    thirdPlaceImageName: null,
    shortDescription: source.shortDescription,
    fullDescription: source.fullDescription,
    rules: source.rules,
    rulebookId: references.rulebookId,
    registrationOpenAt: source.registrationOpenAt,
    startDate: source.startDate,
    startDateStatus: source.startDateStatus,
    endDate: source.endDate,
    endDateStatus: source.endDateStatus,
    registrationDeadline: source.registrationDeadline,
    registrationDeadlineStatus: source.registrationDeadlineStatus,
    format: source.format,
    registrationMode: source.registrationMode,
    entryType: source.entryType,
    teamSize: source.teamSize,
    minRosterSize: source.minRosterSize,
    maxRosterSize: source.maxRosterSize,
    maxSubstitutes: source.maxSubstitutes,
    registrationFields: source.registrationFields,
    paymentMethod: "free",
    registrationFeeAmount: 0,
    registrationFeeCurrency: source.registrationFeeCurrency,
    registrationFeeTiers: [],
    reservationMinutes: source.reservationMinutes,
    bankTransferReviewMinutes: source.bankTransferReviewMinutes,
    bankName: null,
    bankBranch: null,
    bankAccountName: null,
    bankAccountNumber: null,
    maxTeams: source.maxTeams,
    prizePool: source.prizePool,
    status: source.status,
    isPublished: source.isPublished,
    bracketLink: source.bracketLink,
    contactLink: source.contactLink,
    isFeatured: source.isFeatured,
    isActive: source.isActive,
  };
}

function sponsorData(source, tournamentId) {
  return {
    tournamentId,
    name: source.name,
    partnershipLabel: source.partnershipLabel,
    logoImageName: null,
    websiteUrl: source.websiteUrl,
    displayOrder: source.displayOrder,
  };
}

function productData(source) {
  return {
    slug: source.slug,
    name: source.name,
    description: source.description,
    currency: source.currency,
    status: source.status,
    madeToOrder: source.madeToOrder,
    displayOrder: source.displayOrder,
  };
}

function productVariantData(source, productId) {
  return {
    productId,
    sku: source.sku,
    name: source.name,
    size: source.size,
    color: source.color,
    price: source.price,
    stock: null,
    isActive: source.isActive,
  };
}

function ticketEventData(source) {
  return {
    slug: source.slug,
    title: source.title,
    description: source.description,
    venue: source.venue,
    startsAt: source.startsAt,
    salesStartAt: source.salesStartAt,
    salesEndAt: source.salesEndAt,
    status: source.status,
    capacity: source.capacity,
    maxTicketsPerOrder: source.maxTicketsPerOrder,
    currency: source.currency,
    singlePrice: source.singlePrice,
    pairPrice: source.pairPrice,
  };
}

async function readPublicSourceData(production) {
  const tournaments = await production.tournament.findMany({
    where: { isPublished: true },
    include: { sponsors: { orderBy: { displayOrder: "asc" } } },
    orderBy: { createdAt: "asc" },
  });

  const gameCategoryIds = tournaments.map((item) => item.gameCategoryId).filter(Boolean);
  const seriesIds = tournaments.map((item) => item.seriesId).filter(Boolean);
  const rulebookIds = tournaments.map((item) => item.rulebookId).filter(Boolean);

  const [gameCategories, eventSeries, rulebooks, products, ticketEvents] = await Promise.all([
    production.gameCategory.findMany({
      where: { OR: [{ isPublished: true }, { id: { in: gameCategoryIds } }] },
      orderBy: { displayOrder: "asc" },
    }),
    production.eventSeries.findMany({
      where: { OR: [{ isPublished: true }, { id: { in: seriesIds } }] },
      orderBy: { displayOrder: "asc" },
    }),
    production.rulebook.findMany({
      where: { id: { in: rulebookIds } },
      orderBy: { createdAt: "asc" },
    }),
    production.product.findMany({
      where: { status: "active" },
      include: { variants: { where: { isActive: true }, orderBy: { createdAt: "asc" } } },
      orderBy: { displayOrder: "asc" },
    }),
    production.ticketEvent.findMany({
      where: { status: { not: "draft" } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return { gameCategories, eventSeries, rulebooks, tournaments, products, ticketEvents };
}

function sourceCounts(data) {
  return {
    gameCategories: data.gameCategories.length,
    eventSeries: data.eventSeries.length,
    rulebooks: data.rulebooks.length,
    tournaments: data.tournaments.length,
    tournamentSponsors: data.tournaments.reduce((sum, item) => sum + item.sponsors.length, 0),
    products: data.products.length,
    productVariants: data.products.reduce((sum, item) => sum + item.variants.length, 0),
    ticketEvents: data.ticketEvents.length,
  };
}

async function stagingCounts(staging) {
  const [gameCategories, eventSeries, rulebooks, tournaments, tournamentSponsors, products, productVariants, ticketEvents] =
    await Promise.all([
      staging.gameCategory.count(),
      staging.eventSeries.count(),
      staging.rulebook.count(),
      staging.tournament.count(),
      staging.tournamentSponsor.count(),
      staging.product.count(),
      staging.productVariant.count(),
      staging.ticketEvent.count(),
    ]);
  return { gameCategories, eventSeries, rulebooks, tournaments, tournamentSponsors, products, productVariants, ticketEvents };
}

async function copyPublicData(staging, data) {
  await staging.$transaction(
    async (database) => {
      const gameCategoryIds = new Map();
      for (const source of data.gameCategories) {
        const values = gameCategoryData(source);
        const target = await database.gameCategory.upsert({
          where: { slug: source.slug },
          create: values,
          update: values,
        });
        gameCategoryIds.set(source.id, target.id);
      }

      const eventSeriesIds = new Map();
      for (const source of data.eventSeries) {
        const values = eventSeriesData(source);
        const target = await database.eventSeries.upsert({
          where: { slug: source.slug },
          create: values,
          update: values,
        });
        eventSeriesIds.set(source.id, target.id);
      }

      const rulebookIds = new Map();
      for (const source of data.rulebooks) {
        const values = rulebookData(source);
        const target = await database.rulebook.upsert({
          where: { slug: source.slug },
          create: values,
          update: values,
        });
        rulebookIds.set(source.id, target.id);
      }

      for (const source of data.tournaments) {
        const values = tournamentData(source, {
          gameCategoryId: gameCategoryIds.get(source.gameCategoryId) || null,
          seriesId: eventSeriesIds.get(source.seriesId) || null,
          rulebookId: rulebookIds.get(source.rulebookId) || null,
        });
        const tournament = await database.tournament.upsert({
          where: { slug: source.slug },
          create: values,
          update: values,
        });

        for (const sponsor of source.sponsors) {
          const valuesForSponsor = sponsorData(sponsor, tournament.id);
          const existing = await database.tournamentSponsor.findFirst({
            where: {
              tournamentId: tournament.id,
              name: sponsor.name,
              partnershipLabel: sponsor.partnershipLabel,
            },
          });
          if (existing) {
            await database.tournamentSponsor.update({ where: { id: existing.id }, data: valuesForSponsor });
          } else {
            await database.tournamentSponsor.create({ data: valuesForSponsor });
          }
        }
      }

      for (const source of data.products) {
        const values = productData(source);
        const product = await database.product.upsert({
          where: { slug: source.slug },
          create: values,
          update: values,
        });
        for (const variant of source.variants) {
          const valuesForVariant = productVariantData(variant, product.id);
          await database.productVariant.upsert({
            where: { sku: variant.sku },
            create: valuesForVariant,
            update: valuesForVariant,
          });
        }
      }

      for (const source of data.ticketEvents) {
        const values = ticketEventData(source);
        await database.ticketEvent.upsert({
          where: { slug: source.slug },
          create: values,
          update: values,
        });
      }

      if (pruneStaleRows) {
        const tournamentSlugs = data.tournaments.map((item) => item.slug);
        const productSlugs = data.products.map((item) => item.slug);
        const ticketEventSlugs = data.ticketEvents.map((item) => item.slug);
        await database.tournament.deleteMany({ where: { slug: { notIn: tournamentSlugs } } });
        await database.product.deleteMany({ where: { slug: { notIn: productSlugs } } });
        await database.ticketEvent.deleteMany({ where: { slug: { notIn: ticketEventSlugs } } });
      }
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}

async function main() {
  const productionEnvironment = readEnvironmentFile(process.env.PRODUCTION_ENV_FILE || ".env");
  const stagingEnvironment = readEnvironmentFile(process.env.STAGING_ENV_FILE || ".env.staging.local");
  const parsedProductionUrl = parseDatabaseUrl(
    requireDatabaseUrl(productionEnvironment, "Production environment"),
    "Production",
  );
  const parsedStagingUrl = parseDatabaseUrl(
    requireDatabaseUrl(stagingEnvironment, "Staging environment"),
    "Staging",
  );

  if (databaseIdentity(parsedProductionUrl) === databaseIdentity(parsedStagingUrl)) {
    throw new Error("Production and staging resolve to the same database identity; copy refused");
  }

  const production = new PrismaClient({ datasourceUrl: parsedProductionUrl.toString() });
  const staging = new PrismaClient({ datasourceUrl: parsedStagingUrl.toString() });

  try {
    const { targetProjectRef } = await assertSafeDatabasePair({
      production,
      staging,
      parsedProductionUrl,
      parsedStagingUrl,
    });
    const data = await readPublicSourceData(production);
    console.log(`Source: ${describeDatabase(parsedProductionUrl)}`);
    console.log(`Target: ${describeDatabase(parsedStagingUrl)}`);
    console.log("Safe public rows available:", sourceCounts(data));
    console.log("Current staging rows:", await stagingCounts(staging));

    if (!applyChanges) {
      console.log("Dry run only. Re-run with --apply to upsert the sanitized public rows into staging.");
      return;
    }

    const expectedConfirmation = `${pruneStaleRows ? "PRUNE_AND_COPY" : "COPY"}_PRODUCTION_TO_STAGING:${targetProjectRef}`;
    if (process.env.STAGING_COPY_CONFIRMATION !== expectedConfirmation) {
      throw new Error(`Set STAGING_COPY_CONFIRMATION=${expectedConfirmation} for this operation.`);
    }

    await copyPublicData(staging, data);
    console.log("Staging rows after copy:", await stagingCounts(staging));
    console.log("Copy complete. No users, sessions, registrations, payments, orders, tickets, private files, or tokens were read.");
  } finally {
    await Promise.allSettled([production.$disconnect(), staging.$disconnect()]);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Public staging-data copy failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseDatabaseUrl,
  databaseIdentity,
  extractSupabaseProjectRef,
  assertSafeDatabasePair,
};
