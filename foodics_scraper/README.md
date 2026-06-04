# Foodics Console Scraper

A small Python tool that logs into the [Foodics](https://console.foodics.com)
console **with your own credentials**, opens the sales report, and either
scrapes the daily sales rows to CSV or triggers the report's built-in Export
and saves the downloaded file.

It is polite and resilient: rate limiting between actions, retries with
exponential backoff on transient failures, and graceful error handling with a
failure screenshot.

> ⚠️ **Read this first.** This automates a UI you already have legitimate access
> to — it does **not** bypass any login or security control. Use it only on an
> account you own or are authorized to use. Scraping a third-party web UI may
> conflict with Foodics' Terms of Service and **will** break whenever they
> change their page markup. For robust, supported, ToS-friendly access, prefer
> the **official Foodics API** (https://docs.foodics.com) — ask and I'll build
> that instead.

## Setup

```bash
cd foodics_scraper
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium      # one-time browser download

cp .env.example .env             # then edit .env with your credentials
```

## Configure the selectors (required)

Because the console is private and Foodics changes its markup, the CSS/Playwright
selectors in [`config.py`](./config.py) are **best-effort placeholders**. Open
the console in your browser, Inspect each element (login fields, the dashboard,
the report table, the pagination "next" button, the Export button), and update
`SELECTORS` to match. Tip: run with `HEADLESS=0` in `.env` to watch it work and
debug selectors visually.

## Run

```bash
python foodics_scraper.py --scrape            # scrape table rows -> downloads/foodics_sales_YYYYMMDD.csv
python foodics_scraper.py --export            # click Export and save the file
python foodics_scraper.py --scrape --export   # both
```

## How the resilience works

| Concern        | How it's handled |
|----------------|------------------|
| Rate limiting  | `RATE_LIMIT_SECONDS` delay (default 1.5s) between every action. |
| Failed requests| `tenacity` retries navigation/reads up to 4× with 2→4→8…s backoff. |
| Pagination     | Follows the "next" control until it's gone/disabled, with a repeat-detection guard against infinite loops. |
| Hard failures  | Logged clearly, a full-page screenshot is saved to `downloads/`, and the process exits non-zero. |
| Bad login      | Detected via a logged-in marker vs. an error message, fails fast with a clear message. |

## Notes

- Credentials are read from `.env` (git-ignored). Never hardcode or commit them.
- Downloads and the error screenshot go to `DOWNLOAD_DIR` (default `./downloads`).
