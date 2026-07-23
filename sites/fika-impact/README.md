# FIKA Impact Tracker

FIKA Impact is a full-screen digital installation for the coffee bar at One Liverpool Street. It rotates automatically through five concise stories showing live service activity, environmental impact, how the impact is created, a monthly projection, and a subtle recent-drinks feed.

The production application is completely static. It requires no server runtime, API, database, or hosting platform integration.

## Local development

Requirements: Node.js 22.13 or later.

```bash
npm install
npm run dev
```

Open `http://localhost:3000/tools/impact-tracker/`.

## Production build

```bash
npm run build
```

The upload-ready website is generated in `out/`. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the FileZilla procedure and troubleshooting guidance.

## Controls

- `D`: show or hide demonstration controls
- Left/Right arrows: previous or next story
- Space: pause or resume presentation rotation
- Swipe horizontally: previous or next story
- `?demo=1`: reveal demonstration controls on load

The presentation and data simulation start automatically. Reduced-motion preferences are respected.
