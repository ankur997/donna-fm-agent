// pm2 process config for the standalone Donna FM agent.
// Memory-capped + restart-bounded so a crash loop can NEVER starve the
// Mission Control box (the 2026-06-16 OOM lesson, applied here proactively).
module.exports = {
  apps: [
    {
      name: "donna-fm-agent",
      script: "npm",
      args: "start", // = tsx src/index.ts (the scheduler)
      cwd: "/home/ubuntu/donna-fm-agent",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 10000,
      min_uptime: 30000,
      max_memory_restart: "400M",
      env: {
        NODE_OPTIONS: "--max-old-space-size=384",
        TZ: "Asia/Kolkata",
      },
    },
  ],
};
