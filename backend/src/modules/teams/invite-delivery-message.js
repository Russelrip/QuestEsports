// The message names the channels that actually carried it. Whoever sent it
// again needs to know that nothing reached the person, not a reassuring
// "invitation sent".
const describeInviteDelivery = (delivery) => {
  if (!delivery?.hasQuestAccount) {
    return "This player does not have a Quest account yet. Copy their onboarding link and send it to them.";
  }
  if (delivery.inApp && delivery.discord) {
    return "Reminded in Quest and on Discord.";
  }
  if (delivery.discord) {
    return "Reminded on Discord.";
  }
  if (delivery.inApp) {
    return "Reminded in Quest. They will see it next time they sign in.";
  }
  return "The invitation is waiting in their Quest account, but we could not reach them. Send them the link.";
};

module.exports = { describeInviteDelivery };
