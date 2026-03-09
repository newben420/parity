import { getTimeElapsed } from './../lib/date_time';
import { Log } from './../lib/log';
import { Site } from './../site';
import path from "path";
import { Event, Fixture, HistoricalFixture, Odds } from "./../model/sporty";
import { existsSync, mkdirSync } from 'fs';
import { SportyHelpers } from './sporty_helpers';
import { computeDrawScore, computeH2H, computeLeagueMetrics, computeTeamMetricsAll } from './../lib/sportylib';
import { DatabaseSync } from 'node:sqlite';
import { PromptEngine } from './prompt';
import { SofascoreEngine } from './sofascore';

const SLUG = "EVENTS";
const WEIGHT = 3;
const EVENT_DURATION = 1000 * 60 * 60 * 2; //2 Hours
const MAX_RESULT_RETRIES = 3;

export class EventsProcessor {

    private static dataDirectory = path.join(Site.ROOT, ".data");
    // private static eventsDirectory = path.join(Site.ROOT, ".data", "events");
    // private static seenEventsFile = path.join(EventsProcessor.dataDirectory, "seen_events.json");
    private static databaseFile = path.join(EventsProcessor.dataDirectory, "predicate.db");
    private static db: DatabaseSync;

    static start = async () => {
        if (!existsSync(EventsProcessor.dataDirectory)) {
            mkdirSync(EventsProcessor.dataDirectory, { recursive: true });
        }

        EventsProcessor.db = new DatabaseSync(EventsProcessor.databaseFile);

        // Initialize Schema
        EventsProcessor.db.exec(`
            CREATE TABLE IF NOT EXISTS fixtures (
                event_id TEXT NOT NULL,
                game_id TEXT NOT NULL,
                league TEXT NOT NULL,
                home TEXT NOT NULL,
                away TEXT NOT NULL,
                start_time INTEGER NOT NULL,

                -- Odds
                home_win REAL,
                draw REAL,
                away_win REAL,
                over05 REAL,
                over15 REAL,
                over25 REAL,
                over35 REAL,
                under05 REAL,
                under15 REAL,
                under25 REAL,
                under35 REAL,
                btts_yes REAL,
                btts_no REAL,
                dc1x REAL,
                dcx2 REAL,
                dc12 REAL,

                -- Results
                home_goals INTEGER,
                away_goals INTEGER,

                -- Engine metadata
                draw_score REAL DEFAULT 0,
                result_checked_count INTEGER DEFAULT 0,

                -- LLM
                llm_attempted INTEGER DEFAULT 0,
                llm_verdict TEXT,
                has_verdict INTEGER DEFAULT 0,
                adjustment_factor REAL DEFAULT 0,
                turned_off INTEGER DEFAULT 0,
                is_likely_draw INTEGER DEFAULT 0,

                PRIMARY KEY (event_id)
            );

            CREATE TABLE IF NOT EXISTS ai_verdicts (
                event_id TEXT NOT NULL,
                extracted_data TEXT,
                confidence REAL,
                verdict TEXT,
                PRIMARY KEY (event_id),
                FOREIGN KEY (event_id) REFERENCES fixtures(event_id)
            );
        `);

        // migratons
        try {
            EventsProcessor.db.exec("ALTER TABLE fixtures ADD COLUMN llm_attempted INTEGER DEFAULT 0");
        } catch (e) {
            // Column likely already exists
        }

        try {
            EventsProcessor.db.exec("ALTER TABLE fixtures ADD COLUMN llm_verdict TEXT");
        } catch (e) { }

        try {
            EventsProcessor.db.exec("ALTER TABLE fixtures ADD COLUMN has_verdict INTEGER DEFAULT 0");
        } catch (e) { }

        try {
            EventsProcessor.db.exec("ALTER TABLE fixtures ADD COLUMN adjustment_factor REAL DEFAULT 0");
        } catch (e) { }

        try {
            EventsProcessor.db.exec("ALTER TABLE fixtures ADD COLUMN turned_off INTEGER DEFAULT 0");
        } catch (e) { }

        try {
            EventsProcessor.db.exec("ALTER TABLE fixtures ADD COLUMN is_likely_draw INTEGER DEFAULT 0");
        } catch (e) { }

        // Fix existing "turned_off" defaults from previous migration if any
        try {
            EventsProcessor.db.exec("UPDATE fixtures SET turned_off = 0 WHERE turned_off = 1");
        } catch (e) { }

        try {
            EventsProcessor.db.exec(`
                CREATE TABLE IF NOT EXISTS ai_verdicts (
                    event_id TEXT NOT NULL,
                    extracted_data TEXT,
                    confidence REAL,
                    verdict TEXT,
                    PRIMARY KEY (event_id),
                    FOREIGN KEY (event_id) REFERENCES fixtures(event_id)
                );
            `);
        } catch (e) { }

        EventsProcessor.run();
        return true;
    }

