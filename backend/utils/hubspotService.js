const axios = require("axios");
// axios is already a dependency in this project (used above for Resend) — reusing it here
// keeps us from adding a new package just for HubSpot.

const HUBSPOT_BASE_URL = "https://api.hubapi.com";
// The root address for all of HubSpot's API endpoints — every request below builds on this.

/**
 * Sync a newly registered WordKnit user into HubSpot as a Contact.
 * Fire-and-forget by design (same pattern as sendWelcomeEmail in authController.js):
 * if HubSpot is down or misconfigured, registration must still succeed for the user.
 *
 * @param {string} name - the user's full name, as stored in WordKnit's User model
 * @param {string} email - the user's email, used by HubSpot to identify/dedupe contacts
 */
const syncContactToHubspot = async (name, email) => {
    // "async" so we can use "await" for the network call inside without blocking the whole app.
    if (!process.env.HUBSPOT_PRIVATE_APP_TOKEN) {
        // Guard clause: if no token is configured, skip silently rather than throwing an error —
        // this mirrors how sendWelcomeEmail() checks for RESEND_API_KEY before trying.
        console.log("[HubSpot] HUBSPOT_PRIVATE_APP_TOKEN not set — skipping contact sync");
        return;
        // Exit early; nothing below this line runs.
    }

    // WordKnit stores the user's full name as a single field, but HubSpot's default Contact
    // properties expect firstname/lastname separately, so we split it here.
    const [firstName, ...rest] = name.trim().split(" ");
    // .trim() removes leading/trailing spaces; .split(" ") breaks the name into an array of words.
    // Array destructuring: the FIRST word becomes firstName, and "...rest" collects everything else.
    const lastName = rest.join(" ") || "";
    // .join(" ") glues any remaining words back together with spaces (handles multi-word last names).
    // "|| ''" falls back to an empty string if there was no last name at all (single-word name).

    try {
        // try/catch so a failure here doesn't crash the calling function (register()).
        await axios.post(
            `${HUBSPOT_BASE_URL}/crm/v3/objects/contacts`,
            // POST to the Contacts endpoint — this CREATES a new Contact record in HubSpot.
            {
                properties: {
                    // "properties" is the object HubSpot expects field data under.
                    email,
                    // Shorthand for "email: email" — maps our variable directly to HubSpot's built-in email property.
                    firstname: firstName,
                    // Maps our derived firstName to HubSpot's built-in firstname property.
                    lastname: lastName,
                    // Maps our derived lastName to HubSpot's built-in lastname property.
                    wordknit_signup_source: "WordKnit App"
                    // A custom property (must be created in HubSpot's UI first) marking where this contact came from.
                }
            },
            {
                headers: {
                    // Extra request metadata sent alongside the actual data.
                    "Authorization": `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`,
                    // Bearer token auth — proves to HubSpot we're allowed to make this request.
                    "Content-Type": "application/json"
                    // Tells HubSpot the request body is JSON-formatted.
                },
                timeout: 8000
                // Same 8-second timeout pattern used for the Resend calls above, so a slow/hanging
                // HubSpot request can't stall registration indefinitely.
            }
        );
        console.log(`[HubSpot] Contact synced: ${email}`);
        // Log success so it's visible in server logs during testing/debugging.
    } catch (err) {
        // Runs if the POST request fails for any reason.
        if (err.response?.status === 409) {
            // HTTP 409 = "Conflict" — HubSpot's way of saying a contact with this email already exists.
            console.log(`[HubSpot] Contact already exists, skipping create: ${email}`);
            // For now we just log and move on; updating an existing contact can be added later if needed.
            return;
            // Exit early — no need to log the generic error below for this expected case.
        }
        console.log("[HubSpot] Contact sync failed:", err.response?.data || err.message);
        // "?." (optional chaining) avoids crashing if err.response is undefined (e.g. no network at all);
        // falls back to err.message when there's no response body to show.
    }
};

module.exports = { syncContactToHubspot };
// Exports the function so authController.js can import and call it.
