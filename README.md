# Decision Simulator — backend AI (Gemini)

This project serves the website and its `/api/health` and `/api/chat` endpoints from the **same Node.js server**. Players do not enter API keys. The secret stays in the hosting provider's environment variables.

## Why `Failed to fetch` appears

This usually means the browser cannot reach `/api/chat`, not that Gemini has already rejected the key. Common causes:
- opening `index.html` directly with `file://`;
- uploading only the HTML to static hosting;
- the Node.js backend is not running, or the browser is visiting a different website URL;
- the deployed service failed to start.

Deploy the **whole project** and open the URL given by the Node.js hosting service. Open `https://YOUR-SITE/api/health`: it should return JSON. If it says the server has no `GEMINI_API_KEY`, set the secret in the host dashboard and redeploy/restart.

## Requirements
- Node.js 18+
- A Node.js web-service host
- A valid Gemini API key and access to the selected model

## Deploy on Render
1. Upload the contents of this folder to a private Git repository (do not commit your API key).
2. In Render, create a new Web Service from that repository. Render can use the included `render.yaml` blueprint.
3. In the service's Environment settings, set `GEMINI_API_KEY` to a **new** API key. Set `GEMINI_MODEL` to a model enabled for your key; default is `gemini-3.8-flash`.
4. Deploy and open the HTTPS URL Render gives you. Verify `/api/health`, then open the site and try the chat.

## Run locally
1. Install Node.js 18 or newer.
2. Set `GEMINI_API_KEY` in your terminal environment (never paste it into HTML/source files).
3. Run `npm start`.
4. Open `http://localhost:3000`.

## Security
The key that was pasted into chat should be revoked and replaced. Store the replacement only as a host environment variable. The API usage/quota is charged to the key's owner; public visitors can consume your quota, so configure provider quotas and add stronger abuse controls before public launch.

## API behavior
- Uses Gemini `models.generateContent` REST endpoint with `x-goog-api-key` header.
- The system instruction and recent chat history are sent to Gemini.
- A simple per-IP request limit is included.