    static stop = async () => {
        try {
            EventsProcessor.db.close();
        } catch (error) {

        }
        return true;
    }

    private static eventAlreadyExists = (eventId: string): Promise<boolean> => {
        return new Promise((resolve, reject) => {
            try {
                const stmt = EventsProcessor.db.prepare(`
                    SELECT 1 FROM fixtures WHERE event_id = ? LIMIT 1
                `);
                const row = stmt.get(eventId);
                resolve(!!row); // true if row exists, false otherwise
            } catch (err) {
                reject(err);
            }
        });
    };

    private static eventAlreadyLLMTested = (eventId: string): Promise<boolean> => {
        return new Promise((resolve, reject) => {
            try {
                const stmt = EventsProcessor.db.prepare(`
                    SELECT 1 FROM fixtures WHERE event_id = ? AND llm_attempted = 1 LIMIT 1
                `);
                const row = stmt.get(eventId);
                resolve(!!row); // true if row exists, false otherwise
            } catch (err) {
                reject(err);
            }
        });
    };

    static bulkImportFixtures = (fixtures: Fixture[]): number => {
        const insert = EventsProcessor.db.prepare(`
            INSERT INTO fixtures (
                event_id, game_id, league, home, away, start_time,
                home_win, draw, away_win,
                over05, over15, over25, over35,
                under05, under15, under25, under35,
                btts_yes, btts_no,
                dc1x, dcx2, dc12,
                home_goals, away_goals,
                draw_score,
                result_checked_count
            )
            VALUES (
                @eventId, @gameID, @league, @home, @away, @startTime,
                @homeWin, @draw, @awayWin,
                @over05, @over15, @over25, @over35,
                @under05, @under15, @under25, @under35,
                @bttsYes, @bttsNo,
                @dc1X, @dcX2, @dc12,
                @homeGoals, @awayGoals,
                @drawScore,
                @resultCheckedCount
            )
            ON CONFLICT(event_id) DO UPDATE SET
                home_win = EXCLUDED.home_win,
                draw = EXCLUDED.draw,
                away_win = EXCLUDED.away_win,
                over05 = EXCLUDED.over05,
                over15 = EXCLUDED.over15,
                over25 = EXCLUDED.over25,
                over35 = EXCLUDED.over35,
                under05 = EXCLUDED.under05,
                under15 = EXCLUDED.under15,
                under25 = EXCLUDED.under25,
                under35 = EXCLUDED.under35,
                btts_yes = EXCLUDED.btts_yes,
                btts_no = EXCLUDED.btts_no,
                dc1x = EXCLUDED.dc1x,
                dcx2 = EXCLUDED.dcx2,
                dc12 = EXCLUDED.dc12,
                draw_score = EXCLUDED.draw_score
        `);

        try {
            EventsProcessor.db.exec("BEGIN");

            // 1️⃣ Insert/Update fixtures efficiently
            for (const f of fixtures) {
                insert.run({
                    eventId: f.eventId,
                    gameID: f.gameID,
                    league: f.league,
                    home: f.home,
                    away: f.away,
                    startTime: f.startTime,

                    homeWin: f.odds.homeWin ?? null,
                    draw: f.odds.draw ?? null,
                    awayWin: f.odds.awayWin ?? null,

                    over05: f.odds.over05 ?? null,
                    over15: f.odds.over15 ?? null,
                    over25: f.odds.over25 ?? null,
                    over35: f.odds.over35 ?? null,

                    under05: f.odds.under05 ?? null,
                    under15: f.odds.under15 ?? null,
                    under25: f.odds.under25 ?? null,
                    under35: f.odds.under35 ?? null,

                    bttsYes: f.odds.bttsYes ?? null,
                    bttsNo: f.odds.bttsNo ?? null,

                    dc1X: f.odds.dc1X ?? null,
                    dcX2: f.odds.dcX2 ?? null,
                    dc12: f.odds.dc12 ?? null,

                    homeGoals: f.homeGoals ?? null,
                    awayGoals: f.awayGoals ?? null,

                    drawScore: f.drawScore ?? 0,
                    resultCheckedCount: f.resultCheckedCount ?? 0
                });
            }

            EventsProcessor.db.exec("COMMIT");
            EventsProcessor.triggerLoop();
            return fixtures.length;

        } catch (err) {
            EventsProcessor.db.exec("ROLLBACK");
            throw err;
        }
    };

