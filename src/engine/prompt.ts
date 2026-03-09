import { Site } from './../site';
import { Extracted, Verdict } from './../model/prompt';
import { GroqEngine } from "./groq";
import { impliedProbability } from './../lib/sportylib';

export class PromptEngine {
    private static verdictSystemPrompt = () => {
        return [
            `ACT AS: Senior Football Quant.`,
            `GOAL: Adjust draw_score [0..1] using external signals.`,
            `PRIORITY:`,
            `- Prioritize EXTERNAL_DATA (Sofascore stats, H2H, season totals) as the primary source of truth.`,
            `- De-emphasize the internal BASE_SCORE (deterministic draw score). It is derived from internal markers that can be short-lived or incomplete.`,
            `- Use external signals to override or validate the internal model if there's a discrepancy.`,
            `LOGIC:`,
            `1. Defensive Parity: Low-scoring H2H + matching low season goals = UP (max +${Site.LLM_ADJ_FACTOR}).`,
            `2. Volatility: High Goals/Match or volatile results = DOWN (max -${Site.LLM_ADJ_FACTOR}).`,
            `3. Market Clash: If Bookmaker Prob >> Model Draw & external data supports high draw = UP.`,
            `4. Model Confirmation: If external data aligns with model = 0 adjustment.`,
            `EXTREME OVERRIDES:`,
            `- If certainty of NO DRAW (>90%): adjustment_factor = -1.0 (forces 0).`,
            `- If certainty of DRAW (>90%): adjustment_factor = 2.0 (forces 1).`,
            `JSON OUTPUT ONLY: {"final_score": number, "is_likely_draw": boolean, "adjustment_factor": number, "confidence": number, "reason": "string"}`,
            `LIKELY DRAW: Set "is_likely_draw" to true ONLY if you are highly confident the match will end in a draw based on all provided signals.`,
            `REASONING RULES:`,
            `- Use clear, professional, natural English.`,
            `- DO NOT use cryptic shorthand, arrows (→), or math notation in the "reason" field.`,
            `- Explain the "Why" behind your adjustment so a human can understand the logic.`,
            `final_score calculation: deterministic_score * (1 + adjustment_factor). Clip result [0,1].`,
        ].join("\n");
    }

    private static verdictPrompt = (
        home: string,
        away: string,
        league: string,
        startTime: number,
        opts: {
            drawScore: number,
            drawOdds: number,
            deterministicVerbose: string,
            extracted: Extracted,
        }
    ) => {
        const system = PromptEngine.verdictSystemPrompt();
        const bookieProb = impliedProbability(opts.drawOdds);

        const user = [
            `FIXTURE: ${home} v ${away} | ${league} | ${new Date(startTime).toISOString()}`,
            `BASE_SCORE: ${opts.drawScore.toFixed(4)} | BOOKIE_PROB: ${bookieProb.toFixed(4)}`,
            `INTERNAL_MODEL: ${opts.deterministicVerbose}`,
            `EXTERNAL_DATA: ${JSON.stringify(opts.extracted)}`,
            `Adjust base score based on signals. Return JSON.`,
        ].join("\n");

        return { system, user };
    }

    static verdict = async (
        home: string,
        away: string,
        league: string,
        startTime: number,
        opts: {
            drawScore: number,
            drawOdds: number,
            deterministicVerbose: string,
            extracted: Extracted,
        }
    ): Promise<Verdict | null> => {
        const { system, user } = PromptEngine.verdictPrompt(home, away, league, startTime, opts);
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