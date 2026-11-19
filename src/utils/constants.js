export const TTL = 15 * 60 * 1000;           // a message disappears 15 minutes after it is SEEN (hidden on screen, then deleted from the database)
export const FADE = 3000;                    // fade-out animation length
export const EDIT_WINDOW = 15 * 60 * 1000;   // messages can be edited for 15 minutes
export const ONLINE_COOLDOWN = 5 * 60 * 1000;     // server: at most one "came online" push per pair every 5 minutes
export const ONLINE_PING_MIN_GAP = 2 * 60 * 1000; // browser: don't announce "I'm online" more than once per 2 minutes
