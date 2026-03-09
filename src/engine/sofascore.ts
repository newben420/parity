import { Extracted } from './../model/prompt';
import { FeaturedPlayersResponse, H2HResponse, MatchManagersResponse, OverallResponse, PregameResponse, StandingsResponse } from './../model/sofascore_2';
import { axiosUndici } from './../lib/axios';
import { getTimeElapsed } from './../lib/date_time';
import { Match, SofaScoreResponse, Event, Tournament } from './../model/sofascore';
import { Log } from './../lib/log';
import path from "path";
import { Site } from "./../site";
import { existsSync, mkdirSync, readFile, writeFileSync } from "fs";
import { normalizeName } from './../lib/sofa_lib';
import { ClientIdentifier, initTLS, Session } from "node-tls-client";
import stringSimilarity from "string-similarity";
import { findBestMatch } from './../lib/fbm';

const SLUG = "SSEngine";
const WEIGHT = 2;

interface InitialData {
    statistics?: any;
    h2h?: any;
    teamStats?: any;
}

declare global {
    interface Window {
        __INITIAL_DATA__?: InitialData;
    }
}

const goodNum = (n: any) => Number.isFinite(n) ? parseFloat(n.toFixed(4)) : n;

export class SofascoreEngine {
    private static file = path.join(Site.ROOT, ".data", "sofascore_v2.json");

    private static matchesByTeam: Map<string, Match[]> = new Map();
    private static matchesByID: Map<number, Match> = new Map();

    private static tournamentsByDate: Map<string, Tournament[]> = new Map();
    private static fetchedTournamentsPerDate: Map<string, Set<number>> = new Map();

    private static session: Session;

    private static matches2pointers = (matches: Match[]) => {
        const allTeams: string[] = [];
        SofascoreEngine.matchesByTeam.clear();
        SofascoreEngine.matchesByID.clear();
        const checkTeam = (team: string, match: Match) => {
            if (!allTeams.includes(team)) {
                if (!SofascoreEngine.matchesByTeam.has(team)) {
                    SofascoreEngine.matchesByTeam.set(team, []);
                }
                const newVal = SofascoreEngine.matchesByTeam.get(team)!.concat([match]);
                SofascoreEngine.matchesByTeam.set(team, newVal);
            }
        }
        for (const match of matches) {
            checkTeam(match.home, match);
            checkTeam(match.away, match);
            SofascoreEngine.matchesByID.set(match.id, match);
        }
    }