    static getUpcomingFixtures = (): Fixture[] => {
        const rows = EventsProcessor.db.prepare(`
            SELECT * FROM fixtures
            WHERE start_time > ?
        `).all(Date.now());

        return rows.map(EventsProcessor.mapRowToFixture);
    };

    private static getUpcomingFixturesWithoutLLMAttempt = (): Fixture[] => {
        const rows = EventsProcessor.db.prepare(`
            SELECT * FROM fixtures
            WHERE start_time > ? AND llm_attempted = 0
        `).all(Date.now());

        return rows.map(EventsProcessor.mapRowToFixture);
    };

    static getPast24hFixtures = (): Fixture[] => {
        const now = Date.now();
        const past24h = now - ((Site.WAIT_HOURS * 60 * 60 * 1000) - EVENT_DURATION); // 24 hours in milliseconds

        try {
            const rows = EventsProcessor.db.prepare(`
                SELECT * FROM fixtures
                WHERE start_time BETWEEN ? AND ?
            `).all(past24h, now);

            return rows.map(EventsProcessor.mapRowToFixture);
        } catch (err) {
            Log.dev('getPast24hFixtures error:', err);
            return [];
        }
    };

    private static getFixturesByLeague = (league: string): Fixture[] => {
        try {
            const rows = EventsProcessor.db.prepare(`
                SELECT * FROM fixtures
                WHERE league = ?
                    AND home_goals IS NOT NULL
                    AND away_goals IS NOT NULL
            `).all(league);

            return rows.map(EventsProcessor.mapRowToFixture);
        } catch (err) {
            console.error('getFixturesByLeague error:', err);
            return [];
        }
    };

    private static getFixturesByTeam = (team: string): Fixture[] => {
        try {
            const rows = EventsProcessor.db.prepare(`
                SELECT * FROM fixtures
                WHERE (home = ? OR away = ?)
                    AND home_goals IS NOT NULL
                    AND away_goals IS NOT NULL
            `).all(team, team);

            return rows.map(EventsProcessor.mapRowToFixture);
        } catch (err) {
            console.error('getFixturesByTeam error:', err);
            return [];
        }
    };

    private static getHeadToHeadFixtures = (teamA: string, teamB: string): Fixture[] => {
        try {
            const rows = EventsProcessor.db.prepare(`
                SELECT * FROM fixtures
                WHERE (
                    (home = ? AND away = ?)
                    OR
                    (home = ? AND away = ?)
                )
                    AND home_goals IS NOT NULL
                    AND away_goals IS NOT NULL
            `).all(teamA, teamB, teamB, teamA);

            return rows.map(EventsProcessor.mapRowToFixture);
        } catch (err) {
            console.error('getHeadToHeadFixtures error:', err);
            return [];
        }
    };

