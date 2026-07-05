import "dotenv/config";

// setupFiles run before test-file imports, so modules that construct Prisma
// clients at import time (src/lib/db.ts) pick up the test database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DIRECT_DATABASE_URL = process.env.TEST_DIRECT_DATABASE_URL;
