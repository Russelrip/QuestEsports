import { redirect } from "next/navigation";

// Kept only to catch links that are already out there.
//
// An invitation used to be answered by presenting the token in this URL. It is
// answered by the invitee's identity now, so there is nothing for a token to
// unlock and nothing to render here — but people still have these links in old
// emails and forwarded chats, and a dead page is a worse answer than the page
// their invitation is actually on. Anyone signing in from here finds it waiting.
export default function TeamInvitePage() {
  redirect("/profile?tab=invitations");
}
