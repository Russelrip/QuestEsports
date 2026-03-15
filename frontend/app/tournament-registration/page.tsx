"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type FormDataType = {
  tournament: string;
  teamName: string;
  teamLogo: File | null;
  captainName: string;
  captainEmail: string;
  captainPhone: string;
  captainDiscord: string;
  captainRiotId: string;
  player2Name: string;
  player2Discord: string;
  player2RiotId: string;
  player3Name: string;
  player3Discord: string;
  player3RiotId: string;
  player4Name: string;
  player4Discord: string;
  player4RiotId: string;
  player5Name: string;
  player5Discord: string;
  player5RiotId: string;
  sub1Name: string;
  sub1Discord: string;
  sub1RiotId: string;
  sub2Name: string;
  sub2Discord: string;
  sub2RiotId: string;
  coachName: string;
  coachDiscord: string;
  coachRiotId: string;
  contactEmail: string;
  rulebook: boolean;
  falsityWarning: boolean;
};

export default function TournamentRegistrationPage() {
  const [submitted, setSubmitted] = useState(false);

  const [formData, setFormData] = useState<FormDataType>({
    tournament: "",
    teamName: "",
    teamLogo: null,
    captainName: "",
    captainEmail: "",
    captainPhone: "",
    captainDiscord: "",
    captainRiotId: "",
    player2Name: "",
    player2Discord: "",
    player2RiotId: "",
    player3Name: "",
    player3Discord: "",
    player3RiotId: "",
    player4Name: "",
    player4Discord: "",
    player4RiotId: "",
    player5Name: "",
    player5Discord: "",
    player5RiotId: "",
    sub1Name: "",
    sub1Discord: "",
    sub1RiotId: "",
    sub2Name: "",
    sub2Discord: "",
    sub2RiotId: "",
    coachName: "",
    coachDiscord: "",
    coachRiotId: "",
    contactEmail: "",
    rulebook: false,
    falsityWarning: false,
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;

    if (type === "checkbox") {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData((prev) => ({
        ...prev,
        [name]: checked,
      }));
      return;
    }

    if (type === "file") {
      const files = (e.target as HTMLInputElement).files;
      setFormData((prev) => ({
        ...prev,
        [name]: files && files.length > 0 ? files[0] : null,
      }));
      return;
    }

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    console.log("Tournament registration submitted:", formData);

    setSubmitted(true);
  };

  return (
    <>
      <section className="page-header">
        <h1>Tournament Registration</h1>
        <p>Register your team for upcoming tournaments</p>
      </section>

      <section className="tournament-registration-section">
        <div className="form-container">
          <h2>Register Your Team</h2>

          <div className="rulebook-box">
            <h3 className="rulebook-title">
              Quest Esports Official VALORANT Rulebook
            </h3>
            <p className="rulebook-text">
              Please read the official Quest Esports VALORANT Tournament
              Rulebook before submitting your registration.
            </p>
            <Link href="/rulebook" className="btn btn-secondary">
              Open Rulebook
            </Link>
          </div>

          <form
            id="tournamentRegistrationForm"
            className="tournament-registration-form"
            onSubmit={handleSubmit}
          >
            <fieldset>
              <legend>Tournament Selection</legend>
              <div className="form-group">
                <label htmlFor="tournament">Select Tournament *</label>
                <select
                  id="tournament"
                  name="tournament"
                  required
                  value={formData.tournament}
                  onChange={handleChange}
                >
                  <option value="">-- Select a Tournament --</option>
                  <option value="valorant-women">
                    Valorant Women&apos;s Championship 2025
                  </option>
                  <option value="valorant-showdown">
                    The Valorant Showdown 2026
                  </option>
                </select>
              </div>
            </fieldset>

            <fieldset>
              <legend>Team &amp; Captain Information</legend>

              <div className="form-group">
                <label htmlFor="teamName">Team Name *</label>
                <input
                  type="text"
                  id="teamName"
                  name="teamName"
                  required
                  value={formData.teamName}
                  onChange={handleChange}
                />
              </div>

              <div className="form-group">
                <label htmlFor="teamLogo">Team Logo</label>
                <input
                  type="file"
                  id="teamLogo"
                  name="teamLogo"
                  accept="image/*"
                  onChange={handleChange}
                />
                <small>Upload team logo (PNG, JPG, max 5MB)</small>
              </div>

              <div className="form-group">
                <label htmlFor="captainName">Team Captain Full Name *</label>
                <input
                  type="text"
                  id="captainName"
                  name="captainName"
                  required
                  value={formData.captainName}
                  onChange={handleChange}
                />
              </div>

              <div className="form-group">
                <label htmlFor="captainEmail">
                  Team Captain Email Address *
                </label>
                <input
                  type="email"
                  id="captainEmail"
                  name="captainEmail"
                  required
                  value={formData.captainEmail}
                  onChange={handleChange}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="captainPhone">
                    WhatsApp Contact Number *
                  </label>
                  <input
                    type="tel"
                    id="captainPhone"
                    name="captainPhone"
                    placeholder="076 XXX XXXX"
                    required
                    value={formData.captainPhone}
                    onChange={handleChange}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="captainDiscord">Discord Tag *</label>
                  <input
                    type="text"
                    id="captainDiscord"
                    name="captainDiscord"
                    placeholder="username#1234"
                    required
                    value={formData.captainDiscord}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="captainRiotId">Riot ID (Valorant) *</label>
                <input
                  type="text"
                  id="captainRiotId"
                  name="captainRiotId"
                  placeholder="Username#Region"
                  required
                  value={formData.captainRiotId}
                  onChange={handleChange}
                />
              </div>
            </fieldset>

            <fieldset>
              <legend>Player Details</legend>

              <div className="player-section">
                <h4>Player 2 *</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="player2Name">Full Name *</label>
                    <input
                      type="text"
                      id="player2Name"
                      name="player2Name"
                      required
                      value={formData.player2Name}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="player2Discord">Discord Username *</label>
                    <input
                      type="text"
                      id="player2Discord"
                      name="player2Discord"
                      required
                      value={formData.player2Discord}
                      onChange={handleChange}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="player2RiotId">Riot ID *</label>
                  <input
                    type="text"
                    id="player2RiotId"
                    name="player2RiotId"
                    required
                    value={formData.player2RiotId}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="player-section">
                <h4>Player 3 *</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="player3Name">Full Name *</label>
                    <input
                      type="text"
                      id="player3Name"
                      name="player3Name"
                      required
                      value={formData.player3Name}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="player3Discord">Discord Username *</label>
                    <input
                      type="text"
                      id="player3Discord"
                      name="player3Discord"
                      required
                      value={formData.player3Discord}
                      onChange={handleChange}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="player3RiotId">Riot ID *</label>
                  <input
                    type="text"
                    id="player3RiotId"
                    name="player3RiotId"
                    required
                    value={formData.player3RiotId}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="player-section">
                <h4>Player 4 *</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="player4Name">Full Name *</label>
                    <input
                      type="text"
                      id="player4Name"
                      name="player4Name"
                      required
                      value={formData.player4Name}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="player4Discord">Discord Username *</label>
                    <input
                      type="text"
                      id="player4Discord"
                      name="player4Discord"
                      required
                      value={formData.player4Discord}
                      onChange={handleChange}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="player4RiotId">Riot ID *</label>
                  <input
                    type="text"
                    id="player4RiotId"
                    name="player4RiotId"
                    required
                    value={formData.player4RiotId}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="player-section">
                <h4>Player 5 *</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="player5Name">Full Name *</label>
                    <input
                      type="text"
                      id="player5Name"
                      name="player5Name"
                      required
                      value={formData.player5Name}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="player5Discord">Discord Username *</label>
                    <input
                      type="text"
                      id="player5Discord"
                      name="player5Discord"
                      required
                      value={formData.player5Discord}
                      onChange={handleChange}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="player5RiotId">Riot ID *</label>
                  <input
                    type="text"
                    id="player5RiotId"
                    name="player5RiotId"
                    required
                    value={formData.player5RiotId}
                    onChange={handleChange}
                  />
                </div>
              </div>
            </fieldset>

            <fieldset>
              <legend>Substitute Players</legend>

              <div className="player-section">
                <h4>Substitute Player 1 (Optional)</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="sub1Name">Full Name</label>
                    <input
                      type="text"
                      id="sub1Name"
                      name="sub1Name"
                      value={formData.sub1Name}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="sub1Discord">Discord Username</label>
                    <input
                      type="text"
                      id="sub1Discord"
                      name="sub1Discord"
                      value={formData.sub1Discord}
                      onChange={handleChange}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="sub1RiotId">Riot ID</label>
                  <input
                    type="text"
                    id="sub1RiotId"
                    name="sub1RiotId"
                    value={formData.sub1RiotId}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="player-section">
                <h4>Substitute Player 2 (Optional)</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="sub2Name">Full Name</label>
                    <input
                      type="text"
                      id="sub2Name"
                      name="sub2Name"
                      value={formData.sub2Name}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="sub2Discord">Discord Username</label>
                    <input
                      type="text"
                      id="sub2Discord"
                      name="sub2Discord"
                      value={formData.sub2Discord}
                      onChange={handleChange}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="sub2RiotId">Riot ID</label>
                  <input
                    type="text"
                    id="sub2RiotId"
                    name="sub2RiotId"
                    value={formData.sub2RiotId}
                    onChange={handleChange}
                  />
                </div>
              </div>
            </fieldset>

            <fieldset>
              <legend>Coach Details (Optional)</legend>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="coachName">Coach Full Name</label>
                  <input
                    type="text"
                    id="coachName"
                    name="coachName"
                    value={formData.coachName}
                    onChange={handleChange}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="coachDiscord">Discord Username</label>
                  <input
                    type="text"
                    id="coachDiscord"
                    name="coachDiscord"
                    value={formData.coachDiscord}
                    onChange={handleChange}
                  />
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="coachRiotId">Riot ID</label>
                <input
                  type="text"
                  id="coachRiotId"
                  name="coachRiotId"
                  value={formData.coachRiotId}
                  onChange={handleChange}
                />
              </div>
            </fieldset>

            <fieldset>
              <legend>Contact &amp; Agreement</legend>
              <div className="form-group">
                <label htmlFor="contactEmail">Contact Email Address *</label>
                <input
                  type="email"
                  id="contactEmail"
                  name="contactEmail"
                  required
                  value={formData.contactEmail}
                  onChange={handleChange}
                />
                <small>
                  This email will be used for tournament notifications
                </small>
              </div>

              <div className="form-group checkbox">
                <label>
                  <input
                    type="checkbox"
                    name="rulebook"
                    required
                    checked={formData.rulebook}
                    onChange={handleChange}
                  />
                  {" "}I confirm that I have read and agree to the Quest Esports
                  VALORANT Tournament Rulebook *
                </label>
              </div>

              <div className="form-group checkbox">
                <label>
                  <input
                    type="checkbox"
                    name="falsityWarning"
                    required
                    checked={formData.falsityWarning}
                    onChange={handleChange}
                  />
                  {" "}I acknowledge that providing false information or rule
                  violations may result in disqualification *
                </label>
              </div>
            </fieldset>

            <button type="submit" className="btn btn-primary">
              Submit Registration
            </button>
          </form>

          {submitted && (
            <div id="registrationSuccess" className="success-message">
              <h3>Registration Successful!</h3>
              <p>
                Your team has been registered for the tournament. You will
                receive a confirmation email shortly.
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}