import { Extracted } from './../model/prompt';
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

type FormResult = "W" | "D" | "L";

export interface EngineWeights {

    groupWeights: {
        primary: number;
        secondary: number;
        tertiary: number;
    };

    primary: {
        leagueDrawRate: number;
        homeDrawRate: number;
        awayDrawRate: number;
        homeForm: number;
        awayForm: number;
    };

    secondary: {
        goalDifferenceBalance: number;
        bigChanceBalance: number;
    };

    tertiary: {
        h2hDrawRate: number;
        managerDrawRate: number;
    };

    penalties: {
        missingData: number;
        formImbalance: number;
        strengthImbalance: number;
    };

    interactionBoost: number;
}

export const DEFAULT_WEIGHTS: EngineWeights = {

    groupWeights: {
        primary: 0.6,
        secondary: 0.25,
        tertiary: 0.15
    },

    primary: {
        leagueDrawRate: 0.15,
        homeDrawRate: 0.2,
        awayDrawRate: 0.2,
        homeForm: 0.225,
        awayForm: 0.225
    },

    secondary: {
        goalDifferenceBalance: 0.6,
        bigChanceBalance: 0.4
    },

    tertiary: {
        h2hDrawRate: 0.65,
        managerDrawRate: 0.35
    },

    penalties: {
        missingData: 0.5,
        formImbalance: 0.35,
        strengthImbalance: 0.4
    },

    interactionBoost: 0.05
};

// ===============================
// Helpers
// ===============================

const clamp = (v: number) => Math.min(1, Math.max(0, v));

const safe = (v?: number | null, fallback = 0) =>
    v !== undefined && v !== null ? v : fallback;

function drawRatio(form?: FormResult[]) {

    if (!form || form.length === 0) return null;

    const draws = form.filter(x => x === "D").length;

    return draws / form.length;
}

function formStrength(form?: FormResult[]) {

    if (!form || form.length === 0) return null;

    let points = 0;

    for (const f of form) {
        if (f === "W") points += 3;
        if (f === "D") points += 1;
    }

    return points / (form.length * 3);
}

// ===============================
// Core Engine
// ===============================