    private static getMatchData = async (match: Match) => {
        try {
            const goTO = async (url: string) => {
                try {
                    const res = await SofascoreEngine.request(url);
                    return res;
                } catch (error: any) {
                    if (!error.message?.includes('404')) {
                        Log.dev(error.message || error);
                    }
                    return null;
                }
            }

            const pregameForm: PregameResponse | null = await goTO(`https://www.sofascore.com/api/v1/event/${match.id}/pregame-form`);
            const h2h: H2HResponse | null = await goTO(`https://www.sofascore.com/api/v1/event/${match.id}/h2h`);
            const managers: MatchManagersResponse | null = await goTO(`https://www.sofascore.com/api/v1/event/${match.id}/managers`);
            const featuredPlayersHome: FeaturedPlayersResponse | null = await goTO(`https://www.sofascore.com/api/v1/team/${match.homeId}/featured-players`);
            const featuredPlayersAway: FeaturedPlayersResponse | null = await goTO(`https://www.sofascore.com/api/v1/team/${match.awayId}/featured-players`);
            const statsHome: OverallResponse | null = await goTO(`https://www.sofascore.com/api/v1/team/${match.homeId}/unique-tournament/${match.tId}/season/${match.seasonId}/statistics/overall`);
            const statsAway: OverallResponse | null = await goTO(`https://www.sofascore.com/api/v1/team/${match.awayId}/unique-tournament/${match.tId}/season/${match.seasonId}/statistics/overall`);
            const leagueStandings: StandingsResponse | null = await goTO(`https://www.sofascore.com/api/v1/tournament/${match.leagueId}/season/${match.seasonId}/standings/total`);


            const leagueTotalMatches = (leagueStandings && leagueStandings.standings.length > 0) ? (leagueStandings.standings[0].rows.map(r => r.matches).reduce((a, b) => a + b, 0)) : null;
            const leagueTotalDraws = (leagueStandings && leagueStandings.standings.length > 0) ? (leagueStandings.standings[0].rows.map(r => r.draws).reduce((a, b) => a + b, 0)) : null;

            const homeDraws = (leagueStandings && leagueStandings.standings.length > 0) ? (leagueStandings.standings[0].rows.filter(r => r.team.id == match.homeId).map(r => r.draws).reduce((a, b) => a + b, 0)) : null;
            const homeWins = (leagueStandings && leagueStandings.standings.length > 0) ? (leagueStandings.standings[0].rows.filter(r => r.team.id == match.homeId).map(r => r.wins).reduce((a, b) => a + b, 0)) : null;
            const homeLosses = (leagueStandings && leagueStandings.standings.length > 0) ? (leagueStandings.standings[0].rows.filter(r => r.team.id == match.homeId).map(r => r.losses).reduce((a, b) => a + b, 0)) : null;
            const homeMatches = (leagueStandings && leagueStandings.standings.length > 0) ? (leagueStandings.standings[0].rows.filter(r => r.team.id == match.homeId).map(r => r.matches).reduce((a, b) => a + b, 0)) : null;
            const homePoints = (leagueStandings && leagueStandings.standings.length > 0) ? (leagueStandings.standings[0].rows.filter(r => r.team.id == match.homeId).map(r => r.points).reduce((a, b) => a + b, 0)) : null;
            const homePosition = (leagueStandings && leagueStandings.standings.length > 0) ? (leagueStandings.standings[0].rows.filter(r => r.team.id == match.homeId).map(r => r.position).reduce((a, b) => a + b, 0)) : null;

            const awayDraws = (leagueStandings && leagueStandings.standings.length > 0) ? (leagueStandings.standings[0].rows.filter(r => r.team.id == match.awayId).map(r => r.draws).reduce((a, b) => a + b, 0)) : null;
            const awayWins = (leagueStandings && leagueStandings.standings.length > 0) ? (leagueStandings.standings[0].rows.filter(r => r.team.id == match.awayId).map(r => r.wins).reduce((a, b) => a + b, 0)) : null;
            const awayLosses = (leagueStandings && leagueStandings.standings.length > 0) ? (leagueStandings.standings[0].rows.filter(r => r.team.id == match.awayId).map(r => r.losses).reduce((a, b) => a + b, 0)) : null;
            const awayMatches = (leagueStandings && leagueStandings.standings.length > 0) ? (leagueStandings.standings[0].rows.filter(r => r.team.id == match.awayId).map(r => r.matches).reduce((a, b) => a + b, 0)) : null;
            const awayPoints = (leagueStandings && leagueStandings.standings.length > 0) ? (leagueStandings.standings[0].rows.filter(r => r.team.id == match.awayId).map(r => r.points).reduce((a, b) => a + b, 0)) : null;
            const awayPosition = (leagueStandings && leagueStandings.standings.length > 0) ? (leagueStandings.standings[0].rows.filter(r => r.team.id == match.awayId).map(r => r.position).reduce((a, b) => a + b, 0)) : null;

            const response: Extracted = {
                league_context: {
                    league_name: match.league,
                    season: match.season,
                    season_draw_rate: goodNum(leagueTotalMatches && leagueTotalDraws ? (leagueTotalDraws / leagueTotalMatches) : null),
                },
                home_team_stats: {
                    pregame: (pregameForm && pregameForm.homeTeam) ? {
                        avgRating: pregameForm.homeTeam.avgRating,
                        position: pregameForm.homeTeam.position,
                        form: pregameForm.homeTeam.form,

                    } : {},
                    season: (statsHome && statsHome.statistics) ? {
                        drawRate: goodNum((homeDraws && homeMatches) ? (homeDraws / homeMatches) : null),
                        winRate: goodNum((homeWins && homeMatches) ? (homeWins / homeMatches) : null) || 0,
                        loseRate: goodNum((homeLosses && homeMatches) ? (homeLosses / homeMatches) : null) || 0,
                        points: homePoints ?? undefined,
                        position: homePosition ?? undefined,
                        goalsScored: statsHome.statistics.goalsScored,
                        goalsConceded: statsHome.statistics.goalsConceded,
                        matches: statsHome.statistics.matches,
                        bigChances: statsHome.statistics.bigChances,
                        bigChancesAgainst: statsHome.statistics.bigChancesAgainst,
                        goalsAgainstPerMatch: goodNum((statsHome.statistics.goalsConceded / statsHome.statistics.matches) || 0),
                        goalDifferencePerMatch: goodNum(((statsHome.statistics.goalsScored - statsHome.statistics.goalsConceded) / statsHome.statistics.matches) || 0),
                        chanceBalance: (statsHome.statistics.bigChances - statsHome.statistics.bigChancesAgainst) || 0,
                    } : {},
                    fixture: {
                        featuredPlayers: (Array.from(new Set(((featuredPlayersHome && featuredPlayersHome.featuredPlayers) ? Object.entries(featuredPlayersHome.featuredPlayers).map(k => ({ name: k[1].player.name, rating: k[1].statistics.rating, position: k[1].player.position })) : []).map(x => JSON.stringify(x))))).map(x => JSON.parse(x)),
                    }
                },
                away_team_stats: {
                    pregame: (pregameForm && pregameForm.awayTeam) ? {
                        avgRating: pregameForm.awayTeam.avgRating,
                        position: pregameForm.awayTeam.position,
                        form: pregameForm.awayTeam.form,

                    } : {},
                    season: (statsAway && statsAway.statistics) ? {
                        drawRate: goodNum((awayDraws && awayMatches) ? (awayDraws / awayMatches) : null),
                        winRate: goodNum((awayWins && awayMatches) ? (awayWins / awayMatches) : null),
                        loseRate: goodNum((awayLosses && awayMatches) ? (awayLosses / awayMatches) : null),
                        points: awayPoints ?? undefined,
                        position: awayPosition ?? undefined,
                        goalsScored: statsAway.statistics.goalsScored,
                        goalsConceded: statsAway.statistics.goalsConceded,
                        matches: statsAway.statistics.matches,
                        bigChances: statsAway.statistics.bigChances,
                        bigChancesAgainst: statsAway.statistics.bigChancesAgainst,
                        goalsAgainstPerMatch: goodNum((statsAway.statistics.goalsConceded / statsAway.statistics.matches) || 0),
                        goalDifferencePerMatch: goodNum(((statsAway.statistics.goalsScored - statsAway.statistics.goalsConceded) / statsAway.statistics.matches) || 0),
                        chanceBalance: (statsAway.statistics.bigChances - statsAway.statistics.bigChancesAgainst) || 0,
                    } : {},
                    fixture: {
                        featuredPlayers: (Array.from(new Set(((featuredPlayersAway && featuredPlayersAway.featuredPlayers) ? Object.entries(featuredPlayersAway.featuredPlayers).map(k => ({ name: k[1].player.name, rating: k[1].statistics.rating, position: k[1].player.position })) : []).map(x => JSON.stringify(x))))).map(x => JSON.parse(x)),
                    }
                },
                head_to_head: (h2h && h2h.teamDuel) ? {
                    totalMeetings: h2h.teamDuel.homeWins + h2h.teamDuel.awayWins + h2h.teamDuel.draws,
                    homeWins: h2h.teamDuel.homeWins,
                    awayWins: h2h.teamDuel.awayWins,
                    draws: h2h.teamDuel.draws,
                } : {},
                managers: (managers && managers.homeManager && managers.awayManager) ? {
                    home: managers.homeManager.name,
                    away: managers.awayManager.name,
                    h2h: (h2h?.managerDuel) ? {
                        homeWins: h2h.managerDuel.homeWins,
                        awayWins: h2h.managerDuel.awayWins,
                        draws: h2h.managerDuel.draws,
                    } : {}
                } : {}
            };



            return response;
        } catch (error) {
            Log.dev(error);
            return null;
        }
    }

