"""
Central configuration for the Foodics console scraper.

IMPORTANT — about the selectors below:
The Foodics console is a private, login-protected single-page app, so the exact
DOM structure cannot be known in advance and Foodics may change it at any time.
The selectors here are *best-effort placeholders*. Before relying on this
scraper, open the console in your browser, use DevTools (right-click -> Inspect)
on each element, and replace the selectors below with what you actually see.

Selectors use Playwright syntax. Prefer stable attributes
(data-testid, name, aria-label, role) over CSS classes, which change often.
"""

import os

from dotenv import load_dotenv

load_dotenv()


# --- Credentials & environment ------------------------------------------------

EMAIL = os.getenv("FOODICS_EMAIL", "")
PASSWORD = os.getenv("FOODICS_PASSWORD", "")
BASE_URL = os.getenv("FOODICS_BASE_URL", "https://console.foodics.com").rstrip("/")
HEADLESS = os.getenv("HEADLESS", "1") == "1"
DOWNLOAD_DIR = os.getenv("DOWNLOAD_DIR", "./downloads")
RATE_LIMIT_SECONDS = float(os.getenv("RATE_LIMIT_SECONDS", "1.5"))


# --- URLs ---------------------------------------------------------------------

LOGIN_URL = f"{BASE_URL}/login"
# Adjust this to the actual sales-report route you use in the console.
SALES_REPORT_URL = f"{BASE_URL}/reports/sales"


# --- Selectors (VERIFY THESE against the live page) ---------------------------

SELECTORS = {
    # Login form
    "email_input": "input[type='email'], input[name='email']",
    "password_input": "input[type='password'], input[name='password']",
    "login_button": "button[type='submit']",
    # An element that only appears once login succeeds (e.g. the dashboard
    # sidebar). Used to confirm we're logged in.
    "logged_in_marker": "[data-testid='app-sidebar'], nav[role='navigation']",
    # A visible login-error message, used to fail fast on bad credentials.
    "login_error": "[role='alert'], .error-message",

    # Sales report page
    "report_table": "table",
    "report_row": "table tbody tr",
    # Next-page control for paginated tables.
    "pagination_next": "button[aria-label='Next'], [data-testid='pagination-next']",
    # The export / download button on the report page.
    "export_button": "button:has-text('Export'), [data-testid='export-button']",
    # If export opens a menu, the concrete format option to click (optional).
    "export_format_option": "text=CSV",
}
