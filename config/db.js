import mongoose from "mongoose"

// Every one of these is a bound on how long something is allowed to hang.
//
// The driver's own defaults leave most of them unbounded, and an unbounded wait
// is what takes this server down. The failure runs like this: the network to
// Atlas goes quiet without closing the sockets. Nothing times out, so those
// connections are never returned to the pool. Requests keep taking connections
// until the pool is empty, and from then on every new request queues for a
// connection that is never coming back. The process stays alive, holds port
// 5000, logs nothing, and answers nothing -- PM2 shows it green the whole time,
// because the process does exist. Only a manual restart clears it.
//
// With these set, the same stall surfaces as errors in the log within seconds
// and the server keeps serving everything that does not touch the database.
// A visible failure that recovers on its own beats a silent one that does not.
const CONNECTION_OPTIONS = {
  // A socket that stops responding mid-query. The driver's default is 0, which
  // means "wait forever", and that is what took the site down: the network to
  // Atlas went quiet without closing the sockets, nothing ever timed out, the
  // dead connections were never returned to the pool, and once the pool was
  // empty every new request queued for a connection that was never coming back.
  // The process stayed alive, held port 5000, logged nothing and answered
  // nothing -- pm2 showed it green throughout, because the process did exist.
  //
  // Two minutes rather than the 30-45s usually suggested, because this limit
  // also applies to work that is slow for honest reasons: campaignService's
  // bulkWrite over a large recipient list, and the heavier admin aggregations.
  // Cutting those off would turn working features into intermittent failures.
  // This setting only has to be finite; the protection against hanging comes
  // from waitQueueTimeoutMS below.
  socketTimeoutMS: 120000,

  // How long a request may wait for a free connection from the pool. Unset --
  // the default -- it waits forever, so a drained pool means every later
  // request hangs instead of failing. This single line is what turns that
  // outage into a handful of logged 500s that clear on their own.
  waitQueueTimeoutMS: 10000,

  // Notice a server that has gone away sooner than the 10s default.
  heartbeatFrequencyMS: 5000,

  // Deliberately NOT set here: serverSelectionTimeoutMS, connectTimeoutMS,
  // maxPoolSize, minPoolSize.
  //
  // Those already have sane, finite defaults (30s, 30s, 100). Tightening them
  // would not have prevented the outage -- it was caused by the two settings
  // above, both of which defaulted to "no limit at all" -- and each one carries
  // its own risk of breaking something that works today. Dropping the pool to
  // 50 caps throughput under a crawl; dropping serverSelectionTimeoutMS to 10s
  // turns a routine Atlas failover, which can take longer than that to elect a
  // new primary, into visible errors for customers.
  //
  // So: add the bounds that were missing, and leave alone what was already
  // working. Fixing a hang is not a reason to make the healthy path tighter.
}

// A connection that drops and silently fails to come back is the thing that
// cost a day of downtime: nothing in the log said so. These say so.
const watchConnection = (connection, label) => {
  connection.on("disconnected", () => {
    console.error(`[db] ${label} DISCONNECTED at ${new Date().toISOString()} -- requests touching it will now fail`)
  })
  connection.on("reconnected", () => {
    console.log(`[db] ${label} reconnected at ${new Date().toISOString()}`)
  })
  connection.on("error", (error) => {
    console.error(`[db] ${label} error: ${error.message}`)
  })
  connection.on("close", () => {
    console.warn(`[db] ${label} connection closed at ${new Date().toISOString()}`)
  })
}

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, CONNECTION_OPTIONS)
    console.log(`MongoDB Connected: ${conn.connection.host}`)
    watchConnection(mongoose.connection, "main")
  } catch (error) {
    console.error(`Error: ${error.message}`)
    process.exit(1)
  }
}

// Separate connection for blogs
let blogConnection = null

const connectBlogDB = async () => {
  if (!blogConnection) {
    try {
      // Check if MONGODB_URI_2 is configured
      if (!process.env.MONGODB_URI_2) {
        console.warn(`⚠️  MONGODB_URI_2 not configured. Falling back to main MongoDB connection for blogs.`)
        // Use the default mongoose connection as a fallback so blog routes still work
        blogConnection = mongoose.connection
        return blogConnection
      }
      blogConnection = await mongoose.createConnection(process.env.MONGODB_URI_2, CONNECTION_OPTIONS).asPromise()
      console.log(`✅ Blog MongoDB Connected: ${blogConnection.host}`)
      watchConnection(blogConnection, "blog")
    } catch (error) {
      console.error(`❌ Blog DB Error: ${error.message}`)
      console.warn(`⚠️  Blog database connection failed. Blog features will be disabled.`)
      // Don't exit process - allow main site to continue running
      // As a last resort, fallback to main mongoose connection if available
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        console.warn(`⚠️ Falling back to main mongoose connection for blogs due to blog DB error.`)
        blogConnection = mongoose.connection
        return blogConnection
      }
      return null
    }
  }
  return blogConnection
}

// Get existing blog connection
const getBlogConnection = () => {
  if (!blogConnection) {
    // If blogConnection is not set, fallback to main mongoose connection if available
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      console.warn("⚠️ blogConnection not initialized - using main mongoose connection as fallback.")
      blogConnection = mongoose.connection
      return blogConnection
    }
    throw new Error("Blog database not connected. Make sure MONGODB_URI_2 is configured and connectBlogDB() was called.")
  }
  return blogConnection
}

export default connectDB
export { connectBlogDB, getBlogConnection }

