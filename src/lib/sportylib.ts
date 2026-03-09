import { HistoricalFixture, Odds } from "./../model/sporty";

export const toNum = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

export const isValidOdd = (o: any) => typeof o === "number" && Number.isFinite(o) && o > 1.0001;

export const impliedRaw = (odd: number) => 1 / odd;

export const normalizeMarketOdds = (oddsMap: Record<any, any>) => {
    const raw: Record<string, number> = {};
    let sum = 0;

    for (const [k, v] of Object.entries(oddsMap)) {
        const o = toNum(v);
        if (!isValidOdd(o)) continue;
        if (typeof k !== "string") continue;
        const p = impliedRaw(o as number);
        raw[k] = p;
        sum += p;
    }

    if (sum <= 0) return { probs: null, vig: null, sumRaw: null };

    const probs: Record<string, number> = {};
    for (const [k, p] of Object.entries(raw)) probs[k] = p / sum;

    return { probs, sumRaw: sum, vig: sum - 1 }
}

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export const clamp = (n: number, min = 0, max = 1): number =>
    Math.min(Math.max(n, min), max);

export const safe = (n: unknown, fallback = 0): number =>
    typeof n === "number" && Number.isFinite(n) ? n : fallback;

export function safeDivide(a: number, b: number): number {
    if (!b || b === 0) return 0
    return a / b
}

export function impliedProbability(odd?: number): number {
    if (!odd || odd <= 1) return 0
    return 1 / odd
}

export function shrink(observedRate: number, sampleSize: number, prior: number, strength: number) {
    return (observedRate * sampleSize + prior * strength) / (sampleSize + strength)
}


// ---------------- LEAGUE METRICS ----------------
export function computeLeagueMetrics(fixtures: HistoricalFixture[]) {

    const total = fixtures.length

    if (total === 0) {
        return {
            drawRate: 0,
            under25Rate: 0,
            avgGoals: 0,
            goalClosenessRate: 0,
            confidence: 0,
            txt: `fixtures:0`
        }
    }

    const decayFactor = 0.997
    let weightSum = 0
    let weightedDraws = 0
    let weightedUnder25 = 0
    let weightedGoals = 0
    let weightedClose = 0

    for (let i = 0; i < fixtures.length; i++) {

        const f = fixtures[i]
        const hg = safe(f.homeGoals)
        const ag = safe(f.awayGoals)
        const goals = hg + ag
        const goalDiff = Math.abs(hg - ag)

        const weight = Math.pow(decayFactor, fixtures.length - 1 - i)

        weightSum += weight

        if (hg === ag) weightedDraws += weight
        if (goals <= 2) weightedUnder25 += weight
        if (goalDiff <= 1) weightedClose += weight

        weightedGoals += goals * weight
    }

    return {
        drawRate: weightedDraws / weightSum,
        under25Rate: weightedUnder25 / weightSum,
        avgGoals: weightedGoals / weightSum,
        goalClosenessRate: weightedClose / weightSum,
        confidence: Math.min(total / 50, 1),
        txt: `fixtures:${total}`
    }
}


// ---------------- TEAM METRICS ----------------
export function computeTeamMetrics(
    fixtures: HistoricalFixture[],
    team: string,
    isHome: boolean
) {

    const teamMatches = fixtures.filter(f =>
        isHome ? f.home === team : f.away === team
    )

    const total = teamMatches.length

    if (total === 0) {
        return {
            drawRate: 0,
            under25Rate: 0,
            avgGoals: 0,
            confidence: 0
        }
    }

    let draws = 0
    let under25 = 0
    let totalGoals = 0

    for (const f of teamMatches) {

        const goals = f.homeGoals + f.awayGoals

        totalGoals += goals

        if (f.homeGoals === f.awayGoals) draws++
        if (goals <= 2) under25++
    }

    return {
        drawRate: draws / total,
        under25Rate: under25 / total,
        avgGoals: totalGoals / total,
        confidence: Math.min(total / 20, 1)
    }
}


