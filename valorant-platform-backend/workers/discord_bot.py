"""Discord role/nickname worker (SDD 2026-08-14 leaderboard standardization, task 9).

Ports ``valorantsl-new/discord-bot`` onto this repo's shared
``LeaderboardPlayerRepository`` (task 1). Two bots (R37) split the guild's
members by ID every 15 minutes: per member the VALORANT rank tier (read via the
shared ``get_rank_field`` dual-shape reader, R40) is mapped to Alpha/Omega +
rank + Verified roles and a ``{name} ({rank})`` nickname (Discord's 32-char
cap), and bot 1 additionally writes discord_id/discord_username corrections
back to ``leaderboard_players`` via
``LeaderboardPlayerRepository.update_discord_identity`` (R39; per-player
commit). Members holding the "Manual" role keep their roles.

The mapping/decision logic is PURE module-level functions (``extract_rank_tier``,
``map_rank_nickname``, ``build_nickname``, ``rank_role_names``,
``sync_discord_identity``) — fully unit-testable without a Discord connection;
``DiscordBotRunner`` is the thin ``discord.py`` layer (``member.edit``,
``add_roles``/``remove_roles``, ``discord.utils.get``).
"""

from __future__ import annotations

import asyncio
import logging
import sys
from collections.abc import Callable

import discord
from discord.ext import commands
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db.repositories.leaderboard_player_repository import LeaderboardPlayerRepository
from app.db.session import SessionFactory
from app.middleware.write_freeze import refuse_writer_start
from app.services.rank_field import get_rank_field

logger = logging.getLogger(__name__)

# Rank configuration (verbatim from valorantsl-new/discord-bot lines 58-70).
ALPHA_RANKS = ["Diamond", "Ascendant", "Radiant", "Immortal"]
OMEGA_RANKS = ["Bronze", "Silver", "Gold", "Platinum", "Iron"]
RANK_NAMES_MAPPER = {
    "Iron": "Iron",
    "Bronze": "Brz",
    "Silver": "Slv",
    "Gold": "Gld",
    "Platinum": "Plt",
    "Ascendant": "Asc",
    "Diamond": "Dia",
    "Immortal": "Imm",
    "Radiant": "Radiant",
}


# ------------------------------------------------------------------- PURE logic


def extract_rank_tier(rank: str) -> str:
    """Tier from a rank label (source 370): ``"Diamond 3"`` -> ``"Diamond"``; ``"Unknown"`` stays ``"Unknown"``."""
    return rank.split(" ")[0] if rank != "Unknown" else "Unknown"


def map_rank_nickname(tier: str) -> str:
    """Nickname-safe rank abbreviation (``"Diamond"`` -> ``"Dia"``); unknown tiers pass through."""
    return RANK_NAMES_MAPPER.get(tier, tier)


def build_nickname(global_name: str, tier: str) -> str:
    """``{global_name} ({mapped_rank})`` (source 260-268), truncated to 32 chars, name first."""
    mapped_rank = map_rank_nickname(tier)
    nickname = f"{global_name} ({mapped_rank})"
    if len(nickname) > 32:
        max_name_length = 32 - len(f" ({mapped_rank})")
        global_name = global_name[:max_name_length]
        nickname = f"{global_name} ({mapped_rank})"
    return nickname


def rank_role_names(tier: str) -> tuple[str | None, str | None, str | None]:
    """Role names for ``tier``: ``(team_role, rank_role, verified_role)`` (source 310-336).

    Alpha tiers -> ``("Alpha", tier, "Verified")``, Omega tiers ->
    ``("Omega", tier, "Verified")``; any other tier -> ``(None, None, None)``.
    """
    if tier in ALPHA_RANKS:
        return ("Alpha", tier, "Verified")
    if tier in OMEGA_RANKS:
        return ("Omega", tier, "Verified")
    return (None, None, None)


async def sync_discord_identity(repo, *, discord_id: str, discord_username: str, players) -> bool:
    """Bot-1 DB write-back for one member (source ``update_database_discord_data``).

    Finds the first ``players`` row whose stored ``discord_id`` matches the
    member's and, when the stored identity has drifted, calls
    ``repo.update_discord_identity`` with the member's CURRENT ``discord_id`` /
    ``discord_username`` (R39; per-player commit). Returns True only when a
    write-back happened and succeeded; False when the member has no matching
    row, the stored identity already matches, or the row vanished
    (``update_discord_identity`` returned False). ``repo`` is duck-typed so a
    fake repo can drive tests.
    """
    for player in players:
        db_discord_id = str(player.discord_id or "")
        if not db_discord_id:
            continue
        if db_discord_id == discord_id:
            if player.discord_username != discord_username:
                return await repo.update_discord_identity(player.puuid, discord_id, discord_username)
            break
    return False


