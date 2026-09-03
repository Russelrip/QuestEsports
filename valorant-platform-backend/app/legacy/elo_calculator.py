import math
from typing import Tuple, Dict

class EloCalculator:
    """
    ELO Rating System Calculator
    Based on standard ELO formula used in chess and competitive games
    """

    @staticmethod
    def get_k_factor(matches_played: int) -> int:
        """
        Determine K-factor based on number of matches played
        Higher K-factor for new teams = faster ELO adjustment
        Lower K-factor for established teams = more stable ratings
        """
        if matches_played < 10:
            return 40  # New teams - volatile
        elif matches_played < 30:
            return 30  # Intermediate
        else:
            return 20  # Established teams - stable

    @staticmethod
    def expected_score(rating_a: float, rating_b: float) -> float:
        """
        Calculate expected score for team A against team B
        Returns a value between 0 and 1
        0.5 means equal chance, >0.5 means A is favored
        """
        return 1 / (1 + math.pow(10, (rating_b - rating_a) / 400))

    @staticmethod
    def get_round_differential_multiplier(winner_rounds: int, loser_rounds: int) -> float:
        """
        Calculate multiplier based on round differential (Valorant is first to 13)
        Close games have lower multiplier, stomps have higher multiplier
        For single map use.
        """
        round_diff = winner_rounds - loser_rounds

        if round_diff <= 2:  # 13-11, 13-12 (very close)
            return 1.0
        elif round_diff <= 4:  # 13-9, 13-10 (close)
            return 1.1
        elif round_diff <= 6:  # 13-7, 13-8 (comfortable)
            return 1.25
        elif round_diff <= 8:  # 13-5, 13-6 (dominant)
            return 1.4
        else:  # 13-4 or worse (stomp)
            return 1.5

    @staticmethod
    def get_series_multiplier(winner_maps: int, loser_maps: int,
                             winner_total_rounds: int, loser_total_rounds: int,
                             match_format: str) -> float:
        """
        Calculate multiplier for Bo3/Bo5 series based on map differential and aggregate rounds

        Args:
            winner_maps: Maps won by winner
            loser_maps: Maps won by loser
            winner_total_rounds: Total rounds won by winner across all maps
            loser_total_rounds: Total rounds won by loser across all maps
            match_format: "bo1", "bo3", or "bo5"

        Returns:
            Combined multiplier for series
        """
        # Map differential multiplier
        map_diff = winner_maps - loser_maps

        if match_format == "bo3":
            if map_diff == 2:  # 2-0 clean sweep
                map_mult = 1.4
            else:  # 2-1 close series
                map_mult = 1.1
        elif match_format == "bo5":
            if map_diff == 3:  # 3-0 complete domination
                map_mult = 1.6
            elif map_diff == 2:  # 3-1 dominant
                map_mult = 1.35
            else:  # 3-2 close series
                map_mult = 1.1
        else:  # bo1
            map_mult = 1.0

        # Aggregate round differential bonus
        total_round_diff = winner_total_rounds - loser_total_rounds

        if match_format == "bo3":
            # Expected rounds in Bo3: ~78 total (3 maps of 26 rounds avg)
            if total_round_diff <= 5:  # Very close aggregate
                round_bonus = 0.0
            elif total_round_diff <= 10:  # Close
                round_bonus = 0.05
            elif total_round_diff <= 15:  # Comfortable
                round_bonus = 0.1
            else:  # Dominant
                round_bonus = 0.15
        elif match_format == "bo5":
            # Expected rounds in Bo5: ~130 total (5 maps of 26 rounds avg)
            if total_round_diff <= 8:  # Very close
                round_bonus = 0.0
            elif total_round_diff <= 15:  # Close
                round_bonus = 0.05
            elif total_round_diff <= 25:  # Comfortable
                round_bonus = 0.1
            else:  # Dominant
                round_bonus = 0.15
        else:  # bo1
            round_bonus = 0.0

        return map_mult + round_bonus

    @staticmethod
    def get_upset_bonus(winner_elo: float, loser_elo: float) -> float:
        """
        Calculate upset bonus when underdog wins
        Bigger upset = bigger bonus
        """
        elo_diff = loser_elo - winner_elo

        if elo_diff < 0:  # Favorite won, no bonus
            return 0
        elif elo_diff < 100:  # Small upset
            return 5
        elif elo_diff < 200:  # Medium upset
            return 10
        elif elo_diff < 300:  # Big upset
            return 15
        else:  # Huge upset
            return 20

    @staticmethod
    def calculate_new_elo(winner_elo: float, loser_elo: float,
                         winner_matches: int, loser_matches: int,
                         winner_rounds: int = 13, loser_rounds: int = 0,
                         match_importance: str = "regular",
                         match_format: str = "bo1",
                         winner_maps: int = None, loser_maps: int = None) -> Tuple[float, float]:
        """
        Calculate new ELO ratings for both teams after a match (Enhanced FACEIT-style)

        Args:
            winner_elo: Current ELO of winning team
            loser_elo: Current ELO of losing team
            winner_matches: Number of matches played by winner
            loser_matches: Number of matches played by loser
            winner_rounds: Rounds won by winner (aggregate for Bo3/Bo5, single map for Bo1)
            loser_rounds: Rounds won by loser (aggregate for Bo3/Bo5, single map for Bo1)
            match_importance: "regular", "playoff", or "finals"
            match_format: "bo1", "bo3", or "bo5"
            winner_maps: Maps won by winner (None for Bo1, required for Bo3/Bo5)
            loser_maps: Maps won by loser (None for Bo1, required for Bo3/Bo5)

        Returns:
            Tuple of (new_winner_elo, new_loser_elo)
        """
        # Get base K-factors
        k_winner = EloCalculator.get_k_factor(winner_matches)
        k_loser = EloCalculator.get_k_factor(loser_matches)

        # Adjust K-factor based on match importance
        importance_multipliers = {
            "regular": 1.0,
            "playoff": 1.3,
            "finals": 1.5
        }
        importance_mult = importance_multipliers.get(match_importance, 1.0)
        k_winner *= importance_mult
        k_loser *= importance_mult

        # Calculate expected scores
        expected_winner = EloCalculator.expected_score(winner_elo, loser_elo)
        expected_loser = EloCalculator.expected_score(loser_elo, winner_elo)

        # Get performance multiplier (map + round differential)
        if match_format in ["bo3", "bo5"] and winner_maps is not None and loser_maps is not None:
            # Use series multiplier for Bo3/Bo5
            performance_mult = EloCalculator.get_series_multiplier(
                winner_maps, loser_maps, winner_rounds, loser_rounds, match_format
            )
        else:
            # Use single map round differential for Bo1
            performance_mult = EloCalculator.get_round_differential_multiplier(winner_rounds, loser_rounds)

        # Calculate base ELO changes
        winner_base_change = k_winner * (1 - expected_winner) * performance_mult
        loser_base_change = k_loser * (0 - expected_loser) * performance_mult

        # Add upset bonus to winner if applicable
        upset_bonus = EloCalculator.get_upset_bonus(winner_elo, loser_elo)

        # Calculate new ratings
        new_winner_elo = winner_elo + winner_base_change + upset_bonus
        new_loser_elo = loser_elo + loser_base_change

        return new_winner_elo, new_loser_elo

    @staticmethod
    def predict_match_outcome(team1_elo: float, team2_elo: float) -> Dict[str, float]:
        """
        Predict the outcome of a match between two teams

        Returns:
            Dictionary with win probabilities for each team
        """
        team1_win_prob = EloCalculator.expected_score(team1_elo, team2_elo)
        team2_win_prob = 1 - team1_win_prob

        return {
            "team1_win_probability": round(team1_win_prob * 100, 2),
            "team2_win_probability": round(team2_win_prob * 100, 2),
            "elo_difference": abs(team1_elo - team2_elo),
            "favorite": "Team 1" if team1_elo > team2_elo else "Team 2" if team2_elo > team1_elo else "Even"
        }

    @staticmethod
    def estimate_elo_changes(team1_elo: float, team2_elo: float,
                            team1_matches: int, team2_matches: int,
                            winner_rounds: int = 13, loser_rounds: int = 0,
                            match_importance: str = "regular") -> Dict[str, Dict[str, float]]:
        """
        Estimate ELO changes for both possible match outcomes

        Returns:
            Dictionary with ELO changes for both scenarios
        """
        # If team 1 wins
        new_t1_elo_win, new_t2_elo_loss = EloCalculator.calculate_new_elo(
            team1_elo, team2_elo, team1_matches, team2_matches,
            winner_rounds, loser_rounds, match_importance
        )

        # If team 2 wins
        new_t2_elo_win, new_t1_elo_loss = EloCalculator.calculate_new_elo(
            team2_elo, team1_elo, team2_matches, team1_matches,
            winner_rounds, loser_rounds, match_importance
        )

        return {
            "if_team1_wins": {
                "team1_elo": round(new_t1_elo_win, 0),
                "team2_elo": round(new_t2_elo_loss, 0),
                "team1_change": round(new_t1_elo_win - team1_elo, 0),
                "team2_change": round(new_t2_elo_loss - team2_elo, 0)
            },
            "if_team2_wins": {
                "team1_elo": round(new_t1_elo_loss, 0),
                "team2_elo": round(new_t2_elo_win, 0),
                "team1_change": round(new_t1_elo_loss - team1_elo, 0),
                "team2_change": round(new_t2_elo_win - team2_elo, 0)
            }
        }
