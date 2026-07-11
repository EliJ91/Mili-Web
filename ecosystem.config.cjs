module.exports = {
  apps: [
    {
      name: 'mili-discord-worker',
      script: 'src/discord/worker.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
    },
  ],
};