# ------------------------------------------------------------- thin Discord layer


class DiscordBotRunner:
    """Thin ``discord.py`` layer: per-member role/nickname updates + bot-1 write-back.

    Mirror of valorantsl-new's ``DiscordBotRunner``, re-pointed at
    ``LeaderboardPlayerRepository``. ``repo_factory`` is a zero-arg callable
    returning a fresh ``AsyncSession`` (the runner wraps it in a repository and
    owns the session's lifecycle); tokens/guild come from ``config``.
    """

    def __init__(self, bot_id: int, config: dict, repo_factory: Callable[[], AsyncSession]) -> None:
        self.bot_id = bot_id
        self.config = config
        self.repo_factory = repo_factory
        self.logger = logging.getLogger(f"discord_bot.bot{bot_id}")
        self.interval_minutes = config.get("update_interval_minutes", 15)
        self.rate_limit_delay = config.get("rate_limit_delay", 0.5)

        intents = discord.Intents.default()
        intents.members = True
        intents.guilds = True
        intents.message_content = True
        self.bot = commands.Bot(command_prefix="!", intents=intents)
        self._register_events()

    def _register_events(self) -> None:
        """Start the 15-min loop on ready; bot 1 also greets new members (source parity)."""

        @self.bot.event
        async def on_ready() -> None:
            self.logger.info("%s connected to Discord", self.bot.user)
            self.bot.loop.create_task(self.main_loop())

        if self.bot_id == 1:
            @self.bot.event
            async def on_member_join(member) -> None:
                guild = self.bot.get_guild(self.config["discord_guild_id"])
                if guild is None:
                    return
                self.logger.info("new member joined: %s (ID: %s)", member.name, member.id)
                session = self.repo_factory()
                try:
                    repo = LeaderboardPlayerRepository(session)
                    await self.update_discord_roles(member, await repo.list_all())
                finally:
                    await session.close()

    async def update_nickname(self, member, global_name: str, rank_tier: str) -> None:
        """Edit the member's nickname to ``{global_name} ({mapped_rank})`` (32-char cap)."""
        try:
            await member.edit(nick=build_nickname(global_name, rank_tier))
            self.logger.info("updated display name for %s", member.name)
        except discord.errors.Forbidden:
            self.logger.warning("bot lacks permissions to update display name for %s", member.name)
        except Exception:
            self.logger.exception("error updating nickname for %s", member.name)

    async def update_roles(self, member, new_roles: list) -> None:
        """Reconcile bot-managed roles while preserving unrelated member roles."""
        try:
            managed_role_names = {
                "Unverified",
                *(
                    role_name
                    for tier in (*ALPHA_RANKS, *OMEGA_RANKS)
                    for role_name in rank_role_names(tier)
                    if role_name is not None
                ),
            }
            roles_to_remove = [role for role in member.roles if role.name in managed_role_names]
            if roles_to_remove:
                await member.remove_roles(*roles_to_remove)
                self.logger.info(
                    "%s: removed roles: %s",
                    member.name,
                    ", ".join(role.name for role in roles_to_remove),
                )
            else:
                self.logger.info("%s: no roles to remove", member.name)

            roles_to_add = [role for role in new_roles if role.name in managed_role_names]
            if roles_to_add:
                await member.add_roles(*roles_to_add)
                self.logger.info(
                    "%s: added roles: %s",
                    member.name,
                    ", ".join(role.name for role in roles_to_add),
                )
        except discord.errors.Forbidden:
            self.logger.warning("bot lacks permissions to update roles for %s", member.name)
        except discord.errors.NotFound as exc:
            self.logger.error("role not found in the server: %s", exc)
        except Exception:
            self.logger.exception("error updating roles for %s", member.name)

    async def get_new_roles(self, member, rank_tier: str) -> list:
        """Resolve the tier's role names (``rank_role_names``) to guild role objects."""
        role_names = [name for name in rank_role_names(rank_tier) if name is not None]
        return [
            role
            for name in role_names
            if (role := discord.utils.get(member.guild.roles, name=name)) is not None
        ]

    async def update_discord_roles(self, member, players) -> None:
        """Update one member's nickname + roles from their stored rank (source ``update_discord_roles``)."""
        if member.bot:
            self.logger.info("skipping Discord bot member %s", member.name)
            return

        manual_role = discord.utils.get(member.guild.roles, name="Manual")
        if manual_role in member.roles:
            self.logger.info("skipping update for %s: has 'Manual' role", member.name)
            return

        global_name = member.global_name or member.name
        discord_id = str(member.id)

        player = next(
            (p for p in players if p.discord_id and str(p.discord_id) == discord_id),
            None,
        )

        if player is None:
            unverified_role = discord.utils.get(member.guild.roles, name="Unverified")
            await self.update_roles(member, [unverified_role] if unverified_role else [])
            await self.update_nickname(member, global_name, "Unverified")
            return

        # R40: shared dual-shape reader (flat ``rank_details[key]`` OR legacy
        # ``rank_details['data'][key]``) replaces the source's inline
        # ``'data' in rank_details`` check.
        rank = get_rank_field(player.rank_details, "currenttierpatched", "Unknown") or "Unknown"
        rank_tier = extract_rank_tier(str(rank))
        await self.update_nickname(member, global_name, rank_tier)

        await self.update_roles(member, await self.get_new_roles(member, rank_tier))

    async def main_loop(self) -> None:
        """Every 15 minutes: split the guild by member ID across the two bots.

        Bot 1 takes the first half of ``sorted(guild.members, key=id)``, bot 2
        the second. Per member: role/nickname update, then (bot 1 only) the
        discord_id/discord_username write-back for ALL members (source 392-437).
        """
        await self.bot.wait_until_ready()

        while not self.bot.is_closed():
            try:
                guild = self.bot.get_guild(self.config["discord_guild_id"])
                if guild is None:
                    self.logger.error("guild %s not found", self.config["discord_guild_id"])
                    continue

                session = self.repo_factory()
                try:
                    repo = LeaderboardPlayerRepository(session)
                    players = await repo.list_all()

                    members = sorted(guild.members, key=lambda member: member.id)
                    half = len(members) // 2
                    target = members[:half] if self.bot_id == 1 else members[half:]
                    self.logger.info("bot %s processing %s members", self.bot_id, len(target))

                    for member in target:
                        if member.bot:
                            continue
                        await self.update_discord_roles(member, players)
                        await asyncio.sleep(self.rate_limit_delay)

                    if self.bot_id == 1:
                        self.logger.info("bot 1 updating database discord data for all members")
                        for member in members:
                            if member.bot:
                                continue
                            await sync_discord_identity(
                                repo,
                                discord_id=str(member.id),
                                discord_username=member.name,
                                players=players,
                            )
                            await asyncio.sleep(self.rate_limit_delay)
                finally:
                    await session.close()
            except Exception:
                self.logger.exception("error in main loop")
            finally:
                self.logger.info(
                    "sleeping for %s minutes before next iteration",
                    self.interval_minutes,
                )
                await asyncio.sleep(self.interval_minutes * 60)

    async def run(self) -> None:
        """Start the bot (logs in with this runner's token)."""
        token = self.config[f"discord_token_{self.bot_id}"]
        await self.bot.start(token)

    async def close(self) -> None:
        """Close the bot's Discord connection."""
        await self.bot.close()