    private static getFixturesNeedingResults = (
        gracePeriodMs: number,
        maxChecks: number
    ): Fixture[] => {
        const threshold = Date.now() - gracePeriodMs;

        const rows = EventsProcessor.db.prepare(`
            SELECT * FROM fixtures
            WHERE start_time < ?
                AND home_goals IS NULL
                AND result_checked_count < ?
        `).all(threshold, maxChecks);

        return rows.map(EventsProcessor.mapRowToFixture);
    };

    private static incrementResultCheck = (eventId: string): boolean => {
        const stmt = EventsProcessor.db.prepare(`
            UPDATE fixtures
            SET result_checked_count = result_checked_count + 1
            WHERE event_id = ?
        `);

        return stmt.run(eventId).changes > 0;
    };

    private static registerLLMAttempt = (eventId: string): boolean => {
        const stmt = EventsProcessor.db.prepare(`
            UPDATE fixtures
            SET llm_attempted = 1
            WHERE event_id = ?
        `);

        return stmt.run(eventId).changes > 0;
    };

    private static saveLLMVerdict = (eventId: string, verdict: string, newScore: number, confidence: number, extractedData: any): boolean => {
        try {
            const stmtFixture = EventsProcessor.db.prepare(`
                UPDATE fixtures
                SET llm_verdict = ?, draw_score = ?, has_verdict = 1, adjustment_factor = ?, is_likely_draw = ?
                WHERE event_id = ?
            `);
            
            const adjustmentFactor = newScore - (EventsProcessor.db.prepare("SELECT draw_score FROM fixtures WHERE event_id = ?").get(eventId) as any)?.draw_score || 0;

            stmtFixture.run(verdict, newScore, adjustmentFactor, extractedData.is_likely_draw ? 1 : 0, eventId);

            const stmtVerdict = EventsProcessor.db.prepare(`
                INSERT OR REPLACE INTO ai_verdicts (event_id, extracted_data, confidence, verdict)
                VALUES (?, ?, ?, ?)
            `);
            stmtVerdict.run(eventId, JSON.stringify(extractedData), confidence, verdict);

            return true;
        } catch (e) {
            Log.dev("saveLLMVerdict error:", e);
            throw e; // Rethrow to let the outer transaction handle it (triggering ROLLBACK in the loop)
        }
    };

    static toggleTurnOff = (eventId: string, turnedOff: boolean): boolean => {
        const stmt = EventsProcessor.db.prepare(`
            UPDATE fixtures
            SET turned_off = ?
            WHERE event_id = ?
        `);
        return stmt.run(turnedOff ? 1 : 0, eventId).changes > 0;
    };

    static getVerdict = (eventId: string): { extracted_data: any, confidence: number, verdict: string } | null => {
        try {
            const row = EventsProcessor.db.prepare("SELECT * FROM ai_verdicts WHERE event_id = ?").get(eventId) as any;
            if (row) {
                return {
                    extracted_data: JSON.parse(row.extracted_data),
                    confidence: row.confidence,
                    verdict: row.verdict
                };
            }
        } catch (e) {
            Log.dev("getVerdict error:", e);
        }
        return null;
    };

