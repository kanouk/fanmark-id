// Shared with the migration row codec: the lifecycle selector must be able to
// parse every imported weight without rounding or an unbounded BigInt input.
export const MAX_LOTTERY_WEIGHT_TEXT_LENGTH = 256;
