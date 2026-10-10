// logger = the ONE place the whole backend writes its log messages.
// Before: every file called console.log(...) directly, with no levels, no timestamps, and no way to quiet it down.
// Now: files call logger.info / logger.warn / logger.error / logger.debug. This is called a "facade": a thin wrapper in front of a tool.
// The big benefit: if you later want a professional logging library (like pino), you change THIS file only, not 50 call sites.

// Each level has a number; a message is printed only if its number is >= the current level's number.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

// Works out which level is active right now. Set the LOG_LEVEL environment variable (debug | info | warn | error | silent) to change it.
// Default is "info"; while running tests (NODE_ENV === "test") the default is "silent" so test output stays readable.
const activeLevel = () => {
    // Use LOG_LEVEL if given, otherwise the defaults described above. toLowerCase() so "INFO" and "info" both work.
    const name = (process.env.LOG_LEVEL || (process.env.NODE_ENV === "test" ? "silent" : "info")).toLowerCase();
    // If someone typed a level that doesn't exist, fall back to "info" instead of crashing.
    return LEVELS[name] ?? LEVELS.info;
};

// write() does the actual printing for every level.
const write = (level, printer, args) => {
    // Skip messages that are quieter than the active level (e.g. debug messages when the level is "info").
    if (LEVELS[level] < activeLevel()) return;
    // Print: a timestamp (ISO format, always UTC), the level in capitals, then the original arguments exactly like console.log would.
    printer(`[${new Date().toISOString()}] [${level.toUpperCase()}]`, ...args);
};

// The four functions the rest of the app uses. "...args" collects any number of arguments, just like console.log accepts.
module.exports = {
    debug: (...args) => write("debug", console.log, args), // detailed developer info (hidden by default)
    info: (...args) => write("info", console.log, args),   // normal events ("server started")
    warn: (...args) => write("warn", console.warn, args),  // something odd but not broken ("setting missing")
    error: (...args) => write("error", console.error, args) // something failed
};
