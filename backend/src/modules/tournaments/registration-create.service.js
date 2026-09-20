const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { normalizeEmail, normalizeText } = require("../../lib/validation");
const { persistTeamLogoUpload, teamLogoDirectory } = require("../../middleware/upload");
const {
  ensureTeamRegistrationSaved,
  syncSavedTeamFromRegistration,
  sendTeamInvites,
} = require("../teams/team.service");
const { assertPayHereConfigured } = require("../payments/payment.service");
const {
  assertBankTransferConfigured,
  buildBankTransferInstructions,
  getBankTransferAmountForSlot,
} = require("../payments/bank-transfer.service");
const {
  allocateLowestAvailableSlot,
  buildActiveRegistrationWhere,
  countTournamentCapacityUsage,
  getNextWaitlistPosition,
  hasAvailableCapacity,
} = require("./registration-eligibility");
const { maybeAutoApproveRegistration } = require("./auto-approval.service");
const { countOutstandingInvites } = require("../teams/roster-invite-counts");
const { buildPublicReference, getTournamentRegistrationState } = require("./registration-state");
const { removeTeamLogoIfUnreferenced, removeUploadsQuietly } = require("../../lib/upload-cleanup");
const { assertNoCoachPlayerRoleConflict } = require("./role-conflict.service");
const {
  normalizeBoolean,
  runRetryableRegistrationQuery,
  runSerializable,
  mapRegistrationResult,
  getRosterVerificationStatus,
  queueRegistrationReceivedEmail,
  assertRegistrationStillOpen,
  buildPersistedRegistrationMembers,
  validateExistingRegistrationRoleConflict,
  getCurrentTournamentForRegistration,
} = require("./registration-shared");
const {
  assertCoachInputAllowed,
  attachConnectedDiscordIdentities,
  normalizeRegistrationSubmission,
  assertTeamLogoAvailable,
} = require("./registration-validation");
const {
  buildCheckout,
  buildPaymentOrderId,
  consumeAdminHoldOrQuoteSlot,
  startExistingRegistrationPayment,
} = require("./registration-payment.service");

