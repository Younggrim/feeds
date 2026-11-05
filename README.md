# Feeds

My own YouTube subscriptions page at **feeds.macdwellings.com**: newest uploads from the channels in `channels.json`, filtered by `filters.json`. Tapping a video opens it in the YouTube app.

- `channels.json` — channels to follow (`id` is the channel's UC… ID)
- `filters.json` — title words to hide, channels to skip, how far back to go
- `scripts/build.mjs` — reads each channel's public RSS feed and writes `site/feed.json`
- `.github/workflows/build.yml` — rebuilds and deploys to GitHub Pages about every 30 minutes
