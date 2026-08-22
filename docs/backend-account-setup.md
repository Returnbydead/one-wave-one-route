# OWOR backend account setup

The web app keeps backend credentials in encrypted Vercel environment variables. Staff accounts are stored in the owned Google Sheet tab `OWOR USER ACCOUNTS`; passwords are PBKDF2 hashes and are never stored as plain text.

## Install the account module

1. Open the Apps Script project currently deployed as `OWOR_GAS_ENDPOINT`.
2. Replace `Code.gs` with the current repository file [`backend/Code.gs`](../backend/Code.gs).
3. Run `setupOworBackend` once and approve the existing spreadsheet/trigger permissions.
4. Open **Deploy → Manage deployments → Edit**, choose **New version**, then deploy.
5. In OWOR, sign in as Developer, open **Developer**, then click **Refresh status**.

The status `ACCOUNT STORE: Ready` confirms that staff account create/reset/enable/disable is available.

## Role behavior

- `DEVELOPER`: Assignment, Manpower, Picking Monitor, Helper Task, and Developer menus.
- `STAGING_HELPER`: Helper Task only; SO to staging picking.
- `LINE_HELPER`: Helper Task only; staging picking to checker line.
