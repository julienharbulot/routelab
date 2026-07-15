# NEAR Intents fixture adapter

Documentation checked on **2026-07-15**:

- [Message Bus API reference](https://docs.near-intents.org/integration/market-makers/message-bus/rpc)
- [Message Bus overview](https://docs.near-intents.org/integration/market-makers/message-bus/introduction)
- [Market maker example](https://docs.near-intents.org/integration/market-makers/example)

The official quote request supports `defuse_asset_identifier_in`,
`defuse_asset_identifier_out`, one of `exact_amount_in` or `exact_amount_out`, and
`min_deadline_ms`. This adapter deliberately accepts only exact input. It treats
`min_deadline_ms` as candidate-validity metadata, not as RouteLab's relative monotonic wall-clock
stop budget.

The adapter prepares an immutable snapshot through the package facade, maps fictional external
identifiers through a closed asset map, calls the public `quote()` function, and returns an
unsigned candidate. It does not create a Message Bus request or response, quote hash, signed
intent, or settlement instruction.

There is no JWT/API-key handling, WebSocket or RPC connection, 1Click integration, NEP-413
payload, private key, balance/deposit check, custody, submission, execution, or settlement.
