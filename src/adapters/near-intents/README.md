# NEAR Intents fixture boundary

Official documentation checked on **2026-07-16**:

- [Message Bus overview](https://docs.near-intents.org/integration/market-makers/message-bus/introduction)
- [JSON-RPC API reference](https://docs.near-intents.org/integration/market-makers/message-bus/rpc)
- [WebSocket reference](https://docs.near-intents.org/integration/market-makers/message-bus/websocket)
- [Example solver](https://docs.near-intents.org/integration/market-makers/example)

The public `quote` RPC parameters contain `defuse_asset_identifier_in`,
`defuse_asset_identifier_out`, exactly one of `exact_amount_in` or `exact_amount_out`, and
optional `min_deadline_ms`, whose documented default is 60,000 ms.
`parseNearQuoteParamsExactInput()` implements only the exact-input parameter subset, normalizes an
omitted deadline to that value, and does not model the surrounding JSON-RPC envelope or the RPC
result containing `quote_hash`. `public-quote-official-example.json` follows the official request
example with fictional `.invalid` asset identifiers and no credentials.

A solver receives a WebSocket quote event with the same trade fields plus `quote_id`; this fixture
continues to require the event's documented `min_deadline_ms` field.
`draftNearSolverQuoteExactInput()` accepts that exact-input event parameter object, routes against
an immutable fixture snapshot, and preserves `quote_id` in a RouteLab-specific internal draft.
An official `quote_response` requires `quote_id`, `quote_output`, and `signed_data`, and may include
`other_quote_hashes`. The signed data contains a signing standard, payload, signature, and—for the
documented NEP-413 shape—a public key and payload recipient, nonce, and message. The draft contains
none of those signed fields, so it is not an official response and is never described as
protocol-valid.

The draft's `intended_token_diff` is descriptive and solver-oriented: the solver receives the
exact input asset/amount and gives the proposed output asset/amount. All four values are positive
canonical amounts or identifiers, not a signed protocol payload.

| Official concept | RouteLab support | Limitation |
|---|---|---|
| JSON-RPC quote params | exact input | offline parser only |
| solver quote event | exact input with quote ID | fixture only |
| quote response | unsigned draft only | no `signed_data` |
| asset balances | no | immutable pool snapshot only |
| signing | no | no key handling |
| settlement | no | no submission |

The asset map uses fictional external identifiers, is bound to both snapshot ID and checksum,
rejects duplicate identifiers, and rejects any mapped internal asset absent from the snapshot.
`min_deadline_ms` becomes draft-validity metadata; it is not repurposed as RouteLab's monotonic
router work deadline. Exact amounts remain canonical decimal strings at the fixture boundary.

There is no JWT/API-key handling, live RPC or WebSocket connection, 1Click integration, balance
lookup, nonce, `quote_hash`, NEP-413 payload, public key, signature, private key, custody,
submission, execution, or settlement.
