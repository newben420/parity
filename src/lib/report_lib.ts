import { HistoricalFixture, Fixture, Odds } from "./../model/sporty";

export function generatePerformanceReport(fixtures: Fixture[]): string {
    try {
        if (!Array.isArray(fixtures)) {
            return "Invalid input: fixtures must be an array of Fixture."
        }

        if (fixtures.length === 0) {
            return "No fixtures available."
        }

        const completed = fixtures.filter(f =>
            typeof f.homeGoals === "number" &&
            typeof f.awayGoals === "number" &&
            typeof f.drawScore === "number"
        )

        if (completed.length === 0) {
            return "No completed fixtures available for analysis."
        }

        const totalFixtures = fixtures.length
        const totalCompleted = completed.length

        const isDraw = (f: Fixture) =>
            f.homeGoals === f.awayGoals

        const totalDraws = completed.filter(isDraw).length
        const overallDrawRate = totalDraws / totalCompleted

        const ranked = [...completed].sort((a, b) =>
            (b.drawScore ?? 0) - (a.drawScore ?? 0)
        )

        // =========================
        // EVALUATION ENGINE
        // =========================

        function evaluateSubset(subset: Fixture[]) {
            if (!subset || subset.length === 0) {
                return { count: 0, drawRate: 0, roi: 0 }
            }

            const count = subset.length
            const drawCount = subset.filter(isDraw).length
            const drawRate = drawCount / count

            let profit = 0

            for (const f of subset) {
                const drawOdd =
                    typeof f.odds?.draw === "number" &&
                        f.odds.draw > 1
                        ? f.odds.draw
                        : null

                if (isDraw(f) && drawOdd) {
                    profit += drawOdd - 1
                } else {
                    profit -= 1
                }
            }

            const roi = profit / count

            return { count, drawRate, roi }
        }

        function lift(rate: number) {
            if (overallDrawRate === 0) return 0
            return (rate - overallDrawRate) / overallDrawRate
        }

        // =========================
        // PERCENTILE ANALYSIS
        // =========================

        function percentileSubset(percent: number): Fixture[] {
            const size = Math.max(1, Math.floor(ranked.length * percent))
            return ranked.slice(0, size)
        }

        const top5 = evaluateSubset(percentileSubset(0.05))
        const top10 = evaluateSubset(percentileSubset(0.10))
        const top20 = evaluateSubset(percentileSubset(0.20))

        // =========================
        // DYNAMIC THRESHOLD (Q3)
        // =========================

        const threshold = computePercentile(
            ranked.map(f => clampScore(f.drawScore)),
            0.75
        )

        const thresholdSubset = ranked.filter(
            f => clampScore(f.drawScore) >= threshold
        )

        const dynamicThresholdResult = evaluateSubset(thresholdSubset)

        // =========================
        // DYNAMIC BUCKETS
        // =========================

        const dynamicBuckets = generateDynamicBuckets(
            ranked,
            overallDrawRate,
            evaluateSubset
        )

        // =========================
        // REPORT BUILD
        // =========================

        let report = ""
        report += "=========================================\n"
        report += "      DRAW ENGINE PERFORMANCE REPORT\n"
        report += "=========================================\n\n"

        report += `Total Fixtures: ${totalFixtures}\n`
        report += `Completed Fixtures: ${totalCompleted}\n`
        report += `Overall Draw Rate: ${(overallDrawRate * 100).toFixed(2)}%\n\n`

        report += "---- RANK PERFORMANCE ----\n"
        report += formatLine("Top 5%", top5, lift(top5.drawRate))
        report += formatLine("Top 10%", top10, lift(top10.drawRate))
        report += formatLine("Top 20%", top20, lift(top20.drawRate))
        report += formatLine(
            `Score ≥ ${(threshold * 100).toFixed(2)}% (Q3)`,
            dynamicThresholdResult,
            lift(dynamicThresholdResult.drawRate)
        )

        report += "\n---- SCORE BUCKET PERFORMANCE (Dynamic 5%) ----\n"

        for (const b of dynamicBuckets) {
            report += formatLine(
                b.label,
                { count: b.count, drawRate: b.drawRate, roi: b.roi },
                b.lift
            )
        }

        report += "\n---- NOTES ----\n"
        report += "Threshold is 75th percentile of drawScore distribution.\n"
        report += "Lift = improvement over baseline draw rate.\n"
        report += "ROI assumes flat 1 unit stake per match.\n"

        return report

    } catch (err: any) {
        return `Report generation failed: ${err?.message || "Unknown error"}`
    }
}

// =======================
// DYNAMIC BUCKET ENGINE
// =======================

function generateDynamicBuckets(
    ranked: Fixture[],
    overallDrawRate: number,
    evaluateSubset: (subset: Fixture[]) => {
        count: number
        drawRate: number
        roi: number
    }
) {
    const bucketSize = 0.05
    const bucketCount = Math.ceil(1 / bucketSize)

    const buckets = []

    for (let i = 0; i < bucketCount; i++) {
        const min = i * bucketSize
        const max =
            i === bucketCount - 1
                ? 1.0000001
                : (i + 1) * bucketSize

        const subset = ranked.filter(f => {
            const score = clampScore(f.drawScore)
            return score >= min && score < max
        })

        buckets.push({
            label: `${(min * 100).toFixed(0)}–${((min + bucketSize) * 100).toFixed(0)}%`,
            subset
        })
    }

    // Trim empty edges
    let start = 0
    let end = buckets.length - 1

    while (start <= end && buckets[start].subset.length === 0) start++
    while (end >= start && buckets[end].subset.length === 0) end--

    const trimmed = buckets.slice(start, end + 1)

    function lift(rate: number) {
        if (overallDrawRate === 0) return 0
        return (rate - overallDrawRate) / overallDrawRate
    }

    return trimmed.map(b => {
        const res = evaluateSubset(b.subset)
        return {
            label: b.label,
            count: res.count,
            drawRate: res.drawRate,
            roi: res.roi,
            lift: lift(res.drawRate)
        }
    })
}

// =======================
// HELPERS
// =======================

function clampScore(score?: number | null): number {
    if (typeof score !== "number" || isNaN(score)) return 0
    if (score < 0) return 0
    if (score > 1) return 1
    return score
}

function computePercentile(values: number[], percentile: number): number {
    if (!values.length) return 0

    const sorted = [...values].sort((a, b) => a - b)
    const index = percentile * (sorted.length - 1)

    const lower = Math.floor(index)
    const upper = Math.ceil(index)

    if (lower === upper) return sorted[lower]

    const weight = index - lower
    return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

function formatLine(
    label: string,
    data: { count: number; drawRate: number; roi: number },
    liftValue: number
): string {
    return `${label.padEnd(20)} | Matches: ${data.count
        .toString()
        .padEnd(4)} | Draw Rate: ${(data.drawRate * 100)
            .toFixed(2)
            .padEnd(6)}% | ROI: ${data.roi
                .toFixed(3)
                .padEnd(6)} | Lift: ${(liftValue * 100)
                    .toFixed(2)
                    .padEnd(6)}%\n`
}

