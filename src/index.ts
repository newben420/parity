import https from 'https';
import path from 'path';
import { Site } from './site';
if (Site.FORCE_FAMILY_4) {
    https.globalAgent.options.family = 4;
}
import express, { Request, Response, NextFunction } from 'express';
import { startEngine, stopEngine } from './engine/terminal';
import http from 'http';
import bodyParser from 'body-parser';
import { Log } from './lib/log';
// import { Server } from 'socket.io';
import { EventsProcessor } from './engine/events_processor';
import { Booker } from './engine/booker';
import { HistoricalFixture } from './model/sporty';
import { generatePerformanceReport } from './lib/report_lib';

const app = express();
const server = http.createServer(app);
// const io = new Server(server, {
//     cors: {
//         origin: "*"
//     }
// });

app.disable("x-powered-by");
app.disable('etag');
app.use(bodyParser.json({ limit: "35mb" }));

app.use(
    bodyParser.urlencoded({
        extended: true,
        limit: "35mb",
        parameterLimit: 50000,
    })
);

app.get("/", (req, res) => {
    // res.sendFile(path.join(__dirname, "views", "dashboard.html"));
    // Since we are compiling to dist, we need to make sure views are handled or just serve a string for now?
    // Better to serve a file.
    // Let's assume the user will run this locally.
    if (Site.ROOT.includes("/src") || Site.ROOT.includes("/dist")) {
        res.sendFile(path.join(Site.ROOT, "../views", "dashboard.html"));
    }
    else {
        res.sendFile(path.join(Site.ROOT, "views", "dashboard.html"));
    }
});

app.get("/data/upcoming", (req, res) => {
    res.json(EventsProcessor.getUpcomingFixtures());
});

app.get("/data/past24", (req, res) => {
    res.json(EventsProcessor.getPast24hFixtures());
});

app.get("/data/download", async (req, res) => {
    const downloadable = EventsProcessor.getAllFixtures();

    if (downloadable && downloadable.length) {
        const timestamp = Date.now();
        const filename = `draw_engine_${timestamp}.json`;

        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Type", "application/json");

        res.status(200).json(downloadable);
    } else {
        res.status(500).send("No data available yet.");
    }
});

app.get("/data/ftx", async (req, res) => {
    const limit = parseInt(req.query.limit as any) || 100;
    const minDrawIndex = parseFloat(req.query.minDrawIndex as any) || 0;
    const strict = (((req.query.strict as any) || '') as string).toLowerCase() == "true";
    res.send(await Booker.bookFTX({ limit, minDrawIndex, offset: 0, sortBy: 'drawIndex', strict }));
});

app.get("/data/book-oe", async (req, res) => {
    const G = parseInt(req.query.g as string) || 5;
    const T = parseInt(req.query.t as string) || 1;
    const N = parseInt(req.query.n as string) || undefined;
    res.send(await Booker.bookOE({ G, T, N }));
});

app.get("/data/report/:hours", (req, res) => {
    const hours = parseInt(req.params.hours) || 0;
    const fixtures = EventsProcessor.getCompletedFixturesWithinHours(hours);
    const downloadable = generatePerformanceReport(fixtures);
    if (downloadable && downloadable.length) {
        const timestamp = Date.now();
        const filename = `report_${hours || 'all'}_${timestamp}.txt`;

        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Type", "text/plain");

        res.status(200).send(downloadable);
    } else {
        res.status(500).send("No data available yet.");
    }
});

app.post("/data/import", (req, res) => {
    try {
        const data = req.body;
        if (data) {
            const p: HistoricalFixture[] = typeof data === "string" ? JSON.parse(data) : data;
            const r = EventsProcessor.bulkImportFixtures(p);
            res.send(`${r} historical fixture(s) imported`);
        }
        else {
            res.sendStatus(400);
        }

    } catch (error) {
        Log.dev(error);
        res.status(500).send((error as any).message || 'An exception occurred.');
    }
});

app.get("/data/reloop", async (req, res) => {
    EventsProcessor.triggerLoop();
    res.send(`Loop reset done. Please wait a few seconds/minutes for sync.`);
});

app.get("/data/verdict/:eventId", (req, res) => {
    const verdict = EventsProcessor.getVerdict(req.params.eventId);
    if (verdict) {
        res.json(verdict);
    } else {
        res.status(404).send("Verdict not found");
    }
});

app.post("/data/toggle-turn-off", (req, res) => {
    const { eventId, turnedOff } = req.body;
    const success = EventsProcessor.toggleTurnOff(eventId, turnedOff);
    if (success) {
        res.sendStatus(200);
    } else {
        res.status(500).send("Failed to toggle fixture status");
    }
});

app.use((req, res, next) => {
    res.sendStatus(404);
});

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    Log.dev(err);
    res.sendStatus(500);
});

process.on('exit', async (code) => {
    // NOTHING FOR NOW
});

process.on('SIGINT', async () => {
    Log.dev('Process > Received SIGINT.');
    const l = await stopEngine();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    Log.dev('Process > Received SIGTERM.');
    const l = await stopEngine();
    process.exit(0);
});

process.on('uncaughtException', async (err) => {
    Log.dev('Process > Unhandled exception caught.');
    console.log(err);
    if (Site.EXIT_ON_UNCAUGHT_EXCEPTION) {
        const l = await stopEngine();
        process.exit(0);
    }
});

process.on('unhandledRejection', async (err, promise) => {
    Log.dev('Process > Unhandled rejection caught.');
    console.log("Promise:", promise);
    console.log("Reason:", err);
    if (Site.EXIT_ON_UNHANDLED_REJECTION) {
        const l = await stopEngine();
        process.exit(0);
    }
});

Log.flow([Site.TITLE, 'Attempting to start engines.'], 0);
startEngine().then(r => {
    if (r) {
        server.listen(Site.PORT, async () => {
            Log.flow([Site.TITLE, 'Sucessfully started all engines.'], 0);
            Log.flow([Site.TITLE, `Running at http://127.0.0.1:${Site.PORT}`], 0);
        });
    }
    else {
        Log.flow([Site.TITLE, 'Failed to start all engines.'], 0);
        process.exit(0);
    }
});

// console.log((new Date(1772740800 * 1000)).toString())
// (async () => {
//     // console.log(await SportyHelpers.getUpcoming());
// })();