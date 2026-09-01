import mongoose from "mongoose";

const globalForMongo = globalThis as unknown as {
  mongoConn?: Promise<typeof mongoose>;
};

/** Cached Mongoose connection. All Mongo-backed models share this. */
export function connectMongo(): Promise<typeof mongoose> {
  if (!globalForMongo.mongoConn) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error("MONGODB_URI is not set");
    }
    globalForMongo.mongoConn = mongoose.connect(uri);
  }
  return globalForMongo.mongoConn;
}
