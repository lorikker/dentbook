import "dotenv/config";

// API-route tests that hit Postgres must use the test database, not dev.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DIRECT_DATABASE_URL = process.env.TEST_DIRECT_DATABASE_URL;
