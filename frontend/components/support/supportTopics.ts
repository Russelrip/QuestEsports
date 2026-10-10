// Starting points for a new support conversation. Picking one fills in a
// subject and a short template of what staff will ask for anyway, so the first
// reply can be an answer instead of a question. Templates are plain text the
// player edits; nothing here is sent as structured data.
export type SupportTopic = { id: string; label: string; hint: string; subject: string; template: string };

export const supportTopics: SupportTopic[] = [
  {
    id: "tournament-registration",
    label: "Tournament registration",
    hint: "Signing up, approval, waitlist, roster",
    subject: "Tournament registration",
    template: "Tournament:\nTeam name:\nWhat I was trying to do:\nWhat happened instead:",
  },
  {
    id: "tournament-match",
    label: "Tournament or match problem",
    hint: "Schedule, match room, veto, results, no-show",
    subject: "Tournament match problem",
    template: "Tournament:\nMatch / round:\nTeams:\nWhat happened:",
  },
  {
    id: "teams",
    label: "Creating or managing a team",
    hint: "Making a team, invites, captain, logo",
    subject: "Team help",
    template: "Team name:\nWhat I'm trying to do:\nWhat happened instead:",
  },
  {
    id: "valorant",
    label: "VALORANT account & leaderboard",
    hint: "Connecting your Riot account, rank, leaderboard",
    subject: "VALORANT account",
    template: "Riot ID (Name#Tag):\nWhat happened:",
  },
  {
    id: "payments",
    label: "Payments & tickets",
    hint: "Entry fees, event tickets, refunds, orders",
    subject: "Payment or ticket",
    template: "What it was for (tournament, event or order):\nPayment reference or receipt number:\nAmount and payment method:\nWhat happened:",
  },
  {
    id: "account",
    label: "Account & sign-in",
    hint: "Signing in, email, Discord or Google linking",
    subject: "Account and sign-in",
    template: "How I sign in (email, Google or Discord):\nWhat happened:",
  },
  {
    id: "report",
    label: "Report a player or team",
    hint: "Cheating, toxicity, rule breaks",
    subject: "Report a player or team",
    template: "Player or team:\nWhere and when (tournament, match, Discord):\nWhat happened:",
  },
  {
    id: "other",
    label: "Something else",
    hint: "Feedback, ideas, anything not listed",
    subject: "",
    template: "",
  },
];

const templates = new Set(supportTopics.map((topic) => topic.template.trim()).filter(Boolean));
const subjects = new Set(supportTopics.map((topic) => topic.subject).filter(Boolean));

// A field is safe to replace only while it is empty or still holds a topic's
// untouched starting text; anything the player typed is theirs.
export const isUntouchedBody = (body: string) => !body.trim() || templates.has(body.trim());
export const isUntouchedSubject = (subject: string) => !subject.trim() || subjects.has(subject.trim());
