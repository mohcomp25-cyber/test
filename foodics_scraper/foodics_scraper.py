#!/usr/bin/env python3
"""
Foodics console scraper.

Logs into the Foodics console with *your own* credentials, opens the sales
report, and either:
  * scrapes the daily sales rows from the report table (paginated), and/or
  * triggers the report's built-in Export and saves the downloaded file.

Designed to be polite and resilient:
  * rate limiting   -> a configurable delay between actions
  * retries         -> exponential backoff on transient failures (tenacity)
  * graceful errors -> clear logging, screenshots on failure, non-zero exit code

This automates a UI you have legitimate access to. It does not bypass any
authentication or security control. Scraping a third-party UI may conflict with
Foodics' terms of service and can break when they change their markup — for
robust, supported access prefer the official Foodics API (docs.foodics.com).

Usage:
    python foodics_scraper.py --scrape          # scrape table rows to CSV
    python foodics_scraper.py --export          # download the report file
    python foodics_scraper.py --scrape --export # both
    python foodics_scraper.py --date 2026-06-03 # (optional) target a day
"""

from __future__ import annotations

import argparse
import csv
import logging
import sys
import time
from datetime import date
from pathlib import Path

from playwright.sync_api import (
    Page,
    TimeoutError as PlaywrightTimeoutError,
    sync_playwright,
)
from tenacity import (
    before_sleep_log,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

import config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("foodics")

# Exceptions worth retrying — transient page/network hiccups, not logic errors.
TRANSIENT = (PlaywrightTimeoutError,)


def polite_pause() -> None:
    """Rate limiting: wait between actions so we don't hammer the server."""
    time.sleep(config.RATE_LIMIT_SECONDS)


@retry(
    retry=retry_if_exception_type(TRANSIENT),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=2, min=2, max=30),
    before_sleep=before_sleep_log(log, logging.WARNING),
    reraise=True,
)
def goto(page: Page, url: str) -> None:
    """Navigate with retry/backoff on transient failures."""
    log.info("Navigating to %s", url)
    page.goto(url, wait_until="networkidle", timeout=30_000)
    polite_pause()


def login(page: Page) -> None:
    """Authenticate using credentials from the environment."""
    if not config.EMAIL or not config.PASSWORD:
        raise SystemExit(
            "Missing credentials. Copy .env.example to .env and set "
            "FOODICS_EMAIL and FOODICS_PASSWORD."
        )

    sel = config.SELECTORS
    goto(page, config.LOGIN_URL)

    log.info("Filling login form for %s", config.EMAIL)
    page.fill(sel["email_input"], config.EMAIL)
    page.fill(sel["password_input"], config.PASSWORD)
    polite_pause()
    page.click(sel["login_button"])

    # Wait for either the logged-in marker or a login error to appear.
    try:
        page.wait_for_selector(sel["logged_in_marker"], timeout=30_000)
    except PlaywrightTimeoutError:
        error_text = ""
        try:
            error_el = page.query_selector(sel["login_error"])
            if error_el:
                error_text = (error_el.inner_text() or "").strip()
        except Exception:  # noqa: BLE001 - best-effort error extraction
            pass
        raise SystemExit(
            f"Login failed. The dashboard never loaded. "
            f"{'Page said: ' + error_text if error_text else ''}\n"
            f"Check your credentials, and verify the selectors in config.py "
            f"against the live login page."
        )
    log.info("Login successful.")
    polite_pause()


@retry(
    retry=retry_if_exception_type(TRANSIENT),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=2, min=2, max=30),
    before_sleep=before_sleep_log(log, logging.WARNING),
    reraise=True,
)
def _read_current_page_rows(page: Page) -> list[list[str]]:
    """Read all data rows currently visible in the report table."""
    sel = config.SELECTORS
    page.wait_for_selector(sel["report_table"], timeout=20_000)
    rows: list[list[str]] = []
    for row in page.query_selector_all(sel["report_row"]):
        cells = [c.inner_text().strip() for c in row.query_selector_all("td, th")]
        if any(cells):
            rows.append(cells)
    return rows


