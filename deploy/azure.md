# Deploy to Azure

Optional. No subscription or login is stored here.

The template starts a free App Service from [web-host](https://github.com/BeameX/RoboFables/releases/tag/web-host). That host checks the chosen channel once a minute. When `site.zip` on that release is new, it unpacks it and serves the new files. You do not restart the app.

- **latest** watches `web-latest`
- **beta** watches `web-beta`
- **build** plus a number watches `web-1`, `web-2`, and so on

The last 10 numbered builds are kept. `web-latest` and `web-beta` stay.

[Deploy to Azure](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FBeameX%2FRoboFables%2Fmain%2Fdeploy%2Fazuredeploy.json)