    private static mapRowToFixture = (row: any): Fixture => {
        return {
            eventId: row.event_id,
            gameID: row.game_id,
            league: row.league,
            home: row.home,
            away: row.away,
            startTime: Number(row.start_time),
            odds: {
                homeWin: row.home_win ?? undefined,
                draw: row.draw ?? undefined,
                awayWin: row.away_win ?? undefined,
                over05: row.over05 ?? undefined,
                over15: row.over15 ?? undefined,
                over25: row.over25 ?? undefined,
                over35: row.over35 ?? undefined,
                under05: row.under05 ?? undefined,
                under15: row.under15 ?? undefined,
                under25: row.under25 ?? undefined,
                under35: row.under35 ?? undefined,
                bttsYes: row.btts_yes ?? undefined,
                bttsNo: row.btts_no ?? undefined,
                dc1X: row.dc1x ?? undefined,
                dcX2: row.dcx2 ?? undefined,
                dc12: row.dc12 ?? undefined
            },
            homeGoals: row.home_goals ?? undefined,
            awayGoals: row.away_goals ?? undefined,
            drawScore: row.draw_score ?? 0,
            resultCheckedCount: row.result_checked_count ?? 0,
            llmAttempted: !!row.llm_attempted,
            llmVerdict: row.llm_verdict ?? null,
            hasVerdict: !!row.has_verdict,
            adjustmentFactor: row.adjustment_factor ?? 0,
            isTurnedOff: !!row.turned_off,
            isLikelyDraw: !!row.is_likely_draw,
        }
    }

    static getAllFixtures = (): Fixture[] => {
        const rows = EventsProcessor.db.prepare(`SELECT * FROM fixtures`).all();
        return rows.map(EventsProcessor.mapRowToFixture);
    };

    static getCompletedFixturesWithinHours = (
        hoursAgo: number,
    ): HistoricalFixture[] => {
        const fixtures = EventsProcessor.getAllFixtures();
        const now = Date.now();
        const cutoff = now - (hoursAgo * 60 * 60 * 1000);
        const adjustedCutoff = cutoff - EVENT_DURATION;

        return fixtures.filter(f =>
            (hoursAgo <= 0 ? true : (f.startTime >= adjustedCutoff)) &&
            typeof f.homeGoals === "number" &&
            typeof f.awayGoals === "number"
        ) as HistoricalFixture[];
    }

    private static updateMatchResult = (
        eventId: string,
        homeGoals: number,
        awayGoals: number,
        timeRange?: { from: number; to: number }
    ): boolean => {
        let stmt;

        if (timeRange) {
            stmt = EventsProcessor.db.prepare(`
                UPDATE fixtures
                SET home_goals = ?, away_goals = ?
                WHERE event_id = ?
                    AND start_time BETWEEN ? AND ?
            `);

            return stmt.run(
                homeGoals,
                awayGoals,
                eventId,
                timeRange.from,
                timeRange.to
            ).changes > 0;
        }

        stmt = EventsProcessor.db.prepare(`
            UPDATE fixtures
            SET home_goals = ?, away_goals = ?
            WHERE event_id = ?
        `);

        return stmt.run(homeGoals, awayGoals, eventId).changes > 0;
    };

    private static saveFixture = (fixture: Fixture): boolean => {
        const stmt = EventsProcessor.db.prepare(`
            INSERT INTO fixtures (
                event_id, game_id, league, home, away, start_time,
                home_win, draw, away_win,
                over05, over15, over25, over35,
                under05, under15, under25, under35,
                btts_yes, btts_no,
                dc1x, dcx2, dc12,
                draw_score,
                result_checked_count
            )
            VALUES (
                @eventId, @gameID, @league, @home, @away, @startTime,
                @homeWin, @draw, @awayWin,
                @over05, @over15, @over25, @over35,
                @under05, @under15, @under25, @under35,
                @bttsYes, @bttsNo,
                @dc1X, @dcX2, @dc12,
                @drawScore,
                @resultCheckedCount
            )
            ON CONFLICT(event_id) DO UPDATE SET
                home_win = EXCLUDED.home_win,
                draw = EXCLUDED.draw,
                away_win = EXCLUDED.away_win,
                over05 = EXCLUDED.over05,
                over15 = EXCLUDED.over15,
                over25 = EXCLUDED.over25,
                over35 = EXCLUDED.over35,
                under05 = EXCLUDED.under05,
                under15 = EXCLUDED.under15,
                under25 = EXCLUDED.under25,
                under35 = EXCLUDED.under35,
                btts_yes = EXCLUDED.btts_yes,
                btts_no = EXCLUDED.btts_no,
                dc1x = EXCLUDED.dc1x,
                dcx2 = EXCLUDED.dcx2,
                dc12 = EXCLUDED.dc12
        `);

        const params = {
            eventId: fixture.eventId,
            gameID: fixture.gameID,
            league: fixture.league,
            home: fixture.home,
            away: fixture.away,
            startTime: fixture.startTime,
            homeWin: fixture.odds.homeWin ?? null,
            draw: fixture.odds.draw ?? null,
            awayWin: fixture.odds.awayWin ?? null,
            over05: fixture.odds.over05 ?? null,
            over15: fixture.odds.over15 ?? null,
            over25: fixture.odds.over25 ?? null,
            over35: fixture.odds.over35 ?? null,
            under05: fixture.odds.under05 ?? null,
            under15: fixture.odds.under15 ?? null,
            under25: fixture.odds.under25 ?? null,
            under35: fixture.odds.under35 ?? null,
            bttsYes: fixture.odds.bttsYes ?? null,
            bttsNo: fixture.odds.bttsNo ?? null,
            dc1X: fixture.odds.dc1X ?? null,
            dcX2: fixture.odds.dcX2 ?? null,
            dc12: fixture.odds.dc12 ?? null,
            drawScore: fixture.drawScore ?? null,
            resultCheckedCount: fixture.resultCheckedCount ?? 0,
        };

        const result = stmt.run(params);

        return result.changes > 0;
    }