const createConfiguredRegistration = async ({ slug, body, file, user }) => {
  const submittedSlug = normalizeText(body.tournamentSlug || body.tournament);
  if (submittedSlug && submittedSlug !== slug) {
    throw new HttpError(400, "Tournament registration route and payload do not match.");
  }
  const tournament = await runRetryableRegistrationQuery(() =>
    prisma.tournament.findFirst({
      where: { slug, isPublished: true },
      include: {
        _count: { select: { teamRegistrations: true } },
        series: {
          select: {
            registrationOpenAt: true,
            registrationCloseAt: true,
            registrationStatusOverride: true,
          },
        },
      },
    })
  );
  if (!tournament) throw new HttpError(404, "Tournament not found.");
  const now = new Date();

  // Existing registrations have early payment-verification paths, so reject
  // disabled coach input before any of those paths can start a transaction.
  assertCoachInputAllowed({ tournament, body });

  const feeAmount = Number(tournament.registrationFeeAmount || 0);
  const paymentMethod = feeAmount > 0 ? tournament.paymentMethod || "payhere" : "free";
  // A team roster is confirmed by the people on it, and that is true whether or
  // not the event charges anything. This condition used to carry two ideas under
  // one name — "there is a roster to confirm" and "there is a fee to hold back
  // until it is" — which was harmless while every team event charged. Free team
  // events then inherited the payment half of the meaning, so their captains
  // were told an outstanding roster was waiting on nothing.
  const requiresTeamVerification = tournament.entryType === "team";
  // The payment half, kept separate. No fee is quoted, reserved or collected
  // while invitations are outstanding; with no fee there is nothing to hold.
  const holdsPaymentForRoster = requiresTeamVerification && feeAmount > 0;
  if (paymentMethod === "payhere") assertPayHereConfigured();
  if (paymentMethod === "bank_transfer") assertBankTransferConfigured(tournament);
  if (feeAmount > 0 && !["payhere", "bank_transfer"].includes(paymentMethod)) {
    throw new HttpError(503, "This paid tournament does not have a payment method configured.");
  }
  const existing = await runRetryableRegistrationQuery(() =>
    prisma.teamRegistration.findFirst({
      where: {
        tournamentId: tournament.id,
        OR: [
          { userId: user.id },
          { captainEmail: normalizeEmail(user.email) },
        ],
      },
      include: {
        members: {
          select: { role: true, inviteStatus: true, inviteExpiresAt: true },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { bankTransferProof: true },
        },
      },
    })
  );
  const hasActivePaymentReservation =
    existing?.paymentStatus === "pending" &&
    existing.reservedUntil &&
    existing.reservedUntil > now;
  if (!hasActivePaymentReservation) {
    assertRegistrationStillOpen(tournament, now, 409);
  }
  if (existing) {
    if (existing.status === "waitlisted") {
      return {
        registration: mapRegistrationResult(existing),
        paymentOrderId: null,
        checkout: null,
        bankTransfer: null,
        awaitingTeamVerification: false,
        readyForPayment: false,
        waitlisted: true,
      };
    }
    const existingMembers = existing.members || [];
    const effectiveVerificationStatus = getRosterVerificationStatus(
      existingMembers,
      existing.verificationStatus
    );
    const { pendingInviteCount, expiredInviteCount } = countOutstandingInvites(existingMembers, now);
    // A free event stores its row as paid the moment it is created, because
    // capacity counts paid rows. That made "you are already registered" the only
    // answer a free captain with outstanding invitations could ever get back —
    // no roster state, and no way to reach the resend controls from here. A
    // roster that has not finished confirming itself is not a finished
    // registration, so it falls through to the team block below instead.
    const awaitingFreeRoster =
      requiresTeamVerification &&
      feeAmount === 0 &&
      effectiveVerificationStatus !== "verified";
    if ((existing.paymentStatus === "paid" || feeAmount === 0) && !awaitingFreeRoster) {
      throw new HttpError(409, "You are already registered for this tournament.");
    }
    const latestPayment = existing.payments[0];
    if (latestPayment?.status === "expired") {
      throw new HttpError(
        409,
        "This payment window expired and the slot was released. Contact an administrator to request a new slot."
      );
    }

    if (tournament.entryType === "team") {
      await ensureTeamRegistrationSaved(existing.id);
      if (effectiveVerificationStatus !== "verified") {
        return {
          registration: {
            ...mapRegistrationResult(existing),
            verificationStatus: effectiveVerificationStatus,
          },
          paymentOrderId: null,
          checkout: null,
          bankTransfer: null,
          awaitingTeamVerification: true,
          readyForPayment: false,
          pendingInviteCount,
          expiredInviteCount,
        };
      }
    }

    if (normalizeBoolean(body.resumePayment)) {
      const hasActivePayment =
        latestPayment &&
        ["created", "pending", "review_required"].includes(latestPayment.status) &&
        existing.paymentStatus === "pending" &&
        existing.reservedUntil &&
        existing.reservedUntil > now;
      if (hasActivePayment) {
        await validateExistingRegistrationRoleConflict({
          registrationId: existing.id,
          tournamentId: tournament.id,
        });
        return {
          registration: mapRegistrationResult(existing),
          paymentOrderId: latestPayment.providerOrderId,
          checkout: latestPayment.provider === "payhere"
            ? buildCheckout({
                payment: latestPayment,
                tournament,
                user,
                body: { phone: existing.captainPhone, country: existing.country },
              })
            : null,
          bankTransfer: latestPayment.provider === "bank_transfer"
            ? buildBankTransferInstructions({
                transaction: latestPayment,
                registration: existing,
                tournament,
              })
            : null,
          awaitingTeamVerification: false,
          readyForPayment: false,
        };
      }
      return startExistingRegistrationPayment({
        existing,
        tournament,
        paymentMethod,
        feeAmount,
        user,
      });
    }

    if (tournament.entryType === "team" && existing.paymentStatus === "unpaid") {
      return {
        registration: {
          ...mapRegistrationResult(existing),
          verificationStatus: "verified",
        },
        paymentOrderId: null,
        checkout: null,
        bankTransfer: null,
        awaitingTeamVerification: false,
        readyForPayment: true,
        pendingInviteCount: 0,
        expiredInviteCount: 0,
      };
    }
    if (
      paymentMethod === "bank_transfer" &&
      latestPayment?.provider === "bank_transfer" &&
      ["created", "pending", "review_required"].includes(latestPayment.status) &&
      existing.paymentStatus === "pending" &&
      existing.reservedUntil &&
      existing.reservedUntil > now
    ) {
      await validateExistingRegistrationRoleConflict({
        registrationId: existing.id,
        tournamentId: tournament.id,
      });
      return {
        registration: mapRegistrationResult(existing),
        paymentOrderId: latestPayment.providerOrderId,
        checkout: null,
        bankTransfer: buildBankTransferInstructions({
          transaction: latestPayment,
          registration: existing,
          tournament,
        }),
      };
    }
  }

  if (!hasActivePaymentReservation) {
    assertRegistrationStillOpen(tournament, now);
  }

  const submission = await attachConnectedDiscordIdentities({
    user,
    submission: normalizeRegistrationSubmission({ tournament, body, user }),
  });
  const {
    fullName,
    displayName,
    phone,
    discord,
    contactEmail,
    country,
    teamTag,
    rulebookAccepted,
    falsityWarningAccepted,
    configuredEntryData,
    primaryGameId,
    members,
    coach,
  } = submission;
  // Before anything is persisted or any capacity is counted: a refusal for a
  // missing logo should cost nothing and should not depend on how far into the
  // flow the caller got.
  await assertTeamLogoAvailable({
    tournament,
    user,
    teamName: displayName,
    uploaded: file,
    isRetry: Boolean(existing),
  });
  const persistedMembers = buildPersistedRegistrationMembers({ members, coach });
  // The roster's Discord requirement is not checked here any more. It used to
  // refuse the captain for a gap only the invitee could close — a captain
  // cannot connect Discord on someone else's behalf — which made the rule
  // unsatisfiable by the person it was being enforced against. It is enforced
  // where it can be acted on instead: accepting an invitation requires a
  // connected Discord account, for every roster on Quest. The captain's own
  // link is still required, by attachConnectedDiscordIdentities above.

  if (existing) {
    const providerOrderId = buildPaymentOrderId(paymentMethod);
    const reservedUntil = new Date(Date.now() + tournament.reservationMinutes * 60 * 1000);
    const persistedRetryLogo = tournament.entryType === "team"
      ? await persistTeamLogoUpload(file)
      : null;
    let retried;
    let retryInviteDispatches = [];
    try {
      retried = await runSerializable(async (tx) => {
        const currentRegistration = await tx.teamRegistration.findUnique({
          where: { id: existing.id },
        });
        if (!currentRegistration || currentRegistration.paymentStatus === "paid") {
          throw new HttpError(409, "You are already registered for this tournament.");
        }
        const retryNow = new Date();
        const hasActiveReservation =
          currentRegistration.paymentStatus === "pending" &&
          currentRegistration.reservedUntil &&
          currentRegistration.reservedUntil > retryNow;
        const currentTournament = await getCurrentTournamentForRegistration({
          tx,
          tournament,
          now: retryNow,
          allowActivePaymentReservation: Boolean(hasActiveReservation),
        });
        await assertNoCoachPlayerRoleConflict({
          tx,
          tournamentId: currentTournament.id,
          members: persistedMembers,
          excludeRegistrationId: existing.id,
        });
        const activeCount = await countTournamentCapacityUsage({
          tx,
          tournamentId: currentTournament.id,
          excludeRegistrationId: existing.id,
          now: retryNow,
        });
        const registrationState = hasActiveReservation
          ? { canRegister: hasAvailableCapacity(currentTournament, activeCount), canWaitlist: false }
          : getTournamentRegistrationState({
              tournament: currentTournament,
              capacityUsed: activeCount,
              now: retryNow,
            });
        if (!registrationState.canRegister) {
          if (!registrationState.canWaitlist) {
            throw new HttpError(409, "Registration slots are full.");
          }
          const waitlistPosition = currentRegistration.status === "waitlisted" &&
            Number.isInteger(currentRegistration.waitlistPosition) &&
            currentRegistration.waitlistPosition > 0
            ? currentRegistration.waitlistPosition
            : await getNextWaitlistPosition({ tx, tournamentId: currentTournament.id });
          const adminHold = tx.adminSlotReservation?.findUnique
            ? await tx.adminSlotReservation.findUnique({
                where: { registrationId: existing.id },
              })
            : null;
          if (adminHold) {
            await tx.adminSlotReservation.delete({ where: { id: adminHold.id } });
          }
          const waitlisted = await tx.teamRegistration.update({
            where: { id: existing.id },
            data: {
              status: "waitlisted",
              paymentStatus: "unpaid",
              reservedUntil: null,
              assignedSlotNumber: null,
              waitlistPosition,
            },
          });
          return { payment: null, registration: waitlisted, tournament: currentTournament, waitlisted: true };
        }
        const {
          assignedSlotNumber,
          quotedFeeAmount,
          quotedFeeCurrency,
        } = await consumeAdminHoldOrQuoteSlot({
          tx,
          registrationId: existing.id,
          tournament: currentTournament,
          paymentMethod,
          feeAmount,
        });
        if (tournament.entryType === "team") {
          const duplicateTeam = await tx.teamRegistration.findFirst({
            where: {
              id: { not: existing.id },
              tournamentId: currentTournament.id,
              entryType: "team",
              teamName: displayName,
              ...buildActiveRegistrationWhere(),
            },
            select: { id: true },
          });
          if (duplicateTeam) throw new HttpError(409, "A team with this name is already registered.");
        }
        const registration = await tx.teamRegistration.update({
          where: { id: existing.id },
          data: {
            userId: user.id,
            teamName: displayName,
            country,
            teamTag,
            organizationRequested: normalizeBoolean(body.organizationRequested),
            captainName: fullName,
            captainEmail: normalizeEmail(user.email),
            captainPhone: phone,
            captainDiscord: discord,
            captainRiotId: primaryGameId,
            contactEmail,
            ...(persistedRetryLogo ? { teamLogoName: persistedRetryLogo.filename } : {}),
            status: "pending",
            paymentStatus: "pending",
            verificationStatus: "pending",
            rulebookAccepted,
            falsityWarningAccepted,
            additionalData: configuredEntryData,
            reservedUntil,
            assignedSlotNumber,
            quotedFeeAmount,
            quotedFeeCurrency,
          },
        });
        await tx.registrationMember.deleteMany({ where: { registrationId: existing.id } });
        await tx.registrationMember.createMany({
          data: persistedMembers.map((member) => ({
            id: crypto.randomUUID(),
            registrationId: existing.id,
            userId: member.role === "CAPTAIN" ? user.id : null,
            role: member.role,
            memberOrder: member.order,
            name: member.name,
            email: member.email,
            emailNormalized: member.email,
            phone: member.phone || null,
            discord: member.discord,
            riotId: member.riotId,
            additionalData: member.additionalData || {},
            inviteStatus: member.role === "CAPTAIN" ? "accepted" : "pending",
            inviteRespondedAt: member.role === "CAPTAIN" ? new Date() : null,
          })),
        });
        if (tournament.entryType === "team") {
          retryInviteDispatches = await syncSavedTeamFromRegistration({
            tx,
            registrationId: existing.id,
            user,
            teamName: displayName,
            country,
            teamTag,
            organizationRequested: normalizeBoolean(body.organizationRequested),
            logoName: persistedRetryLogo?.filename || existing.teamLogoName || null,
            members: persistedMembers,
            tournamentTitle: currentTournament.title,
          });
        }
        await tx.paymentTransaction.updateMany({
          where: {
            registrationId: existing.id,
            status: { in: ["created", "pending", "review_required"] },
          },
          data: {
            status: "expired",
            statusMessage: "Superseded by a new payment reservation.",
          },
        });
        const payment = await tx.paymentTransaction.create({
          data: {
            id: crypto.randomUUID(),
            purpose: "tournament_registration",
            provider: paymentMethod,
            providerOrderId,
            registrationId: existing.id,
            amount: quotedFeeAmount,
            currency: quotedFeeCurrency,
            method: paymentMethod === "bank_transfer" ? "bank_transfer" : null,
          },
        });
        return { payment, registration, tournament: currentTournament };
      });
    } catch (error) {
      if (persistedRetryLogo) {
        await removeUploadsQuietly(
          [{ directory: teamLogoDirectory, filename: persistedRetryLogo.filename }],
          { operation: "retryConfiguredRegistrationRollback", registrationId: existing.id }
        );
      }
      throw error;
    }
    if (persistedRetryLogo && existing.teamLogoName && existing.teamLogoName !== persistedRetryLogo.filename) {
      await removeTeamLogoIfUnreferenced({
        prisma,
        filename: existing.teamLogoName,
        context: { operation: "retryConfiguredRegistration", registrationId: existing.id },
      });
    }
    await sendTeamInvites(retryInviteDispatches);
    await queueRegistrationReceivedEmail({
      registrationId: existing.id,
      email: user.email,
      recipientName: fullName,
      teamName: displayName,
      tournamentTitle: retried.tournament.title,
      pendingMemberCount: persistedMembers.filter((member) => member.role !== "CAPTAIN").length,
    });
    return {
      registration: mapRegistrationResult(retried.registration),
      paymentOrderId: retried.payment ? providerOrderId : null,
      checkout: retried.payment && paymentMethod === "payhere"
        ? buildCheckout({ payment: retried.payment, tournament: retried.tournament, user, body })
        : null,
      bankTransfer: retried.payment && paymentMethod === "bank_transfer"
        ? buildBankTransferInstructions({
            transaction: retried.payment,
            registration: retried.registration,
            tournament: retried.tournament,
          })
        : null,
      awaitingTeamVerification: false,
      readyForPayment: false,
      waitlisted: Boolean(retried.waitlisted),
    };
  }

  const persistedLogo = tournament.entryType === "team" ? await persistTeamLogoUpload(file) : null;
  const registrationId = crypto.randomUUID();
  const reservedUntil = feeAmount > 0 && !holdsPaymentForRoster
    ? new Date(Date.now() + tournament.reservationMinutes * 60 * 1000)
    : null;
  const providerOrderId = feeAmount > 0 && !holdsPaymentForRoster
    ? buildPaymentOrderId(paymentMethod)
    : null;
  let result;
  try {
    result = await runSerializable(async (tx) => {
      const currentTournament = await getCurrentTournamentForRegistration({
        tx,
        tournament,
        now: new Date(),
      });
      const transactionNow = new Date();
      await assertNoCoachPlayerRoleConflict({
        tx,
        tournamentId: currentTournament.id,
        members: persistedMembers,
      });
      const activeCount = await countTournamentCapacityUsage({
        tx,
        tournamentId: currentTournament.id,
        now: transactionNow,
      });
      const registrationState = getTournamentRegistrationState({
        tournament: currentTournament,
        capacityUsed: activeCount,
        now: transactionNow,
      });
      if (!registrationState.canRegister && !registrationState.canWaitlist) {
        throw new HttpError(409, "Registration slots are full.");
      }
      const isWaitlisted = registrationState.canWaitlist;
      const waitlistPosition = isWaitlisted
        ? await getNextWaitlistPosition({ tx, tournamentId: currentTournament.id })
        : null;

      const assignedSlotNumber = !isWaitlisted && paymentMethod === "bank_transfer" && !holdsPaymentForRoster
        ? await allocateLowestAvailableSlot({
            tx,
            tournamentId: currentTournament.id,
            maxTeams: currentTournament.maxTeams,
          })
        : null;
      const quotedFeeAmount = !isWaitlisted && paymentMethod === "bank_transfer" && !holdsPaymentForRoster
        ? getBankTransferAmountForSlot(currentTournament, assignedSlotNumber)
        : feeAmount;

      if (tournament.entryType === "team") {
        const duplicateTeam = await tx.teamRegistration.findFirst({
          where: {
            tournamentId: currentTournament.id,
            entryType: "team",
            teamName: displayName,
            ...buildActiveRegistrationWhere(),
          },
          select: { id: true },
        });
        if (duplicateTeam) {
          throw new HttpError(409, "A team with this name is already registered.");
        }
      }

      const registration = await tx.teamRegistration.create({
        data: {
          id: registrationId,
          tournamentId: currentTournament.id,
          userId: user.id,
          entryType: tournament.entryType,
          teamName: displayName,
          country,
          teamTag,
          organizationRequested: normalizeBoolean(body.organizationRequested),
          captainName: fullName,
          captainEmail: normalizeEmail(user.email),
          captainPhone: phone,
          captainDiscord: discord,
          captainRiotId: primaryGameId,
          contactEmail,
          teamLogoName: persistedLogo?.filename || null,
          status: isWaitlisted ? "waitlisted" : "pending",
          paymentStatus: isWaitlisted ? "unpaid" : feeAmount > 0
            ? holdsPaymentForRoster ? "unpaid" : "pending"
            : "paid",
          verificationStatus: persistedMembers.every((member) => member.role === "CAPTAIN")
            ? "verified"
            : "pending",
          rulebookAccepted,
          falsityWarningAccepted,
          additionalData: configuredEntryData,
          assignedSlotNumber,
          quotedFeeAmount: feeAmount > 0 && !holdsPaymentForRoster ? quotedFeeAmount : null,
          quotedFeeCurrency: feeAmount > 0 && !holdsPaymentForRoster
            ? currentTournament.registrationFeeCurrency
            : null,
          reservedUntil: isWaitlisted ? null : reservedUntil,
          waitlistPosition,
          publicReference: buildPublicReference(),
        },
      });
      await tx.registrationMember.createMany({
        data: persistedMembers.map((member) => ({
          id: crypto.randomUUID(),
          registrationId,
          userId: member.role === "CAPTAIN" ? user.id : null,
          role: member.role,
          memberOrder: member.order,
          name: member.name,
          email: member.email,
          emailNormalized: member.email,
          phone: member.phone || null,
          discord: member.discord,
          riotId: member.riotId,
          additionalData: member.additionalData || {},
          inviteStatus: member.role === "CAPTAIN" ? "accepted" : "pending",
          inviteRespondedAt: member.role === "CAPTAIN" ? new Date() : null,
        })),
      });

      // A free registration with a complete roster has nothing left to wait
      // on, so a tournament that does not review registrations approves it in
      // the same transaction that created it.
      const autoApproved = await maybeAutoApproveRegistration({
        tx,
        registrationId,
      });

      const payment = !isWaitlisted && feeAmount > 0 && !holdsPaymentForRoster
        ? await tx.paymentTransaction.create({
            data: {
              id: crypto.randomUUID(),
              purpose: "tournament_registration",
              provider: paymentMethod,
              providerOrderId,
              registrationId,
              amount: quotedFeeAmount,
              currency: currentTournament.registrationFeeCurrency,
              method: paymentMethod === "bank_transfer" ? "bank_transfer" : null,
            },
          })
        : null;
      return {
        registration: autoApproved || registration,
        payment,
        tournament: currentTournament,
        waitlisted: isWaitlisted,
      };
    });
  } catch (error) {
    if (persistedLogo) {
      await removeUploadsQuietly(
        [{ directory: teamLogoDirectory, filename: persistedLogo.filename }],
        { operation: "createConfiguredRegistrationRollback", registrationId }
      );
    }
    throw error;
  }

  // Keep the slot-reservation transaction short. Saved-team synchronization has
  // its own retryable transaction and can be safely resumed for an existing draft.
  if (tournament.entryType === "team") {
    await ensureTeamRegistrationSaved(registrationId);
  }

  await queueRegistrationReceivedEmail({
    registrationId,
    email: user.email,
    recipientName: fullName,
    teamName: displayName,
    tournamentTitle: result.tournament.title,
    pendingMemberCount: persistedMembers.filter((member) => member.role !== "CAPTAIN").length,
  });

  return {
    registration: mapRegistrationResult(result.registration),
    paymentOrderId: providerOrderId,
    checkout: result.payment && paymentMethod === "payhere"
      ? buildCheckout({ payment: result.payment, tournament: result.tournament, user, body })
      : null,
    bankTransfer: result.payment && paymentMethod === "bank_transfer"
      ? buildBankTransferInstructions({
          transaction: result.payment,
          registration: result.registration,
          tournament: result.tournament,
        })
      : null,
    // Whether anyone still has to accept is a fact about the roster, so a free
    // event reports it too. Whether that unlocks a payment step is a separate
    // question, and a free event has no such step to unlock.
    awaitingTeamVerification: !result.waitlisted && requiresTeamVerification && persistedMembers.some(
      (member) => member.role !== "CAPTAIN"
    ),
    readyForPayment: !result.waitlisted && holdsPaymentForRoster && persistedMembers.every(
      (member) => member.role === "CAPTAIN"
    ),
    pendingInviteCount: requiresTeamVerification
      ? persistedMembers.filter(
          (member) => member.role !== "CAPTAIN"
        ).length
      : 0,
    // Every invitation on a roster that was just submitted is brand new.
    expiredInviteCount: 0,
  };
};

module.exports = {
  createConfiguredRegistration,
};
