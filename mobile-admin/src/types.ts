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
  mfaEnabled?: boolean;
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