def scrape_sales(page: Page) -> list[list[str]]:
    """Walk the (possibly paginated) sales report and collect every row."""
    sel = config.SELECTORS
    goto(page, config.SALES_REPORT_URL)

    all_rows: list[list[str]] = []
    page_num = 1
    seen_signatures: set[str] = set()

    while True:
        log.info("Scraping report page %d", page_num)
        rows = _read_current_page_rows(page)

        # Guard against infinite loops: if this page's content repeats, stop.
        signature = "|".join("".join(r) for r in rows[:5])
        if signature and signature in seen_signatures:
            log.info("Page content repeated — assuming end of pagination.")
            break
        seen_signatures.add(signature)

        all_rows.extend(rows)
        log.info("  +%d rows (%d total)", len(rows), len(all_rows))

        # Advance to the next page if a "next" control exists and is enabled.
        next_btn = page.query_selector(sel["pagination_next"])
        if not next_btn or not next_btn.is_enabled():
            log.info("No further pages.")
            break

        next_btn.click()
        polite_pause()
        page_num += 1

    return all_rows


def save_rows_csv(rows: list[list[str]], out_dir: Path) -> Path:
    """Persist scraped rows to a timestamped CSV file."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"foodics_sales_{date.today():%Y%m%d}.csv"
    with out_path.open("w", newline="", encoding="utf-8") as fh:
        csv.writer(fh).writerows(rows)
    log.info("Saved %d rows -> %s", len(rows), out_path)
    return out_path


@retry(
    retry=retry_if_exception_type(TRANSIENT),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=2, min=2, max=30),
    before_sleep=before_sleep_log(log, logging.WARNING),
    reraise=True,
)
def export_report(page: Page, out_dir: Path) -> Path:
    """Click the report's Export button and save the downloaded file."""
    sel = config.SELECTORS
    out_dir.mkdir(parents=True, exist_ok=True)

    # Make sure we're on the report page.
    if not page.url.startswith(config.SALES_REPORT_URL):
        goto(page, config.SALES_REPORT_URL)

    log.info("Triggering report export.")
    with page.expect_download(timeout=60_000) as download_info:
        page.click(sel["export_button"])
        polite_pause()
        # Some consoles open a format menu first; click it if present.
        option = page.query_selector(sel["export_format_option"])
        if option:
            option.click()

    download = download_info.value
    suggested = download.suggested_filename or f"foodics_report_{date.today():%Y%m%d}"
    out_path = out_dir / suggested
    download.save_as(str(out_path))
    log.info("Downloaded report -> %s", out_path)
    return out_path


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Foodics console sales scraper.")
    p.add_argument("--scrape", action="store_true", help="Scrape report rows to CSV.")
    p.add_argument("--export", action="store_true", help="Download the report file.")
    p.add_argument("--date", help="Optional YYYY-MM-DD day to target (informational).")
    args = p.parse_args(argv)
    if not args.scrape and not args.export:
        args.scrape = True  # sensible default
    return args


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    out_dir = Path(config.DOWNLOAD_DIR)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=config.HEADLESS)
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        try:
            login(page)

            if args.scrape:
                rows = scrape_sales(page)
                if rows:
                    save_rows_csv(rows, out_dir)
                else:
                    log.warning("No rows scraped — check report selectors in config.py.")

            if args.export:
                export_report(page, out_dir)

        except SystemExit:
            raise
        except Exception as exc:  # noqa: BLE001 - top-level safety net
            shot = out_dir / "error_screenshot.png"
            try:
                out_dir.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(shot), full_page=True)
                log.error("Saved failure screenshot -> %s", shot)
            except Exception:  # noqa: BLE001
                pass
            log.error("Scrape failed: %s", exc)
            return 1
        finally:
            context.close()
            browser.close()

    log.info("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
