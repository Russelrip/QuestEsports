const crypto = require("crypto");
const { Prisma } = require("../../generated/prisma");
const { env } = require("../../config/env");
const { prisma } = require("../../lib/prisma");
const { recordAuditInTransaction } = require("../../lib/audit");
const { HttpError } = require("../../lib/http-error");
const {
  normalizeInteger,
  normalizeSlug,
  normalizeText,
  isValidEmail,
} = require("../../lib/validation");
const {
  assertPayHereConfigured,
  createPayHereCheckout,
} = require("../payments/payment.service");

const EVENT_STATUSES = new Set([
  "draft",
  "on_sale",
  "sales_paused",
  "sales_closed",
  "completed",
  "cancelled",
]);
const ACTIVE_ORDER_STATUSES = ["pending_payment", "paid"];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_TOKEN_PATTERN = /^[a-f0-9]{48}$/i;
const QR_PATTERN = /^QET1\.([0-9a-f-]{36})\.(\d+)\.([A-Za-z0-9_-]{43})$/;
const RETRYABLE_TRANSACTION_CODES = new Set([
  "P2024",
  "P2028",
  "P2034",
  "P2037",
]);
const TICKET_PAYMENT_METHODS = new Set(["payhere", "bank_transfer", "cash"]);
const ticketSeriesSelect = {
  id: true,
  slug: true,
  title: true,
  isPublished: true,
};

const runSerializable = async (work) => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 20_000,
      });
    } catch (error) {
      if (!RETRYABLE_TRANSACTION_CODES.has(error?.code) || attempt === 3)
        throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
  throw new Error("Ticket transaction retry limit was exhausted.");
};

const decimal = (value, label) => {
  try {
    const parsed = new Prisma.Decimal(value);
    if (parsed.isNegative() || parsed.gt("9999999999.99")) throw new Error();
    return parsed;
  } catch {
    throw new HttpError(400, `${label} is invalid.`);
  }
};

const calculateTicketPrice = ({ quantity, singlePrice, pairPrice }) => {
  const normalizedQuantity = normalizeInteger(quantity);
  if (
    !normalizedQuantity ||
    normalizedQuantity < 1 ||
    normalizedQuantity > 100
  ) {
    throw new HttpError(400, "Choose a valid ticket quantity.");
  }
  const pairCount = Math.floor(normalizedQuantity / 2);
  const singleCount = normalizedQuantity % 2;
  const normalizedSinglePrice = new Prisma.Decimal(singlePrice);
  const normalizedPairPrice = new Prisma.Decimal(pairPrice);
  return {
    quantity: normalizedQuantity,
    pairCount,
    singleCount,
    singlePrice: normalizedSinglePrice,
    pairPrice: normalizedPairPrice,
    total: normalizedPairPrice
      .mul(pairCount)
      .plus(normalizedSinglePrice.mul(singleCount)),
  };
};

const getQrKey = () => {
  if (!/^[a-f0-9]{64}$/i.test(env.AUTH_ENCRYPTION_KEY || "")) {
    throw new Error("AUTH_ENCRYPTION_KEY is required to sign ticket QR codes.");
  }
  return Buffer.from(env.AUTH_ENCRYPTION_KEY, "hex");
};

const signQrValue = (ticketId, tokenVersion) =>
  crypto
    .createHmac("sha256", getQrKey())
    .update(`ticket:${ticketId}:v${tokenVersion}`)
    .digest("base64url");

const buildQrPayload = (ticket) =>
  `QET1.${ticket.id}.${ticket.tokenVersion}.${signQrValue(ticket.id, ticket.tokenVersion)}`;

const parseQrPayload = (payload) => {
  const match = QR_PATTERN.exec(String(payload || "").trim());
  if (!match || !UUID_PATTERN.test(match[1])) return null;
  const tokenVersion = Number(match[2]);
  if (!Number.isSafeInteger(tokenVersion) || tokenVersion < 1) return null;
  const expected = signQrValue(match[1], tokenVersion);
  const received = match[3];
  if (
    received.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  ) {
    return null;
  }
  return { ticketId: match[1], tokenVersion };
};

const activeOrderWhere = (now = new Date()) => ({
  OR: [
    { status: "paid" },
    {
      status: "pending_payment",
      capacityReleasedAt: null,
      expiresAt: { gt: now },
    },
  ],
});

const getReservedQuantity = async (db, eventId, now = new Date()) => {
  const result = await db.ticketOrder.aggregate({
    where: { eventId, ...activeOrderWhere(now) },
    _sum: { quantity: true },
  });
  return result._sum.quantity || 0;
};

