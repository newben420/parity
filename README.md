# Parity ⚽️

Parity is a sophisticated sports prediction and analysis engine designed to identify potential draws in football matches. It combines real-time data scraping, statistical analysis, and AI-driven verdicts to provide accurate insights for betting and analysis.

## ✨ Features

-   **Real-time Data Fetching**: Scrapes live and upcoming match data from SofaScore.
-   **AI-Powered Verdicts**: Integrates with Groq LLM to generate deep-dive analysis and confidence scores for match outcomes.
-   **Deterministic Logic**: Uses a core engine to process events, manage state, and compute scores based on historical data.
-   **Dynamic Dashboard**: A web-based interface for monitoring upcoming fixtures, viewing AI verdicts, and tracking past performance.
-   **Automated Reporting**: Generates performance reports to evaluate the accuracy of previous predictions.
-   **Multi-Market Support**: Focuses on Full-Time (FTX) and Half-Time/Full-Time (HTFT) draw markets.

## 🏗 Architecture

The project is built with Node.js and TypeScript, following a modular architecture:

-   `src/index.ts`: The entry point, setting up the Express server and initializing the background engines.
-   `src/engine/`: The core logic, including:
    -   `events_processor.ts`: Manages the lifecycle of match data.
    -   `sofascore.ts`: Handles data scraping and normalization.
    -   `booker.ts`: Implements betting logic and filtration.
    -   `groq.ts`: Interfaces with the Groq LLM for AI analysis.
-   `src/lib/`: Reusable utilities for logging, date/time manipulation, and statistical calculations.
-   `src/model/`: Type definitions and interfaces for the system's data structures.
-   `views/`: Frontend dashboard components.

## 🚀 Getting Started

### Prerequisites

-   Node.js (v18+)
-   npm or yarn

### Installation

1.  Clone the repository.
2.  Install dependencies:
    ```bash
    npm install
    ```

### Configuration

1.  Copy the environment template:
    ```bash
    cp env.example .env
    ```
2.  Open `.env` and configure the variables. **Highly detailed comments** for each variable can be found in [env.example](file:///home/wraith/Desktop/PREDA/parity/env.example).
3.  Ensure you provide a valid `GROQ_KEY` if you intend to use AI features.

### Running the Application

-   **Development Mode**:
    ```bash
    npm run dev
    ```
-   **Production Build**:
    ```bash
    npm run build
    npm start
    ```

## 📊 Monitoring

Once the server is running, the dashboard is accessible at `http://127.0.0.1:4000` (depending on your `PORT` configuration).

## 🛠 Tech Stack

-   **Backend**: Node.js, Express, TypeScript
-   **Scraping**: Axios, Cheerio, Playwright
-   **AI**: Groq SDK
-   **Utilities**: Lodash, UUID, String-Similarity

## 📝 License

This project is licensed under the ISC License.
