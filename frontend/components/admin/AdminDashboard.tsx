"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/auth";
import { useAuth } from "@/components/auth/AuthProvider";
import EmptyState from "@/components/ui/EmptyState";

type AdminTab = "dashboard" | "users" | "contacts" | "registrations";

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type DashboardStats = {
  totalUsers: number;
  totalAdmins: number;
  totalContacts: number;
  totalTeamRegistrations: number;
};

type DashboardUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  role: "admin" | "user";
  lastLoginAt?: string | null;
  createdAt?: string | null;
};

type ContactMessage = {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  isRead: boolean;
  createdAt: string;
};

type TournamentOption = {
  id: string;
  slug: string;
  title: string;
  isActive: boolean;
};

type RegistrationMember = {
  id: string;
  role: string;
  order: number;
  name: string;
  discord?: string | null;
  riotId?: string | null;
};

type TeamRegistration = {
  id: string;
  teamName: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  contactEmail: string;
  logoUrl?: string | null;
  tournament: TournamentOption;
  captain: {
    name: string;
    email: string;
    phone: string;
    discord: string;
    riotId: string;
  };
  members: RegistrationMember[];
};

const emptyStats: DashboardStats = {
  totalUsers: 0,
  totalAdmins: 0,
  totalContacts: 0,
  totalTeamRegistrations: 0,
};

const emptyPagination: Pagination = {
  page: 1,
  pageSize: 10,
  total: 0,
  totalPages: 1,
};

const tabs: Array<{ id: AdminTab; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "users", label: "Users" },
  { id: "contacts", label: "Contact Messages" },
  { id: "registrations", label: "Registrations" },
];

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "N/A";

const getRoleClassName = (value: string) => {
  if (value === "approved" || value === "admin" || value === "read") {
    return "table-role is-approved";
  }

  if (value === "rejected") {
    return "table-role is-rejected";
  }

  return "table-role";
};