const mapPublicEvent = (event, reservedQuantity = 0) => {
  const now = new Date();
  const salesActive =
    event.status === "on_sale" &&
    event.salesStartAt <= now &&
    event.salesEndAt > now &&
    reservedQuantity < event.capacity;
  return {
    id: event.id,
    seriesId: event.seriesId || null,
    series: event.series
      ? {
          id: event.series.id,
          slug: event.series.slug,
          title: event.series.title,
        }
      : null,
    slug: event.slug,
    title: event.title,
    description: event.description,
    venue: event.venue,
    startsAt: event.startsAt,
    salesStartAt: event.salesStartAt,
    salesEndAt: event.salesEndAt,
    status: event.status,
    capacity: event.capacity,
    availableTickets: Math.max(event.capacity - reservedQuantity, 0),
    maxTicketsPerOrder: event.maxTicketsPerOrder,
    currency: event.currency,
    singlePrice: Number(event.singlePrice),
    pairPrice: Number(event.pairPrice),
    paymentMethods: Array.isArray(event.paymentMethods)
      ? event.paymentMethods.filter((method) => TICKET_PAYMENT_METHODS.has(method))
      : ["payhere"],
    salesActive,
  };
};

const listPublicEvents = async () => {
  const now = new Date();
  const events = await prisma.ticketEvent.findMany({
    where: {
      status: { in: ["on_sale", "sales_paused", "sales_closed"] },
      startsAt: { gt: now },
      series: { is: { isPublished: true } },
    },
    orderBy: { startsAt: "asc" },
    include: { series: { select: ticketSeriesSelect } },
  });
  const groupedQuantities = events.length
    ? await prisma.ticketOrder.groupBy({
        by: ["eventId"],
        where: { eventId: { in: events.map((event) => event.id) }, ...activeOrderWhere(now) },
        _sum: { quantity: true },
      })
    : [];
  const quantityByEvent = new Map(
    groupedQuantities.map((entry) => [entry.eventId, entry._sum.quantity || 0]),
  );
  return events.map((event) => mapPublicEvent(event, quantityByEvent.get(event.id) || 0));
};

const getPublicEvent = async (slug) => {
  const event = await prisma.ticketEvent.findUnique({
    where: { slug: normalizeSlug(slug) },
    include: { series: { select: ticketSeriesSelect } },
  });
  if (!event || event.status === "draft" || !event.series?.isPublished)
    throw new HttpError(404, "Ticketed event not found.");
  return mapPublicEvent(event, await getReservedQuantity(prisma, event.id));
};

const getPublicEventForSeries = async (seriesId) => {
  const event = await prisma.ticketEvent.findUnique({
    where: { seriesId },
    include: { series: { select: ticketSeriesSelect } },
  });
  if (
    !event ||
    !event.series?.isPublished ||
    !["on_sale", "sales_paused", "sales_closed"].includes(event.status) ||
    event.startsAt <= new Date()
  ) {
    return null;
  }
  return mapPublicEvent(event, await getReservedQuantity(prisma, event.id));
};

const getTicketQuote = async ({ slug, quantity }) => {
  const event = await getPublicEvent(slug);
  if (quantity > event.maxTicketsPerOrder) {
    throw new HttpError(
      400,
      `A single order can contain up to ${event.maxTicketsPerOrder} tickets.`,
    );
  }
  const pricing = calculateTicketPrice({
    quantity,
    singlePrice: event.singlePrice,
    pairPrice: event.pairPrice,
  });
  if (pricing.quantity > event.availableTickets) {
    throw new HttpError(409, "That many tickets are no longer available.");
  }
  return {
    quantity: pricing.quantity,
    pairCount: pricing.pairCount,
    singleCount: pricing.singleCount,
    singlePrice: Number(pricing.singlePrice),
    pairPrice: Number(pricing.pairPrice),
    total: pricing.total.toNumber(),
    currency: event.currency,
  };
};

const validateBuyer = (body, user) => {
  const email = normalizeText(body.email || user?.email).toLowerCase();
  const firstName = normalizeText(body.firstName || user?.firstName);
  const lastName = normalizeText(body.lastName || user?.lastName);
  const phone = normalizeText(body.phone || user?.phone);
  if (!isValidEmail(email) || !firstName || !lastName || !phone) {
    throw new HttpError(400, "Complete all ticket buyer fields.");
  }
  if (
    email.length > 254 ||
    firstName.length > 100 ||
    lastName.length > 100 ||
    phone.length > 50
  ) {
    throw new HttpError(
      400,
      "One or more buyer fields exceed the allowed length.",
    );
  }
  return { email, firstName, lastName, phone };
};

