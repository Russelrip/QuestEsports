export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type AdminUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  role: "admin" | "user";
  phone?: string | null;
  discordTag?: string | null;
  emailVerified: boolean;
  lastLoginAt?: string | null;
  createdAt?: string | null;
};

export type DashboardStats = {
  totalTournaments: number;
  openTournaments: number;
  totalRegistrations: number;
  pendingRegistrations: number;
  pendingRecruitmentApplications: number;
  unreadContactMessages: number;
  pendingPayments: number;
  actionableOrders: number;
};

export type TournamentSummary = {
  id: string;
  slug: string;
  title: string;
  game: string;
  status: string;
  isPublished: boolean;
  registrationCount: number;
  capacityUsed?: number;
  maxTeams?: number | null;
  startDate?: string | null;
  registrationDeadline?: string | null;
  prizePool?: string | null;
  paymentMethod?: string;
  registrationFee?: { amount: number; currency: string };
};

export type RegistrationSummary = {
  id: string;
  teamName: string;
  entryType: string;
  status: string;
  paymentStatus: string;
  verificationStatus: string;
  createdAt: string;
  memberCount: number;
  tournament: Pick<TournamentSummary, "id" | "slug" | "title" | "status" | "isPublished">;
  captain: { name: string; email: string };
};

export type PaymentSummary = {
  id: string;
  orderId: string;
  paymentId?: string | null;
  purpose: string;
  provider: string;
  amount: number;
  currency: string;
  status: string;
  method?: string | null;
  createdAt: string;
  customerName: string;
  customerEmail?: string | null;
};

export type MerchandiseOrder = {
  id: string;
  publicToken: string;
  status: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  currency: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  paymentOrderId?: string | null;
  paymentStatus: string;
  createdAt: string;
  expiresAt?: string | null;
  items: Array<{
    id: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    selectedSize?: string | null;
    selectedColor?: string | null;
  }>;
};

export type RecruitmentApplication = {
  id: string;
  applicationType: string;
  fullName: string;
  email: string;
  phone: string;
  discord: string;
  game: string;
  playerId?: string | null;
  teamName?: string | null;
  currentRosterSize?: number | null;
  womensLeagueInterest?: boolean;
  status: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  members?: Array<Record<string, unknown>>;
  details?: Record<string, unknown>;
};

export type ContactMessage = {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TeamSummary = {
  id: string;
  name: string;
  teamTag?: string | null;
  country?: string | null;
  organizationName: string;
  captainName: string;
  memberCount: number;
  updatedAt: string;
  members?: Array<Record<string, unknown>>;
};

export type ProductSummary = {
  id: string;
  name: string;
  slug: string;
  status: string;
  price: number;
  currency: string;
  stockQuantity?: number;
  description?: string;
  [key: string]: unknown;
};

export type GameCategorySummary = {
  id: string;
  slug: string;
  displayName: string;
  isPublished: boolean;
  tournamentCount?: number;
};

export type SessionSummary = {
  id: string;
  createdAt: string;
  lastSeenAt?: string | null;
  expiresAt: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  rememberMe: boolean;
  isCurrent: boolean;
};

export type ApiEnvelope = {
  success: boolean;
  message?: string;
  [key: string]: unknown;
};

export type VetoStep = {
  kind: "ban" | "pick" | "decider" | "side";
  actor: "A" | "B" | null;
  seriesIndex: number | null;
};

export type VetoRoom = {
  id: string;
  code: string;
  title: string;
  format: "bo1" | "bo3" | "bo5" | "custom";
  status: "draft" | "open" | "toss_pending" | "toss_complete" | "in_progress" | "completed" | "cancelled";
  revision: number;
  controlMode: string;
  teamOrderMethod: string;
  toss: { method: "digital" | "manual"; callerSlot: 1 | 2; call: "heads" | "tails" | null; result: "heads" | "tails" | null; winnerSlot: 1 | 2 | null; teamASlot: 1 | 2 | null };
  timer: { seconds: number | null; deadline: string | null };
  participants: Array<{ id: string; slot: 1 | 2; displayName: string; seed?: number | null; accentColor: string; ready: boolean; joined: boolean; team: "A" | "B" | null }>;
  maps: Array<{ slug: string; name: string; accentColor: string; artworkUrl?: string | null; available?: boolean }>;
  steps: VetoStep[];
  currentStep: number;
  currentAction: VetoStep | null;
  actions: Array<{ id: string; sequence: number; kind: string; actorSlot: number | null; mapSlug: string | null; mapName: string | null; side: string | null; payload: { seriesIndex?: number | null } }>;
};

export type VetoCatalog = {
  pools: Array<{ id: string; name: string; version: number; maps: Array<{ slug: string; name: string }> }>;
  presets: Array<{ id: string; name: string; format: VetoRoom["format"]; version: number; steps: VetoStep[] }>;
  templates: Array<{ id: string; name: string; format: VetoRoom["format"]; mapPoolId: string; rulePresetId: string; settings: Record<string, unknown> }>;
};

export type MatchRoomSummary = {
  id: string;
  code: string;
  chatLocked: boolean;
  messageCount: number;
  openSupportCount: number;
  match: {
    id: string;
    identifier: string;
    status: string;
    scheduledAt: string | null;
    tournament: { id: string; slug: string; title: string; game: string };
    participants: Array<{ slot: number; displayName: string }>;
    veto: { id: string; code: string; status: string; format: string } | null;
  };
};

export type MatchRoomDetail = {
  id: string;
  code: string;
  chatLocked: boolean;
  access: { role: "player" | "captain" | "staff"; teamSlot: number | null; mutedUntil: string | null };
  match: MatchRoomSummary["match"] & { station: string | null };
  members: Array<{ id: string; role: "player" | "captain" | "staff"; teamSlot: number | null; mutedUntil: string | null; user: { id: string; username: string; firstName: string; lastName: string } }>;
};

export type MatchRoomMessage = {
  id: string;
  kind: "player" | "staff" | "system";
  body: string;
  hidden: boolean;
  hiddenReason: string | null;
  sender: { id: string; username: string } | null;
  createdAt: string;
};

export type MatchSupportRequest = {
  id: string;
  subject: string;
  status: "open" | "resolved";
  openedBy: { id: string; username: string };
  messages: Array<{ id: string; body: string; sender: { id: string; username: string }; createdAt: string }>;
};
