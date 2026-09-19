const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { normalizeText } = require("../../lib/validation");
const {
  allocateLowestAvailableSlot,
  countTournamentCapacityUsage,
  compactWaitlistPositions,
  getNextWaitlistPosition,
  hasAvailableCapacity,
} = require("../tournaments/registration-eligibility");
const { getBankTransferAmountForSlot } = require("../payments/bank-transfer.service");
const { activatePaidTeamRegistration } = require("../teams/team.service");
const { snapshotAndLockRoster } = require("../game-accounts/roster-snapshot.service");
const { maybeAutoApproveRegistration } = require("../tournaments/auto-approval.service");
const {
  REGISTRATION_STATUSES,
  VERIFICATION_STATUSES,
  runAdminSerializable,
  assertAdminRoleConflict,
  recordRegistrationStatusAudit,
  TEAM_REGISTRATION_INCLUDE,
  mapTeamRegistration,
} = require("./admin-shared");

const acceptPendingRegistrationInvites = async ({ tx, registrationId, savedTeamId, members }) => {
  const pendingMembers = (members || []).filter((member) => member.inviteStatus === "pending");
  if (pendingMembers.length > 0) {
    const inviteRespondedAt = new Date();
    await tx.registrationMember.updateMany({
      where: { registrationId, inviteStatus: "pending" },
      data: {
        inviteStatus: "accepted",
        inviteRespondedAt,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    });

    if (savedTeamId && typeof tx.savedTeamMember?.updateMany === "function") {
      for (const member of pendingMembers) {
        await tx.savedTeamMember.updateMany({
          where: {
            teamId: savedTeamId,
            role: member.role,
            memberOrder: member.memberOrder,
            emailNormalized: member.emailNormalized,
            inviteStatus: "pending",
          },
          data: {
            inviteStatus: "accepted",
            inviteRespondedAt,
            inviteTokenHash: null,
            inviteExpiresAt: null,
          },
        });
      }
    }
  }

  const rosterMembers = (members || [])
    .filter((member) => member.role !== "CAPTAIN")
    .map((member) => ({
      ...member,
      inviteStatus: member.inviteStatus === "pending" ? "accepted" : member.inviteStatus,
    }));
  return rosterMembers.some((member) => member.inviteStatus === "declined")
    ? "flagged"
    : rosterMembers.every((member) => member.inviteStatus === "accepted")
      ? "verified"
      : "pending";
};

const updateTeamRegistrationStatus = async (
  registrationId,
  body,
  adminUserId,
  auditContext = {}
) => {
  const nextStatus = normalizeText(body.status).toLowerCase();
  const nextPaymentStatus = normalizeText(body.paymentStatus).toLowerCase();
  const nextVerificationStatus = normalizeText(body.verificationStatus).toLowerCase();
  const adminOverridePayment = body.adminOverridePayment === true;
  const reason = normalizeText(body.reason) || null;
  const updateData = {};

  const currentRegistration = await prisma.teamRegistration.findUnique({
    where: { id: registrationId },
    select: {
      status: true,
      waitlistPosition: true,
      paymentStatus: true,
      tournament: { select: { registrationFeeAmount: true, waitlistEnabled: true } },
    },
  });
  if (!currentRegistration) throw new HttpError(404, "Registration not found.");

  if (adminOverridePayment) {
    if (nextStatus && nextStatus !== "approved") {
      throw new HttpError(400, "A payment override can only approve a registration.");
    }
    const registration = await runAdminSerializable(async (tx) => {
      const current = await tx.teamRegistration.findUnique({
        where: { id: registrationId },
        include: { tournament: true, adminSlotReservation: true, members: true },
      });
      if (!current) throw new HttpError(404, "Registration not found.");
      if (current.status === "rejected") {
        throw new HttpError(409, "Restore the rejected registration to pending before overriding payment.");
      }
      await assertAdminRoleConflict({
        tx,
        tournamentId: current.tournamentId,
        members: current.members || [],
        excludeRegistrationId: current.id,
      });
      const wasWaitlisted = current.status === "waitlisted";
      if (wasWaitlisted) {
        const first = await tx.teamRegistration.findFirst({
          where: { tournamentId: current.tournamentId, status: "waitlisted" },
          orderBy: { waitlistPosition: "asc" },
          select: { id: true },
        });
        if (first?.id !== current.id) {
          throw new HttpError(409, "Only the first waitlisted registration can be promoted.");
        }
      }

      let assignedSlotNumber = current.assignedSlotNumber || current.adminSlotReservation?.assignedSlotNumber;
      if (!assignedSlotNumber) {
        const used = await countTournamentCapacityUsage({
          tx,
          tournamentId: current.tournamentId,
          excludeRegistrationId: current.id,
        });
        if (!hasAvailableCapacity(current.tournament, used)) {
          throw new HttpError(409, "The tournament has no slot available.");
        }
        assignedSlotNumber = await allocateLowestAvailableSlot({
          tx,
          tournamentId: current.tournamentId,
          maxTeams: current.tournament.maxTeams,
          excludeRegistrationId: current.id,
        });
      }

      const quotedFeeAmount = current.adminSlotReservation?.quotedFeeAmount ??
        (current.tournament.paymentMethod === "bank_transfer"
          ? getBankTransferAmountForSlot(current.tournament, assignedSlotNumber)
          : Number(current.tournament.registrationFeeAmount || 0));
      await tx.paymentTransaction.updateMany({
        where: {
          registrationId: current.id,
          status: { in: ["created", "pending", "expired", "review_required"] },
        },
        data: {
          status: "cancelled",
          statusMessage: "Payment waived by an administrator.",
          reconciledAt: new Date(),
          reconciledById: adminUserId,
          reconciliationNote: "Registration approved without payment.",
        },
      });
      if (current.adminSlotReservation) {
        await tx.adminSlotReservation.delete({ where: { registrationId: current.id } });
      }
      const approvalVerificationStatus = await acceptPendingRegistrationInvites({
        tx,
        registrationId: current.id,
        savedTeamId: current.savedTeamId,
        members: current.members,
      });
      // Approval is the moment the roster is committed. Snapshot the
      // competitive identities inside this transaction so an approved
      // registration can never exist without a record of who played.
      await snapshotAndLockRoster({
        tx,
        registrationId: current.id,
        tournamentGame: current.tournament?.game,
        actorUserId: adminUserId,
        requestId: auditContext.requestId,
        ipAddress: auditContext.ipAddress,
      });
      const updated = await tx.teamRegistration.update({
        where: { id: current.id },
        data: {
          status: "approved",
          paymentStatus: "paid",
          assignedSlotNumber,
          quotedFeeAmount,
          quotedFeeCurrency: current.adminSlotReservation?.quotedFeeCurrency || current.tournament.registrationFeeCurrency,
          reservedUntil: null,
          waitlistPosition: wasWaitlisted ? null : current.waitlistPosition,
          ...(approvalVerificationStatus ? { verificationStatus: approvalVerificationStatus } : {}),
        },
        include: TEAM_REGISTRATION_INCLUDE,
      });
      if (wasWaitlisted) {
        await compactWaitlistPositions({
          tx,
          tournamentId: current.tournamentId,
          position: current.waitlistPosition,
        });
      }
      await recordRegistrationStatusAudit({
        tx,
        actorUserId: adminUserId,
        registrationId: current.id,
        fromStatus: current.status,
        toStatus: "approved",
        reason,
        ...auditContext,
      });
      return updated;
    });
    await activatePaidTeamRegistration(registration.id);
    return mapTeamRegistration(registration);
  }

  if (nextStatus) {
    if (!REGISTRATION_STATUSES.has(nextStatus)) {
      throw new HttpError(400, "Invalid registration status.");
    }
    if (
      nextStatus === "approved" &&
      Number(currentRegistration.tournament.registrationFeeAmount || 0) > 0 &&
      currentRegistration.paymentStatus !== "paid"
    ) {
      throw new HttpError(409, "Paid registrations must be provider-confirmed before approval.");
    }
    if (nextStatus === "waitlisted" && !currentRegistration.tournament.waitlistEnabled) {
      throw new HttpError(409, "Waitlisting is not enabled for this tournament.");
    }
    updateData.status = nextStatus;
  }

  if (nextPaymentStatus) {
    throw new HttpError(
      400,
      "Payment status is provider-controlled and cannot be changed manually."
    );
  }

  if (nextVerificationStatus) {
    if (!VERIFICATION_STATUSES.has(nextVerificationStatus)) {
      throw new HttpError(400, "Invalid verification status.");
    }
    updateData.verificationStatus = nextVerificationStatus;
  }

  if (Object.keys(updateData).length === 0) {
    throw new HttpError(
      400,
      "Provide at least one of status or verificationStatus."
    );
  }

  let registration;
  if (nextStatus === "waitlisted") {
    registration = await runAdminSerializable(async (tx) => {
      const current = await tx.teamRegistration.findUnique({
        where: { id: registrationId },
        include: { tournament: true, adminSlotReservation: true, members: true },
      });
      if (!current) throw new HttpError(404, "Registration not found.");
      if (!current.tournament.waitlistEnabled) {
        throw new HttpError(409, "Waitlisting is not enabled for this tournament.");
      }
      const waitlistPosition = current.status === "waitlisted" && current.waitlistPosition
        ? current.waitlistPosition
        : await getNextWaitlistPosition({ tx, tournamentId: current.tournamentId });
      if (current.adminSlotReservation) {
        await tx.adminSlotReservation.delete({ where: { registrationId: current.id } });
      }
      const updated = await tx.teamRegistration.update({
        where: { id: registrationId },
        data: {
          ...updateData,
          status: "waitlisted",
          waitlistPosition,
          assignedSlotNumber: null,
          reservedUntil: null,
        },
        include: TEAM_REGISTRATION_INCLUDE,
      });
      await recordRegistrationStatusAudit({
        tx,
        actorUserId: adminUserId,
        registrationId: current.id,
        fromStatus: current.status,
        toStatus: "waitlisted",
        reason,
        ...auditContext,
      });
      return updated;
    });
  } else if (
    nextStatus &&
    ["pending", "approved", "rejected"].includes(nextStatus) &&
    currentRegistration.status === "waitlisted"
  ) {
    registration = await runAdminSerializable(async (tx) => {
      const current = await tx.teamRegistration.findUnique({
        where: { id: registrationId },
        include: { tournament: true, adminSlotReservation: true, members: true },
      });
      if (!current) throw new HttpError(404, "Registration not found.");

      let data = { ...updateData };
      if (current.status === "waitlisted") {
        if (nextStatus !== "rejected") {
          const first = await tx.teamRegistration.findFirst({
            where: { tournamentId: current.tournamentId, status: "waitlisted" },
            orderBy: { waitlistPosition: "asc" },
            select: { id: true },
          });
          if (first?.id !== current.id) {
            throw new HttpError(409, "Only the first waitlisted registration can be promoted.");
          }
          await assertAdminRoleConflict({
            tx,
            tournamentId: current.tournamentId,
            members: current.members || [],
            excludeRegistrationId: current.id,
          });
          const used = await countTournamentCapacityUsage({
            tx,
            tournamentId: current.tournamentId,
            excludeRegistrationId: current.id,
          });
          if (!hasAvailableCapacity(current.tournament, used)) {
            throw new HttpError(409, "The tournament has no slot available.");
          }
          data.assignedSlotNumber = await allocateLowestAvailableSlot({
            tx,
            tournamentId: current.tournamentId,
            maxTeams: current.tournament.maxTeams,
            excludeRegistrationId: current.id,
          });
          data.waitlistPosition = null;
          if (Number(current.tournament.registrationFeeAmount || 0) === 0) {
            data.paymentStatus = "paid";
          }
        } else {
          data.waitlistPosition = null;
        }
      }
      const approvalVerificationStatus = nextStatus === "approved"
        ? await acceptPendingRegistrationInvites({
            tx,
            registrationId: current.id,
            savedTeamId: current.savedTeamId,
            members: current.members,
          })
        : null;
      if (nextStatus === "approved") {
        // Same transaction as the status change: an approved roster without a
        // competitive snapshot is a registration with no record of who played.
        await snapshotAndLockRoster({
          tx,
          registrationId: current.id,
          tournamentGame: current.tournament?.game,
          actorUserId: adminUserId,
          requestId: auditContext.requestId,
          ipAddress: auditContext.ipAddress,
        });
      }
      const updated = await tx.teamRegistration.update({
        where: { id: registrationId },
        data: {
          ...data,
          ...(approvalVerificationStatus ? { verificationStatus: approvalVerificationStatus } : {}),
        },
        include: TEAM_REGISTRATION_INCLUDE,
      });
      if (current.status === "waitlisted") {
        await compactWaitlistPositions({
          tx,
          tournamentId: current.tournamentId,
          position: current.waitlistPosition,
        });
      }
      await recordRegistrationStatusAudit({
        tx,
        actorUserId: adminUserId,
        registrationId: current.id,
        fromStatus: current.status,
        toStatus: nextStatus,
        reason,
        ...auditContext,
      });
      return updated;
    });
  } else {
    if (nextStatus) {
      registration = await runAdminSerializable(async (tx) => {
        const current = await tx.teamRegistration.findUnique({
          where: { id: registrationId },
          select: {
            id: true,
            tournamentId: true,
            status: true,
            savedTeamId: true,
            members: true,
            // Needed to decide whether this tournament has a game identity to
            // snapshot at all.
            tournament: { select: { game: true } },
          },
        });
        if (!current) throw new HttpError(404, "Registration not found.");
        if (nextStatus !== "rejected") {
          await assertAdminRoleConflict({
            tx,
            tournamentId: current.tournamentId,
            members: current.members || [],
            excludeRegistrationId: current.id,
          });
        }
        const approvalVerificationStatus = nextStatus === "approved"
          ? await acceptPendingRegistrationInvites({
              tx,
              registrationId: current.id,
              savedTeamId: current.savedTeamId,
              members: current.members,
            })
          : null;
        if (nextStatus === "approved") {
          await snapshotAndLockRoster({
            tx,
            registrationId: current.id,
            tournamentGame: current.tournament?.game,
            actorUserId: adminUserId,
            requestId: auditContext.requestId,
            ipAddress: auditContext.ipAddress,
          });
        }
        const updated = await tx.teamRegistration.update({
          where: { id: registrationId },
          data: {
            ...updateData,
            ...(approvalVerificationStatus ? { verificationStatus: approvalVerificationStatus } : {}),
          },
          include: TEAM_REGISTRATION_INCLUDE,
        });
        await recordRegistrationStatusAudit({
          tx,
          actorUserId: adminUserId,
          registrationId,
          fromStatus: current.status,
          toStatus: nextStatus,
          reason,
          ...auditContext,
        });
        return updated;
      });
    } else {
      registration = await runAdminSerializable(async (tx) => {
        const current = await tx.teamRegistration.findUnique({
          where: { id: registrationId },
          select: { id: true, verificationStatus: true },
        });
        if (!current) throw new HttpError(404, "Registration not found.");
        const updated = await tx.teamRegistration.update({
          where: { id: registrationId },
          data: updateData,
          include: TEAM_REGISTRATION_INCLUDE,
        });
        await recordRegistrationStatusAudit({
          tx,
          actorUserId: adminUserId,
          registrationId,
          fromStatus: current.verificationStatus,
          toStatus: updateData.verificationStatus,
          reason,
          action: "team_registration.verification_status_changed",
          ...auditContext,
        });
        if (updateData.verificationStatus !== "verified") return updated;
        // An admin confirming the roster settles the last thing a registration
        // can be waiting on, exactly as the final accepted invitation does. A
        // tournament that does not review registrations approves it here;
        // otherwise a verified, paid entry sits pending with nothing left that
        // would ever move it.
        const autoApproved = await maybeAutoApproveRegistration({
          tx,
          registrationId,
          requestId: auditContext.requestId,
          ipAddress: auditContext.ipAddress,
        });
        return autoApproved
          ? tx.teamRegistration.findUnique({
              where: { id: registrationId },
              include: TEAM_REGISTRATION_INCLUDE,
            })
          : updated;
      });
    }
  }

  return mapTeamRegistration(registration);
};

module.exports = {
  updateTeamRegistrationStatus,
};
