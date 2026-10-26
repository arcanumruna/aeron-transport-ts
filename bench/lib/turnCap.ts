// The cap of a bench drive loop. A loop that turns the event loop until a subscriber has read a message waits for ever if
// the subscriber has lost its image or a datagram is gone; the bench (and the CI bench job) would hang. Every such loop
// counts its turns and throws, naming the scenario and the progress, at the cap.

/**
 * The most turns of the event loop one drive loop takes before it fails. A healthy run is far below it (a wait for one
 * message takes a handful of turns, a whole stream of the largest scenario well under a tenth of this).
 */
export const MAX_TURNS = 1_000_000;

export class TurnCap {
    /** Turns counted so far. */
    public turns = 0;

    /**
     * @param scenario what is driven, for the message.
     * @param progress the progress at the moment of the failure, for example `received 3/10`.
     * @param cap the most turns; the default is `MAX_TURNS`.
     */
    private readonly scenario: string;
    private readonly progress: () => string;
    private readonly cap: number;
    public constructor(scenario: string, progress: () => string, cap: number = MAX_TURNS) {
        this.scenario = scenario;
        this.progress = progress;
        this.cap = cap;
    }

    /** Count one turn; throws at the cap. Call it once per iteration of the loop. */
    public tick(): void {
        if (++this.turns > this.cap) {
            throw new Error(
                'bench drive loop of ' +
                    this.scenario +
                    ' made ' +
                    this.cap +
                    ' turns without finishing: ' +
                    this.progress(),
            );
        }
    }
}