const createTicketOrder = async ({ slug, body, user }) => {
  const buyer = validateBuyer(body, user);
  const paymentMethod = normalizeText(body.paymentMethod || "payhere").toLowerCase();
  if (!TICKET_PAYMENT_METHODS.has(paymentMethod))
    throw new HttpError(400, "Choose a valid entrance-fee payment method.");
  if (paymentMethod === "payhere") assertPayHereConfigured();
  const expectedCurrency = normalizeText(body.expectedCurrency).toUpperCase();
  const expectedTotal = decimal(body.expectedTotal, "Expected total");
  const eventSlug = normalizeSlug(slug);
  const orderId = crypto.randomUUID();
  const publicToken = crypto.randomBytes(24).toString("hex");
  const providerOrderId = `TICKET-${paymentMethod === "bank_transfer" ? "BANK" : paymentMethod === "cash" ? "CASH" : "PAYHERE"}-${crypto.randomUUID()}`;

  const created = await runSerializable(async (tx) => {
    const event = await tx.ticketEvent.findUnique({
      where: { slug: eventSlug },
    });
    if (!event) throw new HttpError(404, "Ticketed event not found.");
    const availablePaymentMethods = Array.isArray(event.paymentMethods)
      ? event.paymentMethods
      : ["payhere"];
    if (!availablePaymentMethods.includes(paymentMethod)) {
      throw new HttpError(409, "That payment method is not available for this event.");
    }
    if (
      paymentMethod === "bank_transfer" &&
      (!event.bankName || !event.bankAccountName || !event.bankAccountNumber)
    ) {
      throw new HttpError(503, "Bank transfer is not fully configured for this event.");
    }
    const now = new Date();
    if (
      event.status !== "on_sale" ||
      event.salesStartAt > now ||
      event.salesEndAt <= now
    ) {
      throw new HttpError(
        409,
        "Ticket sales are not currently open for this event.",
      );
    }
    const pricing = calculateTicketPrice({
      quantity: body.quantity,
      singlePrice: event.singlePrice,
      pairPrice: event.pairPrice,
    });
    if (pricing.quantity > event.maxTicketsPerOrder) {
      throw new HttpError(
        400,
        `A single order can contain up to ${event.maxTicketsPerOrder} tickets.`,
      );
    }
    if (
      !expectedTotal.equals(pricing.total) ||
      expectedCurrency !== event.currency
    ) {
      throw new HttpError(
        409,
        "Ticket pricing changed. Review the updated total before continuing.",
      );
    }
    const reserved = await getReservedQuantity(tx, event.id, now);
    if (reserved + pricing.quantity > event.capacity) {
      throw new HttpError(409, "That many tickets are no longer available.");
    }
    const expiresAt = new Date(
      now.getTime() + env.TICKET_ORDER_RESERVATION_MINUTES * 60_000,
    );
    const order = await tx.ticketOrder.create({
      data: {
        id: orderId,
        publicToken,
        eventId: event.id,
        userId: user?.id || null,
        ...buyer,
        quantity: pricing.quantity,
        pairCount: pricing.pairCount,
        singleCount: pricing.singleCount,
        pairPrice: pricing.pairPrice,
        singlePrice: pricing.singlePrice,
        currency: event.currency,
        total: pricing.total,
        expiresAt,
      },
    });
    const tickets = Array.from({ length: pricing.quantity }, (_, index) => {
      const id = crypto.randomUUID();
      return {
        id,
        ticketNumber: `QES-${id.replace(/-/g, "").slice(0, 12).toUpperCase()}`,
        orderId,
        eventId: event.id,
        sequence: index + 1,
      };
    });
    await tx.ticket.createMany({ data: tickets });
    const payment = await tx.paymentTransaction.create({
      data: {
        id: crypto.randomUUID(),
        purpose: "ticket_order",
        status: paymentMethod === "payhere" ? "created" : "pending",
        provider: paymentMethod,
        method: paymentMethod,
        statusMessage:
          paymentMethod === "bank_transfer"
            ? "Awaiting bank-transfer proof."
            : paymentMethod === "cash"
              ? "Cash payment must be confirmed by Quest staff."
              : null,
        providerOrderId,
        ticketOrderId: orderId,
        amount: pricing.total,
        currency: event.currency,
      },
    });
    return { event, order, payment, pricing };
  });

  const orderPath = `/tickets/order#token=${encodeURIComponent(publicToken)}`;
  const checkout =
    paymentMethod === "payhere"
      ? (() => {
          assertPayHereConfigured();
          return createPayHereCheckout({
            transaction: created.payment,
            customer: {
              ...buyer,
              address: "Not applicable",
              city: "Colombo",
              country: "Sri Lanka",
            },
            items: `${created.pricing.quantity} ticket${created.pricing.quantity === 1 ? "" : "s"} for ${created.event.title}`,
            returnPath: orderPath,
            cancelPath: `/tickets/order?cancelled=1#token=${encodeURIComponent(publicToken)}`,
          });
        })()
      : null;
  return {
    order: {
      id: orderId,
      publicToken,
      quantity: created.pricing.quantity,
      total: created.pricing.total.toNumber(),
      currency: created.event.currency,
      status: created.order.status,
      expiresAt: created.order.expiresAt,
    },
    paymentOrderId: providerOrderId,
    checkout,
    orderPath,
  };
};

const expireTicketOrderReservation = async ({ orderId, now = new Date() }) =>
  prisma.$transaction(async (tx) => {
    const released = await tx.ticketOrder.updateMany({
      where: {
        id: orderId,
        status: "pending_payment",
        capacityReleasedAt: null,
        expiresAt: { lte: now },
      },
      data: { status: "expired", capacityReleasedAt: now },
    });
    if (!released.count) return false;
    await tx.ticket.updateMany({
      where: { orderId, status: "pending" },
      data: { status: "cancelled" },
    });
    await tx.paymentTransaction.updateMany({
      where: {
        ticketOrderId: orderId,
        status: { in: ["created", "pending", "review_required"] },
      },
      data: {
        status: "expired",
        statusMessage:
          "The ticket payment window expired and the capacity reservation was released.",
      },
    });
    return true;
  });

