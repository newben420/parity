import { Odds } from './../model/sporty';
import { Site } from './../site';
import { Extracted, Verdict } from './../model/prompt';
import { GroqEngine } from "./groq";
import { impliedProbability } from './../lib/sportylib';

export class PromptEngine {
    private static verdictSystemPrompt = () => {
        return [
            `ACT AS: Lead Football Quant and Tactical Analyst.`,
            `GOAL: Execute a deep-dive analysis of a football fixture to identify high-probability DRAW scenarios.`,
            `CORE ANALYSIS PILLARS:`,
            `1. Parity Index: Cross-reference 'goalDifferencePerMatch' and 'chanceBalance'. Strong convergence in these indicates tactical stalemates.`,
            `2. Defensive Anchors: Evaluate 'avgRating' of featured defenders/goalkeepers vs. 'goalsAgainstPerMatch'. High ratings with low GAPM suggest a high 'clean sheet' or '1-goal limit' probability.`,
            `3. Scoring Efficiency: Contrast 'bigChances' created vs. 'goalsScored'. If chances are high but goals are low, it suggests poor finishing efficiency—a key driver for low-scoring draws.`,
            `4. Reversion to Mean: Analyze seasonal 'drawRate' against recent 'form' (W/D/L). Identify if a team is statistically "due" for a draw based on variance.`,
            `5. Tactical Matchup: Evaluate Manager H2H history. Some managerial styles neutralize each other, leading to conservative play.`,
            `6. Market Efficiency: Compare Implied Draw Probability (from odds) against your analytical verdict. Note if the market is under-pricing a high-probability stalemate.`,
            `JSON OUTPUT ONLY: {"isLikelyDraw": boolean, "reason": "string"}`,
            `isLikelyDraw: Set to true ONLY if multiple signals across statistics, form, and market convergence confirm a high-confidence draw.`,
            `REASONING RULES:`,
            `- MUST follow a 'Logic-First' approach.`,
            `- Start with the most compelling statistical alignment found across the pillars.`,
            `- Use professional terminology: (e.g., 'Positive Goal Difference Parity', 'Low-Volatility Scoring Profile', 'Market Undervaluation').`,
            `- DO NOT use shorthand or arrows. Explain the "Why" clearly for a human analyst.`,
        ].join("\n");
    }

    private static verdictPrompt = (
        home: string,
        away: string,
        league: string,
        startTime: number,
        odds: Odds,
        extracted: Extracted
    ) => {
        const system = PromptEngine.verdictSystemPrompt();
        const bookieProb = impliedProbability(odds.draw);

        const user = [
            `### FIXTURE DATA ###`,
            `Teams: ${home} vs ${away}`,
            `League: ${league}`,
            `Kick-off: ${new Date(startTime).toISOString()}`,
            ``,
            `### MARKET SIGNALS ###`,
            `Odds: Home(${odds.homeWin}), Draw(${odds.draw}), Away(${odds.awayWin})`,
            `Market Implied Draw Probability: ${bookieProb.toFixed(4)}`,
            ``,
            `### EXTRACTED STATISTICS ###`,
            `${JSON.stringify(extracted, null, 2)}`,
            ``,
            `Analyze the above data points against your CORE ANALYSIS PILLARS and determine if a draw is the most probable tactical outcome.`,
        ].join("\n");

        return { system, user };
    }

    static verdict = async (
        home: string,
        away: string,
        league: string,
        startTime: number,
        opts: {
            odds: Odds,
            extracted: Extracted,
        }
    ): Promise<Verdict | null> => {
        const { system, user } = PromptEngine.verdictPrompt(home, away, league, startTime, opts.odds, opts.extracted);
        const res = await GroqEngine.direct({
            messages: [
                {
                    role: 'system',
                    content: system,
                },
                {
                    role: 'user',
                    content: user,
                }
            ],
            preferredModels: [
                "moonshotai/kimi-k2-instruct-0905",
                "openai/gpt-oss-120b",
                "openai/gpt-oss-20b",
            ]
        });
        if (res.succ) {
            let verdict: Verdict = GroqEngine.extractJSONResponse(res.message);
            return verdict;
        }
        return null;
    }
}