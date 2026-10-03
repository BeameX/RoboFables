# Deploy to Azure

Optional. Use this if you want the website on Azure. The template does not contain a subscription, tenant, or login.

It creates a free App Service and points it at a **public zip**. The default zip is the `web` release of this repository:

`https://github.com/BeameX/RoboFables/releases/download/web/site.zip`

App Service runs that zip (`WEBSITE_RUN_FROM_PACKAGE`). When a new zip is published at the same URL, restart the app and it serves the new files. No workflow is added to the repository.

[Deploy to Azure](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FBeameX%2FRoboFables%2Fmain%2Fdeploy%2Fazuredeploy.json)

The zip root must contain `index.html`, plus `css/`, `js/`, and `vendor/`. It is the static site only, not the Windows starter zip and not the Python bridge.

You need permission to create resources in the resource group you pick in the portal. Nothing in this folder deploys by itself.