export function parityDrawScore(
    fixture: Extracted,
    weights: EngineWeights = DEFAULT_WEIGHTS
) {

    const contributions: Record<string, number> = {};

    const penaltyMissing = weights.penalties.missingData;

    // ===============================
    // PRIMARY FEATURES
    // ===============================

    let primarySum = 0;
    let primaryWeight = 0;

    const leagueDraw = safe(
        fixture.league_context?.season_draw_rate,
        0.25
    );

    contributions.leagueDrawRate =
        leagueDraw * weights.primary.leagueDrawRate;

    primarySum += contributions.leagueDrawRate;
    primaryWeight += weights.primary.leagueDrawRate;

    const homeDraw =
        fixture.home_team_stats?.season?.drawRate ??
        leagueDraw * penaltyMissing;

    const awayDraw =
        fixture.away_team_stats?.season?.drawRate ??
        leagueDraw * penaltyMissing;

    contributions.homeDrawRate =
        homeDraw * weights.primary.homeDrawRate;

    contributions.awayDrawRate =
        awayDraw * weights.primary.awayDrawRate;

    primarySum += contributions.homeDrawRate;
    primarySum += contributions.awayDrawRate;

    primaryWeight += weights.primary.homeDrawRate;
    primaryWeight += weights.primary.awayDrawRate;

    const homeFormDraw = drawRatio(
        fixture.home_team_stats?.pregame?.form
    );

    const awayFormDraw = drawRatio(
        fixture.away_team_stats?.pregame?.form
    );

    const homeFormScore =
        homeFormDraw ?? penaltyMissing;

    const awayFormScore =
        awayFormDraw ?? penaltyMissing;

    contributions.homeForm =
        homeFormScore * weights.primary.homeForm;

    contributions.awayForm =
        awayFormScore * weights.primary.awayForm;

    primarySum += contributions.homeForm;
    primarySum += contributions.awayForm;

    primaryWeight += weights.primary.homeForm;
    primaryWeight += weights.primary.awayForm;

    const primaryScore =
        primaryWeight > 0 ? primarySum / primaryWeight : 0;

    // ===============================
    // SECONDARY FEATURES
    // ===============================

    let secondarySum = 0;
    let secondaryWeight = 0;

    const homeGD = safe(
        fixture.home_team_stats?.season?.goalDifferencePerMatch
    );

    const awayGD = safe(
        fixture.away_team_stats?.season?.goalDifferencePerMatch
    );

    const gdDiff = Math.abs(homeGD - awayGD);

    const gdBalance = clamp(1 - gdDiff / 3);

    contributions.goalDifferenceBalance =
        gdBalance * weights.secondary.goalDifferenceBalance;

    secondarySum += contributions.goalDifferenceBalance;
    secondaryWeight += weights.secondary.goalDifferenceBalance;

    const homeBig = safe(
        fixture.home_team_stats?.season?.bigChances
    );

    const awayBig = safe(
        fixture.away_team_stats?.season?.bigChances
    );

    const homeAgainst = safe(
        fixture.home_team_stats?.season?.bigChancesAgainst
    );

    const awayAgainst = safe(
        fixture.away_team_stats?.season?.bigChancesAgainst
    );

    const chanceDelta =
        Math.abs(homeBig - awayBig) +
        Math.abs(homeAgainst - awayAgainst);

    const chanceTotal =
        homeBig + awayBig + homeAgainst + awayAgainst + 1;

    const chanceBalance =
        clamp(1 - chanceDelta / chanceTotal);

    contributions.bigChanceBalance =
        chanceBalance * weights.secondary.bigChanceBalance;

    secondarySum += contributions.bigChanceBalance;
    secondaryWeight += weights.secondary.bigChanceBalance;

    const secondaryScore =
        secondaryWeight > 0 ? secondarySum / secondaryWeight : 0;

    // ===============================
    // TERTIARY FEATURES
    // ===============================

    let tertiarySum = 0;
    let tertiaryWeight = 0;

    let h2hScore = penaltyMissing;

    if (
        fixture.head_to_head?.draws !== undefined &&
        fixture.head_to_head?.totalMeetings
    ) {
        h2hScore =
            fixture.head_to_head.draws /
            fixture.head_to_head.totalMeetings;
    }

    contributions.h2hDrawRate =
        h2hScore * weights.tertiary.h2hDrawRate;

    tertiarySum += contributions.h2hDrawRate;
    tertiaryWeight += weights.tertiary.h2hDrawRate;

    let mgrScore = penaltyMissing;

    const mgr = fixture.managers?.h2h;

    if (
        mgr &&
        mgr.draws !== undefined &&
        mgr.homeWins !== undefined &&
        mgr.awayWins !== undefined
    ) {
        const total =
            mgr.homeWins + mgr.awayWins + mgr.draws;

        if (total > 0) mgrScore = mgr.draws / total;
    }

    contributions.managerDrawRate =
        mgrScore * weights.tertiary.managerDrawRate;

    tertiarySum += contributions.managerDrawRate;
    tertiaryWeight += weights.tertiary.managerDrawRate;

    const tertiaryScore =
        tertiaryWeight > 0 ? tertiarySum / tertiaryWeight : 0;

    // ===============================
    // PENALTIES
    // ===============================

    let penalty = 0;

    const homeStrength =
        formStrength(fixture.home_team_stats?.pregame?.form);

    const awayStrength =
        formStrength(fixture.away_team_stats?.pregame?.form);

    if (
        homeStrength !== null &&
        awayStrength !== null
    ) {
        const diff = Math.abs(homeStrength - awayStrength);

        penalty += diff * weights.penalties.formImbalance;
    }

    penalty += gdDiff * weights.penalties.strengthImbalance * 0.1;

    penalty = clamp(penalty);

    // ===============================
    // INTERACTION BOOST
    // ===============================

    let boost = 0;

    if (
        primaryScore > 0.5 &&
        secondaryScore > 0.5
    ) {
        boost += weights.interactionBoost;
    }

    // ===============================
    // FINAL SCORE
    // ===============================

    let score =
        primaryScore * weights.groupWeights.primary +
        secondaryScore * weights.groupWeights.secondary +
        tertiaryScore * weights.groupWeights.tertiary;

    score = score - penalty + boost;

    score = clamp(score);

    return {
        score,
        contributions,
        penalty,
        boost
    };
}