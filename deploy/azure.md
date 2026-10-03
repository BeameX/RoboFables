# Deploy to Azure

Optional. The template does not contain a subscription, tenant, or login.

It creates a free App Service and runs a **public zip** (`WEBSITE_RUN_FROM_PACKAGE`). Pick a channel:

- **latest** → `https://github.com/BeameX/RoboFables/releases/download/web-latest/site.zip`
- **beta** → `https://github.com/BeameX/RoboFables/releases/download/web-beta/site.zip`
- **build** plus a number, for example `1` → `https://github.com/BeameX/RoboFables/releases/download/web-1/site.zip`

Those three settings are `ROBOFABLES_CHANNEL` and `ROBOFABLES_BUILD` on the app. Changing them changes the zip address. App Service restarts when that setting changes, and then serves the zip.

A new file at the **same** address does not restart the app by itself. Latest and beta are replaced in place, so after a new latest zip you restart the app once (or change the setting away and back). A numbered build never changes.

Numbered releases are kept for the last 10 (`web-1` …). Older numbered releases are deleted when a newer one is published. `web-latest` and `web-beta` stay.

[Deploy to Azure](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FBeameX%2FRoboFables%2Fmain%2Fdeploy%2Fazuredeploy.json)

The zip root must contain `index.html`. It is the static site only, not the Windows starter zip.
