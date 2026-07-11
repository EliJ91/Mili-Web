import { createReadOnlyDiscordBot } from './readOnlyBot.js';

const bot = createReadOnlyDiscordBot({
  onEvent(event) {
    console.log(JSON.stringify({
      observedAt: new Date().toISOString(),
      ...event,
    }));
  },
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.info(`Received ${signal}. Shutting down Discord read-only worker.`);
  try {
    await bot.stop();
    process.exitCode = 0;
  } catch (error) {
    console.error('Failed to stop Discord read-only worker.', error);
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await bot.start();
} catch (error) {
  console.error('Failed to start Discord read-only worker.', error);
  process.exitCode = 1;
}