    private static processEventFeatures = (event: Event): Odds => {
        const odds: Odds = {};

        const toBeFilled = 16;
        let filled = 0

        for (const market of event.markets) {
            const name = (market.name || '').toLowerCase();
            const desc = (market.desc || '').toLowerCase();
            const spec = (market.specifier || '').toLowerCase();

            if (name == "1x2" || desc == "1x2") {
                const awayWin = market.outcomes.find(o => (o.desc || '').toLowerCase() == "away")?.odds;
                const drawWin = market.outcomes.find(o => (o.desc || '').toLowerCase() == "draw")?.odds;
                const homeWin = market.outcomes.find(o => (o.desc || '').toLowerCase() == "home")?.odds;
                if (awayWin) odds.awayWin = parseFloat(awayWin);
                if (homeWin) odds.homeWin = parseFloat(homeWin);
                if (drawWin) odds.draw = parseFloat(drawWin);
                filled += 3;
            }

            else if (name == "over/under" || desc == "over/under") {
                const over = market.outcomes.find(o => (o.desc || '').toLowerCase() == "over")?.odds;
                const under = market.outcomes.find(o => (o.desc || '').toLowerCase() == "under")?.odds;
                if (over && under) {
                    if (spec == "total=0.5") {
                        odds.over05 = parseFloat(over);
                        odds.under05 = parseFloat(under);
                    }

                    else if (spec == "total=1.5") {
                        odds.over15 = parseFloat(over);
                        odds.under15 = parseFloat(under);
                    }

                    else if (spec == "total=2.5") {
                        odds.over25 = parseFloat(over);
                        odds.under25 = parseFloat(under);
                    }

                    else if (spec == "total=3.5") {
                        odds.over35 = parseFloat(over);
                        odds.under35 = parseFloat(under);
                    }
                }
                filled += 2;
            }

            else if (name == "double chance" || desc == "double chance") {
                const homeDraw = market.outcomes.find(o => (o.desc || '').toLowerCase() == "home or draw")?.odds;
                const homeAway = market.outcomes.find(o => (o.desc || '').toLowerCase() == "home or away")?.odds;
                const awayDraw = market.outcomes.find(o => (o.desc || '').toLowerCase() == "draw or away")?.odds;

                if (homeAway) odds.dc12 = parseFloat(homeAway);
                if (homeDraw) odds.dc1X = parseFloat(homeDraw);
                if (awayDraw) odds.dcX2 = parseFloat(awayDraw);

                filled += 3;
            }

            if (filled >= toBeFilled) {
                break;
            }
        }

        return odds;
    }

