# Deploy to Azure

Optional. No subscription or login is stored here.

This is the same update model SCEPman uses. The App Service setting `WEBSITE_RUN_FROM_PACKAGE` points at a public zip. On every start, Azure checks that address and loads the zip if it changed. Azure's own maintenance restarts the app from time to time, so a channel such as latest moves forward without a separate updater.

- **latest** → `https://github.com/BeameX/RoboFables/releases/download/web-latest/site.zip`
- **beta** → `https://github.com/BeameX/RoboFables/releases/download/web-beta/site.zip`
- **build** plus a number, for example `1` → `https://github.com/BeameX/RoboFables/releases/download/web-1/site.zip`

Change `ROBOFABLES_CHANNEL` or `ROBOFABLES_BUILD` in the template (or the package URL on the app) to switch. The last 10 numbered builds are kept.

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FBeameX%2FRoboFables%2Fmain%2Fdeploy%2Fazuredeploy.json)

The zip is the static site. Its root must contain `index.html`.