// ---------------- H2H METRICS ----------------
export function computeH2H(
    fixtures: HistoricalFixture[],
    home: string,
    away: string
) {

    const h2h = fixtures.filter(
        f =>
            (f.home === home && f.away === away) ||
            (f.home === away && f.away === home)
    )

    const total = h2h.length

    if (total === 0) {
        return { drawRate: 0, avgGoalDiff: 999, confidence: 0 }
    }

    const draws = h2h.filter(f => f.homeGoals === f.awayGoals).length

    const avgGoalDiff = h2h.reduce(
        (s, f) => s + Math.abs(f.homeGoals - f.awayGoals),
        0
    ) / total

    return {
        drawRate: shrink(draws / total, total, 0.26, 3),
        avgGoalDiff,
        confidence: Math.min(total / 10, 1)
    }
}


// ---------------- MARKET FACTOR ----------------
export function computeMarketFactor(odds: Odds) {

    const drawProb = impliedProbability(odds.draw)

    const homeProb = impliedProbability(odds.homeWin)

    const awayProb = impliedProbability(odds.awayWin)

    const competitiveness = Math.min(homeProb, awayProb) / Math.max(homeProb, awayProb)

    return {
        drawProb,
        competitiveness,
        confidence: (drawProb > 0 || competitiveness > 0) ? 1 : 0,

        txt: `odds H:${odds.homeWin} D:${odds.draw} A:${odds.awayWin}
prob H:${homeProb.toFixed(4)} D:${drawProb.toFixed(4)} A:${awayProb.toFixed(4)}
competitiveness:${competitiveness.toFixed(3)}`
    }
}