    private static newEvents = async (events: Event[]) => {
        const qualityEvents = events.filter(event => {
            const isNotStart = (event.matchStatus || '').toLowerCase() === "not start";
            return event.status === 0 && isNotStart && !event.banned;
        });
        const reallyNewEvents = [];
        for (const event of qualityEvents) {
            // if (!(await EventsProcessor.eventAlreadyExists(event.eventId))) {
            reallyNewEvents.push(event);
            // }
        }
        const processedEvents: Fixture[] = reallyNewEvents.map(event => {
            return {
                away: event.awayTeamName,
                home: event.homeTeamName,
                eventId: event.eventId,
                gameID: event.gameId,
                league: event.sport.category.tournament.name,
                startTime: event.estimateStartTime,
                resultCheckedCount: 0,
                odds: EventsProcessor.processEventFeatures(event),
            } as Fixture;
        });
        return processedEvents;
    }

    static triggerLoop = () => {
        if (EventsProcessor.timeo) {
            clearTimeout(EventsProcessor.timeo);
            EventsProcessor.timeo = null;
        }
        EventsProcessor.run();
    }


    private static running: boolean = false;

    private static timeo: NodeJS.Timeout | null = null;

    private static run = async () => {
        if (EventsProcessor.running) return;
        EventsProcessor.running = true;
        const start = Date.now();
        const conclude = () => {
            Log.flow([SLUG, `Iteration`, `Concluded.`], WEIGHT);
            const duration = Date.now() - start;
            EventsProcessor.running = false;
            if (duration >= Site.SYS_INT) {
                EventsProcessor.run();
            }
            else {
                const rem = Site.SYS_INT - duration;
                if (EventsProcessor.timeo) {
                    clearTimeout(EventsProcessor.timeo);
                    EventsProcessor.timeo = null;
                }
                EventsProcessor.timeo = setTimeout(() => {
                    EventsProcessor.run();
                }, rem);
                Log.flow([SLUG, `Next iteration scheduled in ${getTimeElapsed(0, rem)}.`], WEIGHT);

            }
        }
        Log.flow([SLUG, `Iteration`, `Initialized.`], WEIGHT);
        try {
            // Fetching new events
            Log.flow([SLUG, `Iteration`, `Fetching new events.`], WEIGHT);
            const newEvents = await SportyHelpers.getUpcoming();
            if (newEvents) {

                Log.flow([SLUG, `Iteration`, `Fetched ${newEvents.length} upcoming event(s).`], WEIGHT);
                const processedEvents = await EventsProcessor.newEvents(newEvents);
                Log.flow([SLUG, `Iteration`, `Processed ${processedEvents.length} high-quality new event(s).`], WEIGHT);
                let saved: number = 0;
                EventsProcessor.db.exec("BEGIN");
                for (const event of processedEvents) {
                    const histLeague = EventsProcessor.getFixturesByLeague(event.league) as HistoricalFixture[];
                    const histHome = EventsProcessor.getFixturesByTeam(event.home) as HistoricalFixture[];
                    const histAway = EventsProcessor.getFixturesByTeam(event.away) as HistoricalFixture[];
                    const histH2H = EventsProcessor.getHeadToHeadFixtures(event.home, event.away) as HistoricalFixture[];
                    const leagueMetrics = computeLeagueMetrics(histLeague);
                    const homeMetrics = computeTeamMetricsAll(histHome, event.home);
                    const awayMetrics = computeTeamMetricsAll(histHome, event.away);
                    const h2hMetrics = computeH2H(histH2H, event.home, event.away);
                    const metricsAll = {
                        leagueMetrics,
                        awayMetrics,
                        h2hMetrics,
                        homeMetrics,
                        odds: event.odds,
                    };
                    const { drawScore, deterministicVerbose } = computeDrawScore(metricsAll);
                    event.drawScore = drawScore;
                    const s = EventsProcessor.saveFixture(event);
                    if (drawScore > Site.LLM_MIN_DRAW_SCORE && (!(await EventsProcessor.eventAlreadyLLMTested(event.eventId))) && Site.GROQ_USE) {
                        // this event is ripe for LLM verdict
                        const extracted = await SofascoreEngine.get({
                            away: event.away,
                            home: event.home,
                            league: event.league,
                            startTime: event.startTime,
                        });
                        // console.log(event.home, "vs", event.away, extracted ? JSON.stringify(extracted, null, 2): "STATS NOT RETURNED");

                        if (extracted) {
                            EventsProcessor.registerLLMAttempt(event.eventId);
                            const verdict = await PromptEngine.verdict(event.home, event.away, event.league, event.startTime, {
                                drawOdds: event.odds.draw || 0,
                                deterministicVerbose,
                                drawScore,
                                extracted,
                            });
                            Log.flow([SLUG, `Iteration`, `${event.home} vs ${event.away}`, `Verdict gotten.`], WEIGHT);
                            if (verdict) {
                                EventsProcessor.saveLLMVerdict(event.eventId, verdict.reason, verdict.final_score, verdict.confidence, extracted);
                            }
                        }
                    }
                    if (s) saved++;
                }
                EventsProcessor.db.exec("COMMIT");
                Log.flow([SLUG, `Iteration`, `Saved ${saved} event(s).`], WEIGHT);
            }
            else {
                Log.flow([SLUG, `Iteration`, `Failed to fetch new events.`], WEIGHT);
            }

            // getting results
            const ripeFixtures = EventsProcessor.getFixturesNeedingResults(EVENT_DURATION, MAX_RESULT_RETRIES);
            if (ripeFixtures.length > 0) {
                Log.flow([SLUG, `Iteration`, `Fetching results for ${ripeFixtures.length} event(s).`], WEIGHT);
                let n = 1;
                let saved = 0;
                for (const event of ripeFixtures) {
                    try {
                        const res = await SportyHelpers.getResult(event.gameID, event.startTime);
                        EventsProcessor.incrementResultCheck(event.eventId);
                        if (res) {
                            const resultEvent = res.find(re => re.gameId == event.gameID && re.eventId == event.eventId && (re.matchStatus || '').toLowerCase().includes('ended'));
                            if (resultEvent && resultEvent.setScore) {
                                let f = resultEvent.setScore.split(":").map(x => parseInt(x.trim()));
                                const homeScores = f[0];
                                const awayScores = f[1];
                                const savedEvent = EventsProcessor.updateMatchResult(event.eventId, homeScores, awayScores, {
                                    from: event.startTime - 300000,
                                    to: event.startTime + 300000,
                                })

                                if (!savedEvent) {
                                    Log.flow([SLUG, `Iteration`, `Result`, `${event.eventId}`, `Could not save event result.`], WEIGHT);
                                }
                                else {
                                    saved++;
                                }
                            }
                            else {
                                Log.flow([SLUG, `Iteration`, `Result`, `${event.eventId}`, `Result not found.`], WEIGHT);
                            }
                        }
                        else {
                            Log.flow([SLUG, `Iteration`, `Result`, `${event.eventId}`, `Result not found from API.`], WEIGHT);
                        }
                    } catch (error) {
                        Log.dev(error);
                    }

                    if (n < ripeFixtures.length) {
                        const rando = EventsProcessor.randInt(500, 2000);
                        Log.flow([SLUG, `Iteration`, `Result`, `Sleeping for ${rando}ms.`], WEIGHT);
                        await EventsProcessor.sleep(rando);
                    }
                    n++;
                }
                Log.flow([SLUG, `Iteration`, `Result`, `Saved ${saved}/${(n - 1)} results.`], WEIGHT);
            }
            else {
                Log.flow([SLUG, `Iteration`, `No events due for result checking... skipping results.`], WEIGHT);
            }
        } catch (error) {
            Log.dev(error);
        }
        conclude();
    }

    private static sleep = (m: number) => new Promise(r => setTimeout(r, m));

    private static randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

}