    private static getToday = (date: Date = new Date()) => {
        const y = date.getFullYear().toString();
        const m = (date.getMonth() + 1).toString().padStart(2, '0');
        const d = date.getDate().toString().padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    private static fetchJson = async (url: string, attempt = 1): Promise<any> => {
        const MAX_RETRIES = 5;
        const RETRY_DELAY = 5000; // 5s

        try {
            const json = await SofascoreEngine.request(url);
            if (!json) throw new Error(`Empty or invalid response for ${url}`);
            return json;
        } catch (error: any) {
            if (attempt < MAX_RETRIES) {
                const delay = RETRY_DELAY * attempt;
                await SofascoreEngine.sleep(delay);
                return SofascoreEngine.fetchJson(url, attempt + 1);
            }
            throw error;
        }
    };

    private static request = async (url: string, headers: Record<string, string> = {}, json: boolean = true): Promise<any> => {
        try {
            const response = await SofascoreEngine.session.get(url, {
                headers: {
                    "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "accept": "application/json",
                    ...headers
                }
            });

            if (response.status !== 200) {
                if (response.status !== 404) {
                    Log.dev(`Unexpected status ${response.status}: ${url}`);
                }
                return null;
            }

            const text = await response.text();
            if (!json) {
                return text;
            }
            if (!text || text.length < 10) return null;

            return JSON.parse(text);
        } catch (error) {
            throw error;
        }
    }

    private static initTournaments = async (dateStr: string) => {
        if (SofascoreEngine.tournamentsByDate.has(dateStr)) return;

        const tournamentsUrl = `https://api.sofascore.com/api/v1/sport/football/scheduled-tournaments/${dateStr}`;
        try {
            Log.flow([SLUG, `Fetching tournament list for ${dateStr}...`], WEIGHT);
            const tournamentsData = await SofascoreEngine.fetchJson(tournamentsUrl);

            if (tournamentsData && tournamentsData.scheduled) {
                const tournaments = tournamentsData.scheduled.map((t: any) => t.tournament).filter(Boolean);
                SofascoreEngine.tournamentsByDate.set(dateStr, tournaments);
                Log.flow([SLUG, `Found ${tournaments.length} tournaments for ${dateStr}.`], WEIGHT);
            } else {
                SofascoreEngine.tournamentsByDate.set(dateStr, []);
            }
        } catch (error: any) {
            Log.dev(`Failed to fetch tournaments for ${dateStr}: ${error.message}`);
            // Don't set empty array here if it was a network error, maybe retry later?
            // But for now, let's treat it as empty to avoid infinite loops if requested again.
            SofascoreEngine.tournamentsByDate.set(dateStr, []);
        }
    }

    private static ensureTournamentEvents = async (tournament: Tournament, dateStr: string) => {
        const tid = tournament.uniqueTournament?.id ?? tournament.id;
        const isUnique = !!tournament.uniqueTournament;

        const fetchedSet = SofascoreEngine.fetchedTournamentsPerDate.get(dateStr) || new Set();
        if (fetchedSet.has(tid)) return;

        // Use correct endpoint based on ID type
        const endpointType = isUnique ? "unique-tournament" : "tournament";
        const url = `https://api.sofascore.com/api/v1/${endpointType}/${tid}/scheduled-events/${dateStr}`;

        try {
            Log.flow([SLUG, `On-demand fetching events for ${tournament.name} (${tid}) on ${dateStr}...`], WEIGHT);
            const data = await SofascoreEngine.fetchJson(url);

            // Mark as fetched even if data is null/empty to avoid repeated 404/failure hits
            fetchedSet.add(tid);
            SofascoreEngine.fetchedTournamentsPerDate.set(dateStr, fetchedSet);

            if (data && data.events) {
                const matches: Match[] = data.events.filter((event: Event) => event.status.code == 0).map((event: Event) => {
                    return {
                        home: normalizeName(event.homeTeam.name),
                        homeId: event.homeTeam.id,
                        away: normalizeName(event.awayTeam.name),
                        awayId: event.awayTeam.id,
                        id: event.id,
                        slug: event.slug,
                        startTime: event.startTimestamp * 1000,
                        league: normalizeName(event.tournament.name),
                        leagueId: event.tournament.id,
                        customId: event.customId,
                        season: event.season.name,
                        seasonId: event.season.id,
                        tId: event.tournament.uniqueTournament?.id ?? event.tournament.id,
                    };
                });

                // Update matchesByTeam and matchesByID
                for (const m of matches) {
                    if (!SofascoreEngine.matchesByID.has(m.id)) {
                        SofascoreEngine.matchesByID.set(m.id, m);

                        const updateTeamMatches = (team: string, match: Match) => {
                            if (!SofascoreEngine.matchesByTeam.has(team)) {
                                SofascoreEngine.matchesByTeam.set(team, []);
                            }
                            SofascoreEngine.matchesByTeam.get(team)!.push(match);
                        }
                        updateTeamMatches(m.home, m);
                        updateTeamMatches(m.away, m);
                    }
                }
                Log.flow([SLUG, `Fetched ${matches.length} events for ${tournament.name} on ${dateStr}.`], WEIGHT);
            }
        } catch (e: any) {
            Log.dev(`Failed to fetch events for tournament ${tid} on ${dateStr}: ${e.message}`);
            // Still mark as fetched to avoid being stuck in a retry loop if it's a 404
            fetchedSet.add(tid);
            SofascoreEngine.fetchedTournamentsPerDate.set(dateStr, fetchedSet);
        }
    }

    private static lastFetchDay: string = ``;

    private static dataDirectory = path.join(Site.ROOT, ".data");


    static start = () => new Promise<boolean>(async (resolve, reject) => {

        if (Site.GROQ_USE) {
            if (!existsSync(SofascoreEngine.dataDirectory)) {
                mkdirSync(SofascoreEngine.dataDirectory, { recursive: true });
            }

            const loadFile = () => new Promise<boolean>((res, rej) => {
                if (existsSync(SofascoreEngine.file)) {
                    readFile(SofascoreEngine.file, "utf8", (err, data) => {
                        if (err) {
                            Log.dev(err.message || err);
                            res(false);
                        }
                        else {
                            try {
                                const today = SofascoreEngine.getToday();
                                const d = JSON.parse(data);
                                SofascoreEngine.lastFetchDay = d.day;

                                // Load matches
                                if (d.matches && Array.isArray(d.matches)) {
                                    SofascoreEngine.matches2pointers(d.matches);
                                    Log.flow([SLUG, `Loaded persisted matches`, `Count = ${d.matches.length}.`], WEIGHT);
                                }

                                // Load tournaments
                                if (d.tournaments) {
                                    for (const [date, tournaments] of Object.entries(d.tournaments)) {
                                        if (date >= today) {
                                            SofascoreEngine.tournamentsByDate.set(date, tournaments as Tournament[]);
                                        }
                                    }
                                }

                                // Load fetched status
                                if (d.fetched) {
                                    for (const [date, ids] of Object.entries(d.fetched)) {
                                        if (date >= today) {
                                            SofascoreEngine.fetchedTournamentsPerDate.set(date, new Set(ids as number[]));
                                        }
                                    }
                                }

                            } catch (error) {
                                Log.dev(`Failed to parse persistence file: ${error}`);
                            }
                            res(true);
                        }
                    });
                }
                else {
                    res(true);
                }
            });
            const ensureSession = () => new Promise<boolean>(async (res, rej) => {
                try {
                    await initTLS();
                    SofascoreEngine.session = new Session({
                        clientIdentifier: ClientIdentifier.chrome_120,
                        randomTlsExtensionOrder: true
                    });
                    res(true);
                } catch (error: any) {
                    Log.dev(error.message || error);
                    res(false);
                }
            })
            const loaded = (await loadFile()) && (await ensureSession());
            if (loaded) {
                if (SofascoreEngine.matchesByID.size == 0) {
                    SofascoreEngine.run();
                }
                else {
                    const msToNextMidnight = (new Date().setHours(24, 0, 0, 0)) - Date.now();
                    setTimeout(() => {
                        SofascoreEngine.run();
                    }, msToNextMidnight);
                    Log.flow([SLUG, `Fetch scheduled in ${getTimeElapsed(0, msToNextMidnight)}.`], WEIGHT);
                }
            }
            resolve(loaded);
        }
        else {
            resolve(true);
        }
    });

    static get = async ({
        away,
        home,
        league,
        startTime
    }: {
        home: string;
        away: string;
        league: string;
        startTime: number;
    }): Promise<Extracted | null> => {
        const event = `${home} vs ${away}`;
        const date = new Date(startTime);
        const dateStr = SofascoreEngine.getToday(date);

        // Ensure tournaments for this date are loaded
        await SofascoreEngine.initTournaments(dateStr);

        // Find match candidates (multiple tournament IDs may be returned)
        const candidates = SofascoreEngine.findTournamentMatches(league, dateStr);
        if (candidates.length > 0) {
            // Ensure events for all matched tournaments are loaded
            await Promise.all(candidates.map(t => SofascoreEngine.ensureTournamentEvents(t, dateStr)));
        }

        const match = SofascoreEngine.findMatch(home, away, league, startTime);
        if (match) {
            Log.flow([SLUG, event, `Match found. extracting stats.`], WEIGHT);
            const s = await SofascoreEngine.getMatchData(match);
            if (s) {
                Log.flow([SLUG, event, `Stats found.`], WEIGHT);
            }
            else {
                Log.flow([SLUG, event, `Stats not found.`], WEIGHT);
            }
            return s;
        }
        else {
            Log.flow([SLUG, event, `Match not found.`], WEIGHT);
        }
        return null;
    }

    private static cleanLeagueName = (name: string): string => {
        const cleaned = name.toLowerCase()
            .replace(/\b(league|cup|division|divisione|liga|primera|super|premier|championship|qualification|group|stage|playoffs|women|youth|u[0-9]+|national|pro|league 1|league 2|league one|league two|major|serie a|serie b|eredivisie|primeira|ligue 1|ligue 2)\b/g, "")
            .replace(/[^a-z0-9 ]/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        // Fallback to normalized name if cleaning results in empty string (e.g. for "Championship")
        return cleaned || name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    }

    private static findTournamentMatches = (league: string, dateStr: string): Tournament[] => {
        const list = SofascoreEngine.tournamentsByDate.get(dateStr) || [];
        if (list.length === 0) return [];

        const target = SofascoreEngine.cleanLeagueName(league);
        const originalTarget = league.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
        if (!target) return [];

        const multiMatch = (useCleaned: boolean): { tournament: Tournament; score: number }[] => {
            const matches: { tournament: Tournament; score: number }[] = [];
            const seenIDs = new Set<number>();
            const currentTarget = useCleaned ? target : originalTarget;

            for (const t of list) {
                const tid = t.uniqueTournament?.id ?? t.id;
                if (seenIDs.has(tid)) continue;

                const name1 = useCleaned ? SofascoreEngine.cleanLeagueName(t.name) : t.name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
                const name2 = t.uniqueTournament ? (useCleaned ? SofascoreEngine.cleanLeagueName(t.uniqueTournament.name) : t.uniqueTournament.name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()) : "";

                const score1 = stringSimilarity.compareTwoStrings(currentTarget, name1);
                const score2 = name2 ? stringSimilarity.compareTwoStrings(currentTarget, name2) : 0;
                const score = Math.max(score1, score2);

                if (score > 0.6) {
                    matches.push({ tournament: t, score });
                    seenIDs.add(tid);
                }
            }
            return matches;
        };

        // Pass 1: Match against cleaned names
        let matches = multiMatch(true);

        // Pass 2: If no strong matches found, try original names
        if (matches.length === 0 || matches[0].score < 0.7) {
            const fallbackMatches = multiMatch(false);
            if (fallbackMatches.length > 0 && (matches.length === 0 || fallbackMatches[0].score > matches[0].score)) {
                matches = fallbackMatches;
            }
        }

        matches.sort((a, b) => b.score - a.score);

        if (matches.length > 0) {
            const bestScore = matches[0].score;
            return matches
                .filter(m => m.score > 0.85 || (bestScore - m.score < 0.15))
                .map(m => m.tournament);
        }

        return [];
    }

    private static findMatch = (home: string, away: string, league: string, startTime: number): Match | null => {
        return findBestMatch(home, away, startTime, Array.from(SofascoreEngine.matchesByID.values()));
    };

    private static TIMEOUT = 30000;

    private static sleep = (ms: number) =>
        new Promise(res => setTimeout(res, ms));

    private static fetch = async (): Promise<any | null> => {
        // Now purely on-demand via get() -> initTournaments()
        return { success: true };
    };

    private static run = async () => {
        const start = Date.now();
        const conclude = () => {
            Log.flow([SLUG, `Cleanup`, `Concluded.`], WEIGHT);
            const interval = 1000 * 60 * 60 * 24;
            const duration = Date.now() - start;
            if (duration >= interval) {
                SofascoreEngine.run();
            }
            else {
                const timeToGetThere = interval - duration;
                setTimeout(() => {
                    SofascoreEngine.run();
                }, timeToGetThere);
            }
        }
        Log.flow([SLUG, `Cleanup`, `Initialized.`], WEIGHT);

        // Clean up old dates
        const today = SofascoreEngine.getToday();
        for (const date of SofascoreEngine.tournamentsByDate.keys()) {
            if (date < today) {
                SofascoreEngine.tournamentsByDate.delete(date);
                SofascoreEngine.fetchedTournamentsPerDate.delete(date);
            }
        }

        SofascoreEngine.lastFetchDay = today;
        conclude();
    }

    static stop = async (): Promise<boolean> => {
        // 1️⃣ Persist matches and tournaments
        const tournaments: Record<string, Tournament[]> = {};
        for (const [date, list] of SofascoreEngine.tournamentsByDate.entries()) {
            tournaments[date] = list;
        }

        const fetched: Record<string, number[]> = {};
        for (const [date, set] of SofascoreEngine.fetchedTournamentsPerDate.entries()) {
            fetched[date] = Array.from(set);
        }

        const data = {
            day: SofascoreEngine.lastFetchDay,
            matches: Array.from(SofascoreEngine.matchesByID.values()),
            tournaments,
            fetched
        };
        writeFileSync(SofascoreEngine.file, JSON.stringify(data), 'utf8');
        Log.flow([SLUG, `Persisted data`, `Matches = ${data.matches.length}, Tournaments = ${Object.keys(tournaments).length}.`], WEIGHT);

        // 3️⃣ Close pages and contexts safely
        try {
            if (SofascoreEngine.session) {
                SofascoreEngine.session.close();
            }
        } catch (err) {
            console.error('Error closing session:', err);
        }

        return true;
    };
}