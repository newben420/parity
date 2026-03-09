export interface Extracted {
    league_context?: {
        league_name?: string;
        season?: string;
        season_draw_rate?: number;
    };
    home_team_stats?: {
        pregame?: {
            avgRating?: string;
            position?: number;
            form?: ("W" | "D" | "L")[];
        };
        season?: {
            drawRate?: number;
            winRate?: number;
            loseRate?: number;
            points?: number;
            position?: number;
            goalsScored?: number;
            goalsConceded?: number;
            matches?: number;
            bigChances?: number;
            bigChancesAgainst?: number;
            goalsAgainstPerMatch?: number;
            goalDifferencePerMatch?: number;
            chanceBalance?: number;
        };
        fixture?: {
            featuredPlayers?: {
                name?: string;
                rating?: number;
                position?: string;
            }[];
        };
    };
    away_team_stats?: {
        pregame?: {
            avgRating?: string;
            position?: number;
            form?: ("W" | "D" | "L")[];
        };
        season?: {
            drawRate?: number;
            winRate?: number;
            loseRate?: number;
            points?: number;
            position?: number;
            goalsScored?: number;
            goalsConceded?: number;
            matches?: number;
            bigChances?: number;
            bigChancesAgainst?: number;
            goalsAgainstPerMatch?: number;
            goalDifferencePerMatch?: number;
            chanceBalance?: number;
        };
        fixture?: {
            featuredPlayers?: {
                name?: string;
                rating?: number;
                position?: string;
            }[];
        };
    };
    head_to_head?: {
        totalMeetings?: number;
        homeWins?: number;
        awayWins?: number;
        draws?: number;
    };
    managers?: {
        home?: string;
        away?: string;
        h2h?: {
            homeWins?: number;
            awayWins?: number;
            draws?: number;
        };
    };
}
export interface Verdict {
    final_score: number,
    adjustment_factor: number,
    confidence: number,
    reason: string
}