# Deploy to Azure

Optional. Use this if you want the website on Azure. It is a generic template. It does not contain anyone's subscription, tenant, or resource group.

The template creates a free [Azure Static Web App](https://learn.microsoft.com/azure/static-web-apps/) and links it to a GitHub repository. After that, a push to the chosen branch publishes the new site. The site is the static page only (HTTPS, so Chrome and Edge can use Web Serial). Azure does not run the Windows zip or the local bridge.

[Deploy to Azure](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FBeameX%2FRoboFables%2Fmain%2Fdeploy%2Fazuredeploy.json)

When the portal asks:

- **Site name**: any unused name
- **Repository URL**: `https://github.com/BeameX/RoboFables`, or your own fork
- **Branch**: `main`
- **Repository token**: a GitHub token with access to that repository

You need permission to create resources in the resource group you pick in the portal. Nothing in this folder deploys by itself.
