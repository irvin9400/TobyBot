# Discord Moderation Bot

A moderation bot with two halves:

1. **Discord-side commands** — `/kick`, `/ban`, `/unban`, `/timeout`, `/untimeout`, `/nickname`, `/role`, `/warn` — each logged to a mod-log channel.
2. **In-game action logger** — a small webhook server your Roblox game calls to mirror moderation events (`ban`, `unban`, `kick`, `warn`, `jail`, `unjail`, `freeze`, `unfreeze`) into a separate Discord log channel. Anything not explicitly on that allow-list (e.g. "Lock Entrance" / "Unlock Entrance") is rejected and never logged.

## 1. Set up the Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
2. Under **Bot**, create a bot user and copy the token.
3. Under **Bot > Privileged Gateway Intents**, enable **Server Members Intent**.
4. Under **OAuth2 > URL Generator**, select scopes `bot` and `applications.commands`, and permissions: Kick Members, Ban Members, Moderate Members, Manage Nicknames, Manage Roles, Send Messages, Embed Links. Use the generated URL to invite the bot to your server.
5. Make sure the bot's role is positioned **above** any role you want it to manage or assign.

## 2. Install and configure

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `DISCORD_TOKEN`, `CLIENT_ID` — from the Developer Portal
- `GUILD_ID` — your server's ID (recommended while testing — instant command updates)
- `MOD_LOG_CHANNEL_ID` — channel for Discord-side command logs
- `GAME_LOG_CHANNEL_ID` — channel for in-game action logs
- `MOD_ROLE_IDS` — optional comma-separated role IDs allowed to use commands, on top of Discord's own permission checks
- `WEBHOOK_PORT`, `WEBHOOK_SECRET` — for the Roblox webhook server; make the secret long and random

## 3. Deploy commands and run

```bash
npm run deploy-commands
npm start
```

## 4. Deploy to Railway (or similar)

1. Push this project to a GitHub repo (a `.gitignore` is included so `node_modules` and `.env` are never committed).
2. On [railway.com](https://railway.com), create a new project from that GitHub repo.
3. In the Variables tab, add every key from `.env` (`DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `MOD_LOG_CHANNEL_ID`, `GAME_LOG_CHANNEL_ID`, `MOD_ROLE_IDS`, `WEBHOOK_SECRET`) with your real values. You don't need to set `PORT` — Railway assigns it automatically and the bot reads it.
4. Railway runs `npm install` then `npm start` automatically.
5. Under Settings > Networking, generate a public domain. Your Roblox webhook URL becomes `https://your-app.up.railway.app/game-log`.

## 5. Wire up Roblox

The webhook server listens for `POST /game-log`. From your Roblox game server (not a LocalScript — `HttpService` requests must come from the server), send events like this whenever an in-game moderation action happens. You'll need to host this bot somewhere reachable from Roblox (a VPS, Railway, Render, etc.) — `localhost` won't work.

```lua
local HttpService = game:GetService("HttpService")

local WEBHOOK_URL = "https://your-hosted-bot-url.example.com/game-log"
local WEBHOOK_SECRET = "the-same-secret-from-your-.env"

local function logModerationAction(action, moderatorName, targetName, reason)
    local body = HttpService:JSONEncode({
        action = action,       -- one of: ban, unban, kick, warn, jail, unjail, freeze, unfreeze
        moderator = moderatorName,
        target = targetName,
        reason = reason,       -- optional
    })

    local success, response = pcall(function()
        return HttpService:RequestAsync({
            Url = WEBHOOK_URL,
            Method = "POST",
            Headers = {
                ["Content-Type"] = "application/json",
                ["Authorization"] = "Bearer " .. WEBHOOK_SECRET,
            },
            Body = body,
        })
    end)

    if not success then
        warn("Failed to log moderation action:", response)
    end
end

-- Example usage:
logModerationAction("jail", "AdminUser", "TargetPlayer", "Exploiting")
```

Remember to enable **HTTP Requests** under Game Settings > Security in Roblox Studio.

### Allowed in-game actions

Only these action names are accepted and logged: `ban`, `unban`, `kick`, `warn`, `jail`, `unjail`, `freeze`, `unfreeze`. Anything else — including things like `lock entrance` / `unlock entrance` — is rejected with a 400 response and never posted to Discord. To change what's logged, edit `ALLOWED_ACTIONS` in `webhook/server.js`.

## Project structure

```
modbot/
├── index.js              # Bot entry point
├── deploy-commands.js     # Registers slash commands
├── config.js              # Loads .env
├── commands/               # One file per slash command
├── utils/
│   ├── logger.js           # Shared embed logger (Discord + game logs)
│   └── permissions.js      # Optional MOD_ROLE_IDS check
└── webhook/
    └── server.js           # Express server for Roblox → Discord logging
```