const mapTicket = (ticket, includeQr = false) => ({
  id: ticket.id,
  ticketNumber: ticket.ticketNumber,
  sequence: ticket.sequence,
  status: ticket.status,
  checkedInAt: ticket.checkedInAt,
  checkedInBy: ticket.checkedInBy
    ? `${ticket.checkedInBy.firstName} ${ticket.checkedInBy.lastName}`.trim()
    : null,
  ...(includeQr ? { qrPayload: buildQrPayload(ticket) } : {}),
});

const loadOrderByToken = (publicToken) =>
  prisma.ticketOrder.findUnique({
    where: { publicToken },
    include: {
      event: true,
      tickets: {
        orderBy: { sequence: "asc" },
        include: {
          checkedInBy: { select: { firstName: true, lastName: true } },
        },
      },
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

const getTicketOrderByToken = async (rawToken) => {
  const publicToken = String(rawToken || "").trim();
  if (!PUBLIC_TOKEN_PATTERN.test(publicToken))
    throw new HttpError(404, "Ticket order not found.");
  let order = await loadOrderByToken(publicToken);
  if (!order) throw new HttpError(404, "Ticket order not found.");
  if (
    order.status === "pending_payment" &&
    !order.capacityReleasedAt &&
    order.expiresAt <= new Date()
  ) {
    await expireTicketOrderReservation({ orderId: order.id });
    order = await loadOrderByToken(publicToken);
  }
  const canShowQr = order.status === "paid";
  return {
    id: order.id,
    status: order.status,
    quantity: order.quantity,
    pairCount: order.pairCount,
    singleCount: order.singleCount,
    pairPrice: Number(order.pairPrice),
    singlePrice: Number(order.singlePrice),
    currency: order.currency,
    total: Number(order.total),
    createdAt: order.createdAt,
    expiresAt: order.expiresAt,
    paymentOrderId: order.payments[0]?.providerOrderId || null,
    paymentStatus: order.payments[0]?.status || "created",
    buyer: {
      firstName: order.firstName,
      lastName: order.lastName,
      email: order.email,
    },
    event: mapPublicEvent(order.event),
    tickets: order.tickets.map((ticket) => mapTicket(ticket, canShowQr)),
  };
};

const parseEventInput = (body, existing) => {
  const seriesId = normalizeText(body.seriesId ?? existing?.seriesId) || null;
  const title = normalizeText(body.title ?? existing?.title);
  const slug = normalizeSlug(body.slug ?? title ?? existing?.slug);
  const description = normalizeText(body.description ?? existing?.description);
  const venue = normalizeText(body.venue ?? existing?.venue);
  const status = normalizeText(
    body.status ?? existing?.status ?? "draft",
  ).toLowerCase();
  const capacity = normalizeInteger(body.capacity ?? existing?.capacity);
  const maxTicketsPerOrder = normalizeInteger(
    body.maxTicketsPerOrder ?? existing?.maxTicketsPerOrder ?? 10,
  );
  const currency = normalizeText(
    body.currency ?? existing?.currency ?? "LKR",
  ).toUpperCase();
  const startsAt = new Date(body.startsAt ?? existing?.startsAt);
  const salesStartAt = new Date(body.salesStartAt ?? existing?.salesStartAt);
  const salesEndAt = new Date(body.salesEndAt ?? existing?.salesEndAt);
  const singlePrice = decimal(
    body.singlePrice ?? existing?.singlePrice,
    "Single-ticket price",
  );
  const pairPrice = decimal(
    body.pairPrice ?? existing?.pairPrice,
    "Pair price",
  );
  let paymentMethods = body.paymentMethods ?? existing?.paymentMethods ?? ["payhere"];
  if (typeof paymentMethods === "string") {
    try {
      paymentMethods = JSON.parse(paymentMethods);
    } catch {
      paymentMethods = paymentMethods.split(",");
    }
  }
  paymentMethods = Array.from(
    new Set(
      (Array.isArray(paymentMethods) ? paymentMethods : [])
        .map((method) => normalizeText(method).toLowerCase())
        .filter(Boolean),
    ),
  );
  if (
    !paymentMethods.length ||
    paymentMethods.some((method) => !TICKET_PAYMENT_METHODS.has(method))
  ) {
    throw new HttpError(400, "Choose at least one valid payment method.");
  }
  const bankTransferReviewMinutes = normalizeInteger(
    body.bankTransferReviewMinutes ?? existing?.bankTransferReviewMinutes ?? 1440,
  );
  const bankName = normalizeText(body.bankName ?? existing?.bankName) || null;
  const bankBranch = normalizeText(body.bankBranch ?? existing?.bankBranch) || null;
  const bankAccountName =
    normalizeText(body.bankAccountName ?? existing?.bankAccountName) || null;
  const bankAccountNumber =
    normalizeText(body.bankAccountNumber ?? existing?.bankAccountNumber) || null;
  if (
    paymentMethods.includes("bank_transfer") &&
    (!bankName || !bankAccountName || !bankAccountNumber)
  ) {
    throw new HttpError(400, "Complete the bank account details for bank transfers.");
  }
  if (!bankTransferReviewMinutes || bankTransferReviewMinutes > 10080)
    throw new HttpError(400, "Bank-transfer review time is invalid.");
  if (!seriesId)
    throw new HttpError(400, "Choose the LAN event for this entrance fee.");
  if (!title || !slug || !description || !venue)
    throw new HttpError(400, "Complete all event details.");
  if (
    title.length > 200 ||
    slug.length > 200 ||
    venue.length > 300 ||
    description.length > 10_000
  ) {
    throw new HttpError(
      400,
      "One or more event fields exceed the allowed length.",
    );
  }
  if (!EVENT_STATUSES.has(status))
    throw new HttpError(400, "Ticket event status is invalid.");
  if (
    !capacity ||
    capacity > 1_000_000 ||
    !maxTicketsPerOrder ||
    maxTicketsPerOrder > 100
  ) {
    throw new HttpError(400, "Event capacity or order limit is invalid.");
  }
  if (!/^[A-Z]{3}$/.test(currency))
    throw new HttpError(400, "Currency must use a three-letter code.");
  if (
    [startsAt, salesStartAt, salesEndAt].some((date) =>
      Number.isNaN(date.getTime()),
    )
  ) {
    throw new HttpError(400, "Event and sales dates are required.");
  }
  if (
    salesEndAt <= salesStartAt ||
    startsAt <= salesStartAt ||
    salesEndAt > startsAt
  ) {
    throw new HttpError(
      400,
      "Sales must end after they start and before the event begins.",
    );
  }
  return {
    seriesId,
    title,
    slug,
    description,
    venue,
    status,
    capacity,
    maxTicketsPerOrder,
    currency,
    startsAt,
    salesStartAt,
    salesEndAt,
    singlePrice,
    pairPrice,
    paymentMethods,
    bankTransferReviewMinutes,
    bankName,
    bankBranch,
    bankAccountName,
    bankAccountNumber,
  };
};

const saveAdminEvent = async ({ eventId, body, auditContext = {} }) => {
  const existing = eventId
    ? await prisma.ticketEvent.findUnique({ where: { id: eventId } })
    : null;
  if (eventId && !existing)
    throw new HttpError(404, "Ticketed event not found.");
  const data = parseEventInput(body, existing);
  const series = await prisma.eventSeries.findUnique({
    where: { id: data.seriesId },
    select: { id: true },
  });
  if (!series) throw new HttpError(400, "The selected LAN event was not found.");
  const duplicate = await prisma.ticketEvent.findFirst({
    where: { slug: data.slug, ...(eventId ? { id: { not: eventId } } : {}) },
    select: { id: true },
  });
  if (duplicate)
    throw new HttpError(400, "Another ticketed event already uses this slug.");
  const linkedEvent = await prisma.ticketEvent.findFirst({
    where: {
      seriesId: data.seriesId,
      ...(eventId ? { id: { not: eventId } } : {}),
    },
    select: { id: true },
  });
  if (linkedEvent)
    throw new HttpError(400, "This LAN event already has an entrance fee.");
  if (
    existing &&
    data.capacity < (await getReservedQuantity(prisma, existing.id))
  ) {
    throw new HttpError(
      409,
      "Capacity cannot be lower than the number of reserved and paid tickets.",
    );
  }
  const persist = (database) => eventId
    ? database.ticketEvent.update({
        where: { id: eventId },
        data,
        include: { series: { select: ticketSeriesSelect } },
      })
    : database.ticketEvent.create({
        data: { id: crypto.randomUUID(), ...data },
        include: { series: { select: ticketSeriesSelect } },
      });
  const event = auditContext.actorUserId || auditContext.requestId || auditContext.ipAddress
    ? await prisma.$transaction(async (tx) => {
      const saved = await persist(tx);
      await recordAuditInTransaction(tx, {
        ...auditContext,
        action: eventId ? "ticket.event.updated" : "ticket.event.created",
        targetType: "TicketEvent",
        targetId: saved.id,
        beforeData: existing ? { status: existing.status, capacity: existing.capacity, slug: existing.slug } : undefined,
        afterData: { status: saved.status, capacity: saved.capacity, slug: saved.slug },
      });
      return saved;
    })
    : await persist(prisma);
  return mapAdminEvent(event, await getEventStats(event.id));
};

const getEventStats = async (eventId) => {
  const [orders, ticketStatuses, revenue] = await prisma.$transaction([
    prisma.ticketOrder.groupBy({
      by: ["status"],
      where: { eventId },
      _count: { _all: true },
      _sum: { quantity: true },
    }),
    prisma.ticket.groupBy({
      by: ["status"],
      where: { eventId },
      _count: { _all: true },
    }),
    prisma.ticketOrder.aggregate({
      where: { eventId, status: "paid" },
      _sum: { total: true, quantity: true },
    }),
  ]);
  const byOrderStatus = Object.fromEntries(
    orders.map((row) => [row.status, row._count._all]),
  );
  const byTicketStatus = Object.fromEntries(
    ticketStatuses.map((row) => [row.status, row._count._all]),
  );
  const reserved = await getReservedQuantity(prisma, eventId);
  return {
    orders: byOrderStatus,
    tickets: byTicketStatus,
    sold: revenue._sum.quantity || 0,
    checkedIn: byTicketStatus.checked_in || 0,
    revenue: Number(revenue._sum.total || 0),
    reserved,
  };
};

const mapAdminEvent = (event, stats) => ({
  ...mapPublicEvent(event, stats.reserved || 0),
  bankTransferReviewMinutes: event.bankTransferReviewMinutes,
  bankName: event.bankName,
  bankBranch: event.bankBranch,
  bankAccountName: event.bankAccountName,
  bankAccountNumber: event.bankAccountNumber,
  stats,
  createdAt: event.createdAt,
  updatedAt: event.updatedAt,
});

const listAdminEvents = async () => {
  const events = await prisma.ticketEvent.findMany({
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    include: { series: { select: ticketSeriesSelect } },
  });
  return Promise.all(
    events.map(async (event) =>
      mapAdminEvent(event, await getEventStats(event.id)),
    ),
  );
};

const getAdminEvent = async (eventId) => {
  const event = await prisma.ticketEvent.findUnique({
    where: { id: eventId },
    include: { series: { select: ticketSeriesSelect } },
  });
  if (!event) throw new HttpError(404, "Ticketed event not found.");
  return mapAdminEvent(event, await getEventStats(event.id));
};

const buildPagination = (query, maximum = 100) => {
  const page = Math.max(normalizeInteger(query.page) || 1, 1);
  const pageSize = Math.min(
    Math.max(normalizeInteger(query.pageSize) || 25, 1),
    maximum,
  );
  return { page, pageSize, skip: (page - 1) * pageSize };
};

const listAdminOrders = async ({ eventId, query = {} }) => {
  await getAdminEvent(eventId);
  const { page, pageSize, skip } = buildPagination(query);
  const search = normalizeText(query.search);
  const status = normalizeText(query.status).toLowerCase();
  const textFilter = { contains: search, mode: "insensitive" };
  const where = {
    eventId,
    ...(ACTIVE_ORDER_STATUSES.concat([
      "cancelled",
      "expired",
      "refunded",
    ]).includes(status)
      ? { status }
      : {}),
    ...(search
      ? {
          OR: [
            { email: textFilter },
            { firstName: textFilter },
            { lastName: textFilter },
            { phone: textFilter },
            { publicToken: { contains: search } },
            { tickets: { some: { ticketNumber: textFilter } } },
          ],
        }
      : {}),
  };
  const [total, orders] = await prisma.$transaction([
    prisma.ticketOrder.count({ where }),
    prisma.ticketOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        payments: { orderBy: { createdAt: "desc" }, take: 1 },
        tickets: { orderBy: { sequence: "asc" } },
      },
    }),
  ]);
  return {
    items: orders.map((order) => ({
      id: order.id,
      status: order.status,
      buyerName: `${order.firstName} ${order.lastName}`.trim(),
      email: order.email,
      phone: order.phone,
      quantity: order.quantity,
      total: Number(order.total),
      currency: order.currency,
      paymentStatus: order.payments[0]?.status || "created",
      paymentOrderId: order.payments[0]?.providerOrderId || null,
      createdAt: order.createdAt,
      expiresAt: order.expiresAt,
      tickets: order.tickets.map((ticket) => mapTicket(ticket)),
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    },
  };
};

const listAdminTickets = async ({ eventId, query = {} }) => {
  await getAdminEvent(eventId);
  const { page, pageSize, skip } = buildPagination(query);
  const search = normalizeText(query.search);
  const status = normalizeText(query.status).toLowerCase();
  const textFilter = { contains: search, mode: "insensitive" };
  const where = {
    eventId,
    ...(["pending", "valid", "checked_in", "cancelled", "refunded"].includes(
      status,
    )
      ? { status }
      : {}),
    ...(search
      ? {
          OR: [
            { ticketNumber: textFilter },
            {
              order: {
                is: {
                  OR: [
                    { email: textFilter },
                    { firstName: textFilter },
                    { lastName: textFilter },
                    { phone: textFilter },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };
  const [total, tickets] = await prisma.$transaction([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      skip,
      take: pageSize,
      include: {
        order: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            status: true,
          },
        },
        checkedInBy: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);
  return {
    items: tickets.map((ticket) => ({
      ...mapTicket(ticket),
      buyerName: `${ticket.order.firstName} ${ticket.order.lastName}`.trim(),
      email: ticket.order.email,
      phone: ticket.order.phone,
      orderStatus: ticket.order.status,
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    },
  };
};

const scanResponse = (result, ticket, message) => ({
  result,
  accepted: result === "accepted",
  message,
  ticket: ticket
    ? {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        checkedInAt: ticket.checkedInAt,
        buyerName: ticket.order
          ? `${ticket.order.firstName} ${ticket.order.lastName}`.trim()
          : null,
        email: ticket.order?.email || null,
        eventId: ticket.eventId,
        eventTitle: ticket.event?.title || null,
      }
    : null,
});

const recordTicketScanAudit = async (tx, { ticket, result, auditContext, beforeStatus, beforeCheckedInAt }) => {
  if (!auditContext?.actorUserId && !auditContext?.requestId && !auditContext?.ipAddress) return;
  await recordAuditInTransaction(tx, {
    ...auditContext,
    action: "ticket.scanned",
    targetType: "Ticket",
    targetId: ticket?.id || null,
    beforeData: ticket ? { status: beforeStatus || ticket.status, checkedInAt: beforeCheckedInAt === undefined ? ticket.checkedInAt || null : beforeCheckedInAt } : undefined,
    afterData: {
      result,
      status: ticket?.status || null,
      checkedInAt: ticket?.checkedInAt || null,
      accepted: result === "accepted",
    },
  });
};

const scanTicket = async ({ eventId, payload, admin, auditContext = {} }) =>
  runSerializable(async (tx) => {
    const event = await tx.ticketEvent.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, status: true },
    });
    if (!event) throw new HttpError(404, "Ticketed event not found.");
    if (event.status === "cancelled")
      throw new HttpError(
        409,
        "This event is cancelled and cannot accept check-ins.",
      );
    const parsed = parseQrPayload(payload);
    if (!parsed) {
      await tx.ticketScan.create({
        data: {
          id: crypto.randomUUID(),
          eventId,
          scannedById: admin.id,
          result: "invalid_code",
          detail: "QR signature or format was invalid.",
        },
      });
      await recordTicketScanAudit(tx, { eventId, result: "invalid_code", auditContext });
      return scanResponse(
        "invalid_code",
        null,
        "This QR code is not a valid Quest ticket.",
      );
    }
    let ticket = await tx.ticket.findUnique({
      where: { id: parsed.ticketId },
      include: {
        order: true,
        event: { select: { title: true } },
        checkedInBy: { select: { firstName: true, lastName: true } },
      },
    });
    if (!ticket || ticket.tokenVersion !== parsed.tokenVersion) {
      await tx.ticketScan.create({
        data: {
          id: crypto.randomUUID(),
          eventId,
          ticketId: ticket?.id || null,
          scannedById: admin.id,
          result: "invalid_code",
          detail: "Ticket was missing or its QR had been reissued.",
        },
      });
      await recordTicketScanAudit(tx, { eventId, ticket, result: "invalid_code", auditContext });
      return scanResponse(
        "invalid_code",
        ticket,
        "This QR code is invalid or has been replaced.",
      );
    }
    if (ticket.eventId !== eventId) {
      await tx.ticketScan.create({
        data: {
          id: crypto.randomUUID(),
          eventId,
          ticketId: ticket.id,
          scannedById: admin.id,
          result: "wrong_event",
          detail: `Ticket belongs to ${ticket.event.title}.`,
        },
      });
      await recordTicketScanAudit(tx, { eventId, ticket, result: "wrong_event", auditContext });
      return scanResponse(
        "wrong_event",
        ticket,
        `This ticket belongs to ${ticket.event.title}.`,
      );
    }
    if (ticket.status === "checked_in") {
      await tx.ticketScan.create({
        data: {
          id: crypto.randomUUID(),
          eventId,
          ticketId: ticket.id,
          scannedById: admin.id,
          result: "already_used",
          detail: "Ticket had already been checked in.",
        },
      });
      await recordTicketScanAudit(tx, { eventId, ticket, result: "already_used", auditContext });
      return scanResponse(
        "already_used",
        ticket,
        "This ticket has already been checked in.",
      );
    }
    if (ticket.status !== "valid" || ticket.order.status !== "paid") {
      await tx.ticketScan.create({
        data: {
          id: crypto.randomUUID(),
          eventId,
          ticketId: ticket.id,
          scannedById: admin.id,
          result: "invalid_status",
          detail: `Ticket status was ${ticket.status}.`,
        },
      });
      await recordTicketScanAudit(tx, { eventId, ticket, result: "invalid_status", auditContext });
      return scanResponse(
        "invalid_status",
        ticket,
        `This ticket is ${ticket.status.replace("_", " ")}.`,
      );
    }
    const now = new Date();
    const previousStatus = ticket.status;
    const claimed = await tx.ticket.updateMany({
      where: {
        id: ticket.id,
        eventId,
        status: "valid",
        checkedInAt: null,
        tokenVersion: parsed.tokenVersion,
      },
      data: { status: "checked_in", checkedInAt: now, checkedInById: admin.id },
    });
    if (!claimed.count) {
      ticket = await tx.ticket.findUnique({
        where: { id: ticket.id },
        include: { order: true, event: { select: { title: true } } },
      });
      await tx.ticketScan.create({
        data: {
          id: crypto.randomUUID(),
          eventId,
          ticketId: ticket.id,
          scannedById: admin.id,
          result: "already_used",
          detail: "Concurrent scan was rejected.",
        },
      });
      await recordTicketScanAudit(tx, { eventId, ticket, result: "already_used", auditContext });
      return scanResponse(
        "already_used",
        ticket,
        "This ticket has already been checked in.",
      );
    }
    ticket = { ...ticket, status: "checked_in", checkedInAt: now };
    await tx.ticketScan.create({
      data: {
        id: crypto.randomUUID(),
        eventId,
        ticketId: ticket.id,
        scannedById: admin.id,
        result: "accepted",
      },
    });
    await recordTicketScanAudit(tx, { eventId, ticket, result: "accepted", auditContext, beforeStatus: previousStatus, beforeCheckedInAt: null });
    return scanResponse(
      "accepted",
      ticket,
      "Ticket accepted. Admit this attendee.",
    );
  });

const checkInTicketById = async ({ ticketId, eventId, admin, auditContext }) => {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new HttpError(404, "Ticket not found.");
  return scanTicket({ eventId, payload: buildQrPayload(ticket), admin, auditContext });
};

const reissueTicket = async ({ ticketId, auditContext = {} }) => prisma.$transaction(async (tx) => {
  const ticket = await tx.ticket.findUnique({ where: { id: ticketId }, include: { order: true } });
  if (!ticket) throw new HttpError(404, "Ticket not found.");
  if (ticket.order.status !== "paid" || !["valid", "checked_in"].includes(ticket.status)) {
    throw new HttpError(409, "Only a paid ticket can be reissued.");
  }
  if (ticket.status === "checked_in") throw new HttpError(409, "A checked-in ticket cannot be reissued.");
  const updated = await tx.ticket.update({ where: { id: ticketId }, data: { tokenVersion: { increment: 1 } } });
  if (auditContext.actorUserId || auditContext.requestId || auditContext.ipAddress) {
    await recordAuditInTransaction(tx, {
      ...auditContext,
      action: "ticket.reissued",
      targetType: "Ticket",
      targetId: ticketId,
      // `qrVersion` is the ticket's non-secret reissue counter. It is named
      // away from "token" deliberately: the durable-audit sanitizer redacts
      // every key that reads as a credential, and a reissue leaves `status`
      // unchanged, so this counter is the row's only before/after evidence.
      beforeData: { status: ticket.status, qrVersion: ticket.tokenVersion },
      afterData: { status: updated.status, qrVersion: updated.tokenVersion },
    });
  }
  return mapTicket(updated);
});

const updateTicketStatus = async ({ ticketId, status, auditContext = {} }) => {
  const normalized = normalizeText(status).toLowerCase();
  if (!new Set(["valid", "cancelled"]).has(normalized))
    throw new HttpError(400, "Ticket status is invalid.");
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({ where: { id: ticketId }, include: { order: true } });
    if (!ticket) throw new HttpError(404, "Ticket not found.");
    if (ticket.status === "checked_in") throw new HttpError(409, "A checked-in ticket cannot be cancelled or restored.");
    if (normalized === "valid" && ticket.order.status !== "paid") throw new HttpError(409, "Only a paid order can have a valid ticket.");
    const updated = await tx.ticket.update({ where: { id: ticketId }, data: { status: normalized } });
    if (auditContext.actorUserId || auditContext.requestId || auditContext.ipAddress) {
      await recordAuditInTransaction(tx, {
        ...auditContext,
        action: "ticket.status.updated",
        targetType: "Ticket",
        targetId: ticketId,
        beforeData: { status: ticket.status },
        afterData: { status: updated.status },
      });
    }
    return mapTicket(updated);
  });
};

const getEventReportRows = async (eventId) => {
  const event = await getAdminEvent(eventId);
  const tickets = await prisma.ticket.findMany({
    where: { eventId },
    orderBy: { ticketNumber: "asc" },
    include: {
      order: true,
      checkedInBy: { select: { firstName: true, lastName: true } },
    },
  });
  return {
    event,
    rows: tickets.map((ticket) => ({
      ticketNumber: ticket.ticketNumber,
      ticketStatus: ticket.status,
      buyerName: `${ticket.order.firstName} ${ticket.order.lastName}`.trim(),
      email: ticket.order.email,
      phone: ticket.order.phone,
      orderStatus: ticket.order.status,
      orderTotal: Number(ticket.order.total),
      checkedInAt: ticket.checkedInAt,
      checkedInBy: ticket.checkedInBy
        ? `${ticket.checkedInBy.firstName} ${ticket.checkedInBy.lastName}`.trim()
        : "",
    })),
  };
};

module.exports = {
  calculateTicketPrice,
  buildQrPayload,
  parseQrPayload,
  listPublicEvents,
  getPublicEvent,
  getPublicEventForSeries,
  getTicketQuote,
  createTicketOrder,
  getTicketOrderByToken,
  expireTicketOrderReservation,
  listAdminEvents,
  getAdminEvent,
  saveAdminEvent,
  listAdminOrders,
  listAdminTickets,
  scanTicket,
  checkInTicketById,
  reissueTicket,
  updateTicketStatus,
  getEventReportRows,
};