function PaginationControls({
  pagination,
  onPageChange,
}: {
  pagination: Pagination;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="admin-pagination">
      <p>
        Page {pagination.page} of {pagination.totalPages} • {pagination.total} total
      </p>
      <div className="admin-pagination-actions">
        <button
          type="button"
          className="btn btn-secondary btn-small"
          disabled={pagination.page <= 1}
          onClick={() => onPageChange(pagination.page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => onPageChange(pagination.page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function RegistrationDetailsModal({
  registration,
  onClose,
}: {
  registration: TeamRegistration | null;
  onClose: () => void;
}) {
  if (!registration) {
    return null;
  }

  const logoSrc =
    registration.logoUrl && process.env.NEXT_PUBLIC_API_URL
      ? `${process.env.NEXT_PUBLIC_API_URL}${registration.logoUrl}`
      : registration.logoUrl || null;

  return (
    <div className="admin-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="admin-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="registration-details-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="admin-modal-head">
          <div>
            <span className="profile-badge">Registration Details</span>
            <h3 id="registration-details-title">{registration.teamName}</h3>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="admin-modal-grid">
          <div className="admin-detail-card">
            <h4>Tournament</h4>
            <p>{registration.tournament.title}</p>
            <h4>Status</h4>
            <p>
              <span className={getRoleClassName(registration.status)}>
                {registration.status}
              </span>
            </p>
            <h4>Submitted</h4>
            <p>{formatDate(registration.createdAt)}</p>
            <h4>Contact Email</h4>
            <p>{registration.contactEmail}</p>
          </div>

          <div className="admin-detail-card">
            <h4>Captain</h4>
            <p>{registration.captain.name}</p>
            <p>{registration.captain.email}</p>
            <p>{registration.captain.phone}</p>
            <p>{registration.captain.discord}</p>
            <p>{registration.captain.riotId}</p>
          </div>

          <div className="admin-detail-card admin-detail-card-wide">
            <h4>Players & Staff</h4>
            <div className="admin-member-list">
              {registration.members.map((member) => (
                <article key={member.id} className="admin-member-item">
                  <strong>
                    {member.name} <span>({member.role.toLowerCase()})</span>
                  </strong>
                  <p>{member.discord || "No Discord provided"}</p>
                  <p>{member.riotId || "No Riot ID provided"}</p>
                </article>
              ))}
            </div>
          </div>

          {logoSrc ? (
            <div className="admin-detail-card admin-detail-card-wide">
              <h4>Team Logo</h4>
              <a href={logoSrc} target="_blank" rel="noreferrer" className="admin-logo-link">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoSrc}
                  alt={`${registration.teamName} logo`}
                  className="admin-logo-preview"
                />
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [dashboardError, setDashboardError] = useState("");
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [usersPagination, setUsersPagination] = useState<Pagination>(emptyPagination);
  const [usersSearch, setUsersSearch] = useState("");
  const [usersPage, setUsersPage] = useState(1);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [messagesPagination, setMessagesPagination] =
    useState<Pagination>(emptyPagination);
  const [messagesSearch, setMessagesSearch] = useState("");
  const [messagesPage, setMessagesPage] = useState(1);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState("");
  const [registrations, setRegistrations] = useState<TeamRegistration[]>([]);
  const [registrationPagination, setRegistrationPagination] =
    useState<Pagination>(emptyPagination);
  const [registrationSearch, setRegistrationSearch] = useState("");
  const [registrationTournament, setRegistrationTournament] = useState("");
  const [registrationStatus, setRegistrationStatus] = useState("");
  const [registrationPage, setRegistrationPage] = useState(1);
  const [registrationLoading, setRegistrationLoading] = useState(false);
  const [registrationError, setRegistrationError] = useState("");
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [selectedRegistration, setSelectedRegistration] =
    useState<TeamRegistration | null>(null);

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    setDashboardError("");
    try {
      const response = await apiFetch("/api/admin/dashboard");
      const data = await response.json();
      if (!response.ok || !data.success) {
        setDashboardError(data.message || "Unable to load dashboard stats.");
        return;
      }
      setStats(data.stats);
    } catch (error) {
      console.error("Failed to load admin dashboard stats:", error);
      setDashboardError("Something went wrong while loading dashboard stats.");
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError("");
    try {
      const params = new URLSearchParams({ page: String(usersPage), pageSize: "10" });
      if (usersSearch.trim()) {
        params.set("search", usersSearch.trim());
      }
      const response = await apiFetch(`/api/admin/users?${params.toString()}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        setUsersError(data.message || "Unable to load users.");
        return;
      }
      setUsers(data.users || []);
      setUsersPagination(data.pagination || emptyPagination);
    } catch (error) {
      console.error("Failed to load admin users:", error);
      setUsersError("Something went wrong while loading users.");
    } finally {
      setUsersLoading(false);
    }
  }, [usersPage, usersSearch]);

  const loadMessages = useCallback(async () => {
    setMessagesLoading(true);
    setMessagesError("");
    try {
      const params = new URLSearchParams({ page: String(messagesPage), pageSize: "10" });
      if (messagesSearch.trim()) {
        params.set("search", messagesSearch.trim());
      }
      const response = await apiFetch(
        `/api/admin/contact-messages?${params.toString()}`
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        setMessagesError(data.message || "Unable to load contact messages.");
        return;
      }
      setMessages(data.messages || []);
      setMessagesPagination(data.pagination || emptyPagination);
    } catch (error) {
      console.error("Failed to load contact messages:", error);
      setMessagesError("Something went wrong while loading contact messages.");
    } finally {
      setMessagesLoading(false);
    }
  }, [messagesPage, messagesSearch]);

  const loadRegistrations = useCallback(async () => {
    setRegistrationLoading(true);
    setRegistrationError("");
    try {
      const params = new URLSearchParams({
        page: String(registrationPage),
        pageSize: "10",
      });
      if (registrationSearch.trim()) {
        params.set("search", registrationSearch.trim());
      }
      if (registrationTournament) {
        params.set("tournament", registrationTournament);
      }
      if (registrationStatus) {
        params.set("status", registrationStatus);
      }
      const response = await apiFetch(
        `/api/admin/team-registrations?${params.toString()}`
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        setRegistrationError(data.message || "Unable to load registrations.");
        return;
      }
      setRegistrations(data.registrations || []);
      setRegistrationPagination(data.pagination || emptyPagination);
      setTournaments(data.tournaments || []);
    } catch (error) {
      console.error("Failed to load registrations:", error);
      setRegistrationError("Something went wrong while loading registrations.");
    } finally {
      setRegistrationLoading(false);
    }
  }, [registrationPage, registrationSearch, registrationStatus, registrationTournament]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
      return;
    }
    if (!isLoading && user && user.role !== "admin") {
      router.replace("/");
      return;
    }
    if (user?.role === "admin") {
      void loadDashboard();
    }
  }, [isLoading, loadDashboard, router, user]);

  useEffect(() => {
    if (user?.role === "admin" && (activeTab === "users" || activeTab === "dashboard")) {
      void loadUsers();
    }
  }, [activeTab, loadUsers, user]);

  useEffect(() => {
    if (user?.role === "admin" && activeTab === "contacts") {
      void loadMessages();
    }
  }, [activeTab, loadMessages, user]);

  useEffect(() => {
    if (user?.role === "admin" && activeTab === "registrations") {
      void loadRegistrations();
    }
  }, [
    activeTab,
    loadRegistrations,
    user,
  ]);

  if (isLoading || !user || user.role !== "admin") {
    return null;
  }

  const handleMarkAsRead = async (messageId: string) => {
    try {
      const response = await apiFetch(`/api/admin/contact-messages/${messageId}/read`, {
        method: "PATCH",
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setMessagesError(data.message || "Unable to mark this message as read.");
        return;
      }
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === messageId ? { ...message, isRead: true } : message
        )
      );
    } catch (error) {
      console.error("Failed to mark contact message as read:", error);
      setMessagesError("Something went wrong while updating the contact message.");
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!window.confirm("Delete this contact message?")) {
      return;
    }
    try {
      const response = await apiFetch(`/api/admin/contact-messages/${messageId}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setMessagesError(data.message || "Unable to delete this message.");
        return;
      }
      await Promise.all([loadMessages(), loadDashboard()]);
    } catch (error) {
      console.error("Failed to delete contact message:", error);
      setMessagesError("Something went wrong while deleting the contact message.");
    }
  };

  const handleUpdateRegistrationStatus = async (
    registrationId: string,
    status: "approved" | "rejected"
  ) => {
    try {
      const response = await apiFetch(
        `/api/admin/team-registrations/${registrationId}/status`,
        {
          method: "PATCH",
          json: { status },
        }
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        setRegistrationError(data.message || "Unable to update registration status.");
        return;
      }
      setRegistrations((currentRegistrations) =>
        currentRegistrations.map((registration) =>
          registration.id === registrationId ? { ...registration, status } : registration
        )
      );
      setSelectedRegistration((current) =>
        current && current.id === registrationId ? { ...current, status } : current
      );
    } catch (error) {
      console.error("Failed to update team registration status:", error);
      setRegistrationError("Something went wrong while updating registration status.");
    }
  };

  return (
    <>
      <section className="admin-section">
        <div className="container admin-dashboard">
          <div className="admin-header">
            <div>
              <span className="profile-badge">Admin Dashboard</span>
              <h2>Manage Quest Esports data</h2>
              <p className="section-intro admin-section-intro">
                Signed in as <strong>{user.username}</strong>. Review users,
                contact messages, and tournament registrations from one place.
              </p>
            </div>
            <Link href="/profile" className="btn btn-secondary btn-small">
              View My Profile
            </Link>
          </div>

          <div className="admin-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`admin-tab ${activeTab === tab.id ? "is-active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {(activeTab === "dashboard" || activeTab === "users") &&
            (dashboardLoading ? (
              <EmptyState description="Loading dashboard stats..." />
            ) : dashboardError ? (
              <EmptyState description={dashboardError} />
            ) : (
              <div className="admin-stats-grid">
                <article className="admin-stat-card">
                  <span>Total Users</span>
                  <strong>{stats.totalUsers}</strong>
                </article>
                <article className="admin-stat-card">
                  <span>Total Admins</span>
                  <strong>{stats.totalAdmins}</strong>
                </article>
                <article className="admin-stat-card">
                  <span>Contact Messages</span>
                  <strong>{stats.totalContacts}</strong>
                </article>
                <article className="admin-stat-card">
                  <span>Team Registrations</span>
                  <strong>{stats.totalTeamRegistrations}</strong>
                </article>
              </div>
            ))}

          {activeTab === "dashboard" ? (
            <div className="admin-users-card">
              <div className="admin-users-head">
                <div>
                  <h3>Recent Users</h3>
                  <p>Newest registered accounts</p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => setActiveTab("users")}
                >
                  Open Users Tab
                </button>
              </div>

              {usersLoading ? (
                <EmptyState description="Loading users..." />
              ) : usersError ? (
                <EmptyState description={usersError} />
              ) : (
                <div className="admin-users-table-wrap">
                  <table className="admin-users-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Username</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Last Login</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.slice(0, 5).map((registeredUser) => (
                        <tr key={registeredUser.id}>
                          <td>
                            {registeredUser.firstName} {registeredUser.lastName}
                          </td>
                          <td>{registeredUser.username}</td>
                          <td>{registeredUser.email}</td>
                          <td>
                            <span className={getRoleClassName(registeredUser.role)}>
                              {registeredUser.role}
                            </span>
                          </td>
                          <td>{formatDate(registeredUser.lastLoginAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {activeTab === "users" ? (
            <div className="admin-users-card">
              <div className="admin-users-head">
                <div>
                  <h3>Registered Users</h3>
                  <p>Search accounts by name, email, or username</p>
                </div>
                <input
                  type="search"
                  className="admin-search-input"
                  value={usersSearch}
                  onChange={(event) => {
                    setUsersPage(1);
                    setUsersSearch(event.target.value);
                  }}
                  placeholder="Search users..."
                />
              </div>

              {usersLoading ? (
                <EmptyState description="Loading users..." />
              ) : usersError ? (
                <EmptyState description={usersError} />
              ) : users.length === 0 ? (
                <EmptyState description="No users matched your search." />
              ) : (
                <>
                  <div className="admin-users-table-wrap">
                    <table className="admin-users-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Username</th>
                          <th>Email</th>
                          <th>Role</th>
                          <th>Created</th>
                          <th>Last Login</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((registeredUser) => (
                          <tr key={registeredUser.id}>
                            <td>
                              {registeredUser.firstName} {registeredUser.lastName}
                            </td>
                            <td>{registeredUser.username}</td>
                            <td>{registeredUser.email}</td>
                            <td>
                              <span className={getRoleClassName(registeredUser.role)}>
                                {registeredUser.role}
                              </span>
                            </td>
                            <td>{formatDate(registeredUser.createdAt)}</td>
                            <td>{formatDate(registeredUser.lastLoginAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PaginationControls
                    pagination={usersPagination}
                    onPageChange={setUsersPage}
                  />
                </>
              )}
            </div>
          ) : null}

          {activeTab === "contacts" ? (
            <div className="admin-users-card">
              <div className="admin-users-head">
                <div>
                  <h3>Contact Messages</h3>
                  <p>Search by sender name or email</p>
                </div>
                <input
                  type="search"
                  className="admin-search-input"
                  value={messagesSearch}
                  onChange={(event) => {
                    setMessagesPage(1);
                    setMessagesSearch(event.target.value);
                  }}
                  placeholder="Search contact messages..."
                />
              </div>

              {messagesLoading ? (
                <EmptyState description="Loading contact messages..." />
              ) : messagesError ? (
                <EmptyState description={messagesError} />
              ) : messages.length === 0 ? (
                <EmptyState description="No contact messages found." />
              ) : (
                <>
                  <div className="admin-users-table-wrap">
                    <table className="admin-users-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Subject</th>
                          <th>Message</th>
                          <th>Date</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {messages.map((contactMessage) => (
                          <tr key={contactMessage.id}>
                            <td>{contactMessage.name}</td>
                            <td>{contactMessage.email}</td>
                            <td>{contactMessage.subject}</td>
                            <td className="admin-message-cell">{contactMessage.message}</td>
                            <td>{formatDate(contactMessage.createdAt)}</td>
                            <td>
                              <span
                                className={getRoleClassName(
                                  contactMessage.isRead ? "read" : "pending"
                                )}
                              >
                                {contactMessage.isRead ? "Read" : "Unread"}
                              </span>
                            </td>
                            <td>
                              <div className="admin-table-actions">
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-small"
                                  disabled={contactMessage.isRead}
                                  onClick={() => handleMarkAsRead(contactMessage.id)}
                                >
                                  Mark Read
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-small admin-danger-button"
                                  onClick={() => handleDeleteMessage(contactMessage.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PaginationControls
                    pagination={messagesPagination}
                    onPageChange={setMessagesPage}
                  />
                </>
              )}
            </div>
          ) : null}

          {activeTab === "registrations" ? (
            <div className="admin-users-card">
              <div className="admin-users-head">
                <div>
                  <h3>Team Registrations</h3>
                  <p>Filter by tournament, status, or team details</p>
                </div>
                <div className="admin-filter-row">
                  <input
                    type="search"
                    className="admin-search-input"
                    value={registrationSearch}
                    onChange={(event) => {
                      setRegistrationPage(1);
                      setRegistrationSearch(event.target.value);
                    }}
                    placeholder="Search teams or captains..."
                  />
                  <select
                    value={registrationTournament}
                    onChange={(event) => {
                      setRegistrationPage(1);
                      setRegistrationTournament(event.target.value);
                    }}
                  >
                    <option value="">All tournaments</option>
                    {tournaments.map((tournament) => (
                      <option key={tournament.id} value={tournament.slug}>
                        {tournament.title}
                      </option>
                    ))}
                  </select>
                  <select
                    value={registrationStatus}
                    onChange={(event) => {
                      setRegistrationPage(1);
                      setRegistrationStatus(event.target.value);
                    }}
                  >
                    <option value="">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
              </div>

              {registrationLoading ? (
                <EmptyState description="Loading registrations..." />
              ) : registrationError ? (
                <EmptyState description={registrationError} />
              ) : registrations.length === 0 ? (
                <EmptyState description="No registrations matched your filters." />
              ) : (
                <>
                  <div className="admin-users-table-wrap">
                    <table className="admin-users-table">
                      <thead>
                        <tr>
                          <th>Team Name</th>
                          <th>Tournament</th>
                          <th>Captain</th>
                          <th>Players</th>
                          <th>Date</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registrations.map((registration) => (
                          <tr key={registration.id}>
                            <td>{registration.teamName}</td>
                            <td>{registration.tournament.title}</td>
                            <td>
                              {registration.captain.name}
                              <br />
                              <small>{registration.captain.email}</small>
                            </td>
                            <td>{registration.members.length}</td>
                            <td>{formatDate(registration.createdAt)}</td>
                            <td>
                              <span className={getRoleClassName(registration.status)}>
                                {registration.status}
                              </span>
                            </td>
                            <td>
                              <div className="admin-table-actions">
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-small"
                                  onClick={() => setSelectedRegistration(registration)}
                                >
                                  View
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-small"
                                  disabled={registration.status === "approved"}
                                  onClick={() =>
                                    handleUpdateRegistrationStatus(
                                      registration.id,
                                      "approved"
                                    )
                                  }
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-small admin-danger-button"
                                  disabled={registration.status === "rejected"}
                                  onClick={() =>
                                    handleUpdateRegistrationStatus(
                                      registration.id,
                                      "rejected"
                                    )
                                  }
                                >
                                  Reject
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PaginationControls
                    pagination={registrationPagination}
                    onPageChange={setRegistrationPage}
                  />
                </>
              )}
            </div>
          ) : null}
        </div>
      </section>

      <RegistrationDetailsModal
        registration={selectedRegistration}
        onClose={() => setSelectedRegistration(null)}
      />
    </>
  );
}
