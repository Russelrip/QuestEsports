const prisma = require("../config/prisma");

const submitTournamentRegistration = async (req, res) => {
  try {
    const {
      tournament,
      teamName,
      captainName,
      captainEmail,
      captainPhone,
      captainDiscord,
      captainRiotId,
      player2Name,
      player2Discord,
      player2RiotId,
      player3Name,
      player3Discord,
      player3RiotId,
      player4Name,
      player4Discord,
      player4RiotId,
      player5Name,
      player5Discord,
      player5RiotId,
      sub1Name,
      sub1Discord,
      sub1RiotId,
      sub2Name,
      sub2Discord,
      sub2RiotId,
      coachName,
      coachDiscord,
      coachRiotId,
      contactEmail,
      rulebook,
      falsityWarning,
    } = req.body;

    if (
      !tournament ||
      !teamName ||
      !captainName ||
      !captainEmail ||
      !captainPhone ||
      !captainDiscord ||
      !captainRiotId ||
      !player2Name ||
      !player2Discord ||
      !player2RiotId ||
      !player3Name ||
      !player3Discord ||
      !player3RiotId ||
      !player4Name ||
      !player4Discord ||
      !player4RiotId ||
      !player5Name ||
      !player5Discord ||
      !player5RiotId ||
      !contactEmail ||
      rulebook !== "true" ||
      falsityWarning !== "true"
    ) {
      return res.status(400).json({
        success: false,
        message: "Please fill all required fields and accept the agreements.",
      });
    }

    // Prevent duplicate registrations for the same tournament by either team name or captain email.
    const existingRegistration = await prisma.tournamentRegistration.findFirst({
      where: {
        tournament,
        OR: [
          { teamName },
          { captainEmail: captainEmail.toLowerCase() },
        ],
      },
    });

    if (existingRegistration) {
      return res.status(400).json({
        success: false,
        message: "This team or captain email is already registered for the selected tournament.",
      });
    }

    // Optional substitutes, coach details, and the uploaded logo are normalized before persistence.
    await prisma.tournamentRegistration.create({
      data: {
        tournament,
        teamName,
        teamLogoName: req.file ? req.file.filename : null,

        captainName,
        captainEmail: captainEmail.toLowerCase(),
        captainPhone,
        captainDiscord,
        captainRiotId,

        player2Name,
        player2Discord,
        player2RiotId,

        player3Name,
        player3Discord,
        player3RiotId,

        player4Name,
        player4Discord,
        player4RiotId,

        player5Name,
        player5Discord,
        player5RiotId,

        sub1Name: sub1Name || null,
        sub1Discord: sub1Discord || null,
        sub1RiotId: sub1RiotId || null,

        sub2Name: sub2Name || null,
        sub2Discord: sub2Discord || null,
        sub2RiotId: sub2RiotId || null,

        coachName: coachName || null,
        coachDiscord: coachDiscord || null,
        coachRiotId: coachRiotId || null,

        contactEmail: contactEmail.toLowerCase(),
        rulebook: rulebook === "true",
        falsityWarning: falsityWarning === "true",
      },
    });

    res.status(201).json({
      success: true,
      message: "Tournament registration submitted successfully.",
    });
  } catch (error) {
    console.error("Tournament registration error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during tournament registration.",
    });
  }
};

module.exports = {
  submitTournamentRegistration,
};