# ----------------------------------------------------------------------- entry


async def _run_bots(settings: Settings) -> None:
    """Run both bots concurrently (mirror of valorantsl-new's ``BotManager``)."""
    if not refuse_writer_start("valorant-discord-bot", settings):
        return
    config = {
        "discord_token_1": settings.discord_token_1,
        "discord_token_2": settings.discord_token_2,
        "discord_guild_id": settings.discord_guild_id,
    }
    bot1 = DiscordBotRunner(bot_id=1, config=config, repo_factory=SessionFactory)
    bot2 = DiscordBotRunner(bot_id=2, config=config, repo_factory=SessionFactory)
    try:
        await asyncio.gather(bot1.run(), bot2.run())
    finally:
        await asyncio.gather(bot1.close(), bot2.close(), return_exceptions=True)


def main() -> None:
    """CLI entry point: ``python -m workers.discord_bot`` — run both Discord bots.

    ``logging.basicConfig`` (R31) so a standalone run emits INFO output. Empty
    tokens (the R38 defaults) abort with a non-zero exit: starting a bot with an
    empty token is a deployment misconfiguration, and failing fast beats
    discord.py's cryptic login error.
    """
    settings = get_settings()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    if not refuse_writer_start("valorant-discord-bot", settings):
        return
    if not settings.discord_token_1 or not settings.discord_token_2:
        logger.error("discord_token_1/discord_token_2 must be set (D7 Discord app)")
        sys.exit(1)
    if settings.discord_guild_id == 0:
        logger.error("discord_guild_id is 0; set a valid guild id (D7 Discord app)")
        sys.exit(1)
    try:
        asyncio.run(_run_bots(settings))
    except KeyboardInterrupt:
        logger.info("discord bots stopped by user")
        sys.exit(0)
    except Exception:
        logger.exception("fatal error running discord bots")
        sys.exit(1)


if __name__ == "__main__":
    main()
