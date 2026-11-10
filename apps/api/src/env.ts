// Loads apps/api/.env into process.env when it exists. In production there's no
// .env file: the host sets the real environment variables instead.
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the environment as it is.
}