// ---------------- FINAL DRAW SCORE ----------------
export function computeDrawScore(params: {

    leagueMetrics: ReturnType<typeof computeLeagueMetrics>

    homeMetrics: ReturnType<typeof computeTeamMetrics>

    awayMetrics: ReturnType<typeof computeTeamMetrics>

    h2hMetrics: ReturnType<typeof computeH2H>

    odds: Odds

}) {

    const { leagueMetrics, homeMetrics, awayMetrics, h2hMetrics, odds } = params

    const lines: string[] = []


    // MARKET
    const market = computeMarketFactor(odds)

    const marketScore = market.drawProb * 0.7 + market.competitiveness * 0.3

    const marketWeighted = marketScore * 0.75


    // TEAM
    const hN = homeMetrics.confidence * 20

    const aN = awayMetrics.confidence * 20

    const hDraw = shrink(homeMetrics.drawRate, hN, 0.26, 15)

    const aDraw = shrink(awayMetrics.drawRate, aN, 0.26, 15)

    const hU25 = shrink(homeMetrics.under25Rate, hN, 0.45, 15)

    const aU25 = shrink(awayMetrics.under25Rate, aN, 0.45, 15)

    const hScore = hDraw * 0.7 + hU25 * 0.3

    const aScore = aDraw * 0.7 + aU25 * 0.3

    const hConf = Math.pow(Math.max(homeMetrics.confidence, 0.05), 2)

    const aConf = Math.pow(Math.max(awayMetrics.confidence, 0.05), 2)

    const teamBase = (hScore * hConf + aScore * aConf) / (hConf + aConf)

    const teamWeighted = teamBase * 0.08


    // LEAGUE
    const leagueScore = (leagueMetrics.drawRate * 0.7 + leagueMetrics.under25Rate * 0.3) * leagueMetrics.confidence

    const leagueWeighted = leagueScore * 0.12


    // H2H
    const h2hScore = h2hMetrics.confidence > 0 ? h2hMetrics.drawRate * h2hMetrics.confidence + 0.26 * (1 - h2hMetrics.confidence) : 0.26

    const h2hWeighted = h2hScore * 0.05


    // FINAL
    const rawScore = marketWeighted + leagueWeighted + teamWeighted + h2hWeighted

    const clampedScore = clamp(rawScore, 0, 1)


    lines.push(`MARKET`, market.txt, `score:${marketScore.toFixed(4)} weight:${marketWeighted.toFixed(4)}`)

    lines.push(`LEAGUE fixtures:${leagueMetrics.txt.split(':')[1]} draw:${leagueMetrics.drawRate.toFixed(3)} u25:${leagueMetrics.under25Rate.toFixed(3)} conf:${leagueMetrics.confidence.toFixed(2)} weight:${leagueWeighted.toFixed(4)}`)

    lines.push(`HOME draw:${homeMetrics.drawRate.toFixed(3)} u25:${homeMetrics.under25Rate.toFixed(3)} conf:${homeMetrics.confidence.toFixed(2)}`)

    lines.push(`AWAY draw:${awayMetrics.drawRate.toFixed(3)} u25:${awayMetrics.under25Rate.toFixed(3)} conf:${awayMetrics.confidence.toFixed(2)}`)

    lines.push(`TEAM base:${teamBase.toFixed(3)} weight:${teamWeighted.toFixed(4)}`)

    lines.push(`H2H draw:${h2hMetrics.drawRate.toFixed(3)} conf:${h2hMetrics.confidence.toFixed(2)} diff:${h2hMetrics.avgGoalDiff.toFixed(2)} weight:${h2hWeighted.toFixed(4)}`)

    lines.push(`RAW:${rawScore.toFixed(4)} FINAL:${clampedScore.toFixed(4)}`)


    lines.push(JSON.stringify({

        leagueFixtures: leagueMetrics.txt.includes('fixtures') ? parseInt(leagueMetrics.txt.split(':')[1]) : 0,

        homeSample: Math.round(homeMetrics.confidence * 20),

        awaySample: Math.round(awayMetrics.confidence * 20),

        h2hSample: Math.round(h2hMetrics.confidence * 10),

        marketOverround: odds ? (odds.homeWin && odds.draw && odds.awayWin ? impliedRaw(odds.homeWin) + impliedRaw(odds.draw) + impliedRaw(odds.awayWin) - 1 : 0) : 0

    }))


    return {

        drawScore: clampedScore,

        deterministicVerbose: lines.join("\n")

    }
}


// ---------------- TEAM ALL METRICS ----------------
export function computeTeamMetricsAll(fixtures: HistoricalFixture[], team: string) {

    const teamMatches = fixtures.filter(f => f.home === team || f.away === team)

    const total = teamMatches.length

    if (total === 0) return {

        drawRate: 0, under25Rate: 0, avgGoals: 0,

        goalClosenessRate: 0, avgGoalDiff: 0, confidence: 0

    }

    const decayFactor = 0.98

    let weightSum = 0

    let weightedDraws = 0

    let weightedUnder25 = 0

    let weightedGoals = 0

    let weightedClose = 0

    let weightedGoalDiff = 0


    for (let i = 0; i < teamMatches.length; i++) {

        const f = teamMatches[i]

        const hg = safe(f.homeGoals)

        const ag = safe(f.awayGoals)

        const goals = hg + ag

        const goalDiff = Math.abs(hg - ag)

        const weight = Math.pow(decayFactor, teamMatches.length - 1 - i)

        weightSum += weight

        if (hg === ag) weightedDraws += weight

        if (goals <= 2) weightedUnder25 += weight

        if (goalDiff <= 1) weightedClose += weight

        weightedGoals += goals * weight

        weightedGoalDiff += goalDiff * weight
    }

    return {

        drawRate: weightedDraws / weightSum,

        under25Rate: weightedUnder25 / weightSum,

        avgGoals: weightedGoals / weightSum,

        goalClosenessRate: weightedClose / weightSum,

        avgGoalDiff: weightedGoalDiff / weightSum,

        confidence: Math.min(total / 20, 1)

    }
}